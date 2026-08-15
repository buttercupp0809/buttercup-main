#!/usr/bin/env python3
"""
Bulk image generator for all 143 personas using Stheno LLM for prompt generation.

Flow per persona:
  1. Read stheno-prompt.txt (the master prompt template)
  2. Inject character data (name, location, bio) into the template
  3. Send to Stheno LLM -> get 5 distinct image prompts back
  4. Upload reference image to ComfyUI
  5. Run persona_pipeline.py once per prompt (VARIANTS_PER_PROMPT=1) -> 5 images
  6. Images saved to S3 and to the DB (CharacterMedia) automatically

Prerequisites:
  - GPU box running with both ComfyUI (port 8188) and Stheno accessible
  - .venv with boto3 + requests installed

Required env vars:
  COMFYUI_IP                  GPU box public IP
  STHENO_URL                  Full URL to Stheno API endpoint
                              e.g. http://<ip>:11434/api/generate  (Ollama)
                              e.g. http://<ip>:5000/v1/chat/completions  (OpenAI-compat)
  STHENO_MODEL                Model name to pass to Stheno (e.g. stheno, stheno-v3.5)

Optional env vars:
  POPPY_S3_BUCKET_GENERATED   S3 bucket (images saved locally if not set)
  POPPY_API_BASE_URL          App API base for DB save (default http://localhost:4000)
  POPPY_API_TOKEN             JWT for DB save
  AWS_REGION                  (default eu-north-1)
  PROD_DATABASE_URL           Production Postgres URL; when set, generated image
                              S3 keys are written to BOTH the local database
                              (DATABASE_URL) and the production database. Can
                              also be set in backend/.env.

Usage:
  export COMFYUI_IP=<ip>
  export STHENO_URL=http://<ip>:11434/api/generate
  export STHENO_MODEL=stheno
  export POPPY_S3_BUCKET_GENERATED=<bucket>

  ./.venv/bin/python3 bulk_generate_llm.py [--start N] [--end N] [--dry-run]

Flags:
  --start N   start from persona index N (default 1)
  --end N     end at persona index N inclusive (default 143)
  --dry-run   call Stheno and print the prompts it generates, but skip image generation
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.join(HERE, "..", "..")
PERSONA_LIST_MD = os.path.join(REPO_ROOT, "Plans", "persona-list.md")
PERSONAS_DIR = os.path.join(REPO_ROOT, "frontend", "public", "personas")
PIPELINE_SCRIPT = os.path.join(HERE, "persona_pipeline.py")
VENV_PYTHON = os.path.join(HERE, ".venv", "bin", "python3")
STHENO_PROMPT_FILE = os.path.join(HERE, "stheno-prompt.txt")
OUT_DIR = os.path.join(HERE, "persona-output")

COMFYUI_IP = os.environ.get("COMFYUI_IP", "")
STHENO_URL = os.environ.get("STHENO_URL", "")
STHENO_MODEL = os.environ.get("STHENO_MODEL", "stheno")
S3_BUCKET = os.environ.get("POPPY_S3_BUCKET_GENERATED", "")
API_BASE = os.environ.get("POPPY_API_BASE_URL", "http://localhost:4000")
API_TOKEN = os.environ.get("POPPY_API_TOKEN", "")
CKPT = os.environ.get("POPPY_JUGGERNAUT_CHECKPOINT", "juggernautXL_v9.safetensors")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
PROD_DATABASE_URL = os.environ.get("PROD_DATABASE_URL", "")

# Load DATABASE_URL and PROD_DATABASE_URL from backend/.env if not already in environment
_env_path = Path(REPO_ROOT) / "backend" / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        if not DATABASE_URL and _line.startswith("DATABASE_URL="):
            DATABASE_URL = _line.split("=", 1)[1].strip().strip('"')
        elif not PROD_DATABASE_URL and _line.startswith("PROD_DATABASE_URL="):
            PROD_DATABASE_URL = _line.split("=", 1)[1].strip().strip('"')

QUALITY = (
    "full body from head to toe, entire figure visible including feet, full length wide shot, "
    "whole body inside the frame, subject centered with empty space and margin above the head "
    "and below the feet, standing far from camera, RAW photo, photorealistic, soft even lighting, "
    "bright natural light, well-lit, masterpiece, best quality, 8k uhd, dslr, sharp focus, high detail, "
)
NEGATIVE = (
    "cropped, out of frame, head out of frame, hands cut off, cut off, close-up, zoomed in, "
    "partial body, dark, low-key lighting, harsh shadows, deformed iris, deformed pupils, "
    "cartoon, anime, illustration, 3d render, cgi, sketch, drawing, bad anatomy, bad hands, "
    "extra fingers, mutated hands, poorly drawn face, mutation, deformed, blurry, watermark, "
    "text, jpeg artifacts, ugly, duplicate, child, kid, minor, underage, teen"
)


# ---- Persona list parser ----

def parse_persona_list(path: str) -> dict:
    personas = {}
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        m = re.match(r"^(\d+)\.\s+(.+?)\s+-\s+(.+)$", line)
        if m:
            idx = int(m.group(1))
            name = m.group(2).strip()
            location = m.group(3).strip()
            i += 1
            while i < len(lines) and not lines[i].strip():
                i += 1
            bio = lines[i].strip() if i < len(lines) else ""
            personas[idx] = {"name": name, "location": location, "bio": bio}
        i += 1
    return personas


# ---- Stheno LLM call ----

def call_stheno(filled_prompt: str) -> str:
    """
    Sends the filled prompt to Stheno and returns the raw text response.

    Supports two API formats based on STHENO_URL:
      - Ollama  (/api/generate or /api/chat): sends {"model": ..., "prompt": ..., "stream": false}
      - OpenAI-compatible (/v1/chat/completions): sends {"model": ..., "messages": [...]}
    """
    import requests

    headers = {"Content-Type": "application/json"}

    if "/v1/chat/completions" in STHENO_URL:
        payload = {
            "model": STHENO_MODEL,
            "messages": [{"role": "user", "content": filled_prompt}],
            "stream": False,
        }
        resp = requests.post(STHENO_URL, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()

    else:
        # Ollama /api/generate or /api/chat
        payload = {
            "model": STHENO_MODEL,
            "prompt": filled_prompt,
            "stream": False,
        }
        resp = requests.post(STHENO_URL, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        # Ollama /api/generate returns {"response": "..."}
        # Ollama /api/chat returns {"message": {"content": "..."}}
        return (data.get("response") or data.get("message", {}).get("content", "")).strip()


def get_five_prompts(name: str, location: str, bio: str, template: str) -> list:
    """
    Fills the stheno-prompt.txt template with character data, calls Stheno,
    and parses exactly 5 prompts from the response.
    """
    filled = template.format(name=name, location=location, bio=bio)
    raw = call_stheno(filled)

    # Parse numbered lines: "1. ...", "2. ...", etc.
    prompts = []
    for line in raw.splitlines():
        line = line.strip()
        cleaned = re.sub(r"^\d+[\.\)]\s*", "", line).strip()
        if cleaned and len(cleaned) > 20:
            prompts.append(cleaned)

    # Fallback: split by blank lines if numbered parsing found fewer than 5
    if len(prompts) < 5:
        chunks = [c.strip() for c in raw.split("\n\n") if len(c.strip()) > 20]
        prompts = chunks if len(chunks) >= 5 else prompts

    if not prompts:
        raise ValueError(f"Stheno returned no parseable prompts. Raw response:\n{raw[:300]}")

    # Pad to 5 if Stheno returned fewer, trim if more
    while len(prompts) < 5:
        prompts.append(prompts[-1])
    return prompts[:5]


# ---- DB helpers ----

def _db_conn(db_url: str):
    import psycopg2
    return psycopg2.connect(db_url)


def lookup_character_id(idx: int, db_url: str = "") -> str:
    """
    Returns the Character.id for the persona at index idx by matching
    CharacterMedia.url = '/personas/{idx}.webp'.
    db_url defaults to DATABASE_URL (local). Pass PROD_DATABASE_URL for prod.
    Returns empty string if not found or DB unavailable.
    """
    url = db_url or DATABASE_URL
    if not url:
        return ""
    try:
        conn = _db_conn(url)
        cur = conn.cursor()
        for ext in (".webp", ".png", ".jpg", ".jpeg"):
            cur.execute(
                """
                SELECT c.id FROM "Character" c
                JOIN "CharacterMedia" m ON m."characterId" = c.id
                WHERE m.url = %s
                LIMIT 1
                """,
                (f"/personas/{idx}{ext}",),
            )
            row = cur.fetchone()
            if row:
                cur.close()
                conn.close()
                return row[0]
        cur.close()
        conn.close()
        return ""
    except Exception as exc:
        label = (url[:40] + "...") if len(url) > 40 else url
        print(f"  [warn] DB lookup failed for persona {idx} ({label}): {exc}")
        return ""


def _write_media_rows(character_id: str, s3_keys: list, db_url: str) -> int:
    """
    Inserts CharacterMedia rows for the given s3_keys into db_url.
    Demotes the existing primary first.
    Returns the number of rows inserted.
    """
    try:
        conn = _db_conn(db_url)
        cur = conn.cursor()
        cur.execute(
            'UPDATE "CharacterMedia" SET "isPrimary" = false WHERE "characterId" = %s AND "isPrimary" = true',
            (character_id,),
        )
        inserted = 0
        for sort_idx, s3_key in enumerate(s3_keys):
            is_primary = (sort_idx == 0)
            cur.execute(
                """
                INSERT INTO "CharacterMedia" (id, "characterId", kind, url, "isPrimary", sort, "likesBase", "createdAt")
                VALUES (gen_random_uuid(), %s, 'image', %s, %s, %s, 0, NOW())
                """,
                (character_id, s3_key, is_primary, sort_idx),
            )
            inserted += cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
        return inserted
    except Exception as exc:
        label = (db_url[:40] + "...") if len(db_url) > 40 else db_url
        print(f"  [warn] DB insert failed ({label}): {exc}")
        return 0


def save_generated_to_db(
    character_id: str, idx: int, num_prompts: int, prod_character_id: str = ""
) -> int:
    """
    Reads the per-prompt manifests (OUT_DIR/{idx}_p1/manifest.json through
    OUT_DIR/{idx}_p{num_prompts}/manifest.json) and saves all generated images
    to CharacterMedia:
      - first successful image -> isPrimary=true, replaces original
      - remaining images       -> isPrimary=false (gallery media)
    Writes to the local database (DATABASE_URL) and, if PROD_DATABASE_URL is
    set, also to the production database.
    Returns the number of rows inserted into the local database.
    """
    if not character_id or not DATABASE_URL:
        return 0

    s3_keys = []
    for j in range(1, num_prompts + 1):
        manifest_path = os.path.join(OUT_DIR, f"{idx}_p{j}", "manifest.json")
        try:
            with open(manifest_path, "r") as f:
                manifest = json.load(f)
            for v in manifest.get("variants", []):
                if v.get("status") == "ok" and v.get("s3Key"):
                    s3_keys.append(v["s3Key"])
        except Exception:
            pass  # prompt may have failed; skip

    if not s3_keys:
        print("  [warn] No successful variants found across prompt manifests")
        return 0

    inserted = _write_media_rows(character_id, s3_keys, DATABASE_URL)

    if PROD_DATABASE_URL and PROD_DATABASE_URL != DATABASE_URL and prod_character_id:
        prod_inserted = _write_media_rows(prod_character_id, s3_keys, PROD_DATABASE_URL)
        print(f"  prod-db: {prod_inserted} rows written (character {prod_character_id[:8]})")
    elif PROD_DATABASE_URL and PROD_DATABASE_URL != DATABASE_URL and not prod_character_id:
        print("  [warn] prod-db: skipped (character not found in production DB)")

    return inserted


# ---- Image file finder ----

def find_persona_image(idx: int) -> str:
    for ext in (".webp", ".png", ".jpg", ".jpeg"):
        p = os.path.join(PERSONAS_DIR, f"{idx}{ext}")
        if os.path.exists(p):
            return p
    return ""


# ---- ComfyUI helpers ----

def wait_for_comfyui(ip: str, timeout: int = 120) -> bool:
    url = f"http://{ip}:8188/system_stats"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=5)
            return True
        except Exception:
            time.sleep(5)
    return False


def upload_image(ip: str, image_path: str) -> str:
    import requests
    with open(image_path, "rb") as f:
        resp = requests.post(
            f"http://{ip}:8188/upload/image",
            files={"image": f},
            data={"overwrite": "true"},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.json()["name"]


# ---- Per-persona generation ----

def generate_persona(idx: int, image_path: str, prompts: list, dry_run: bool) -> bool:
    if dry_run:
        print(f"  [dry-run] Stheno generated {len(prompts)} prompts:")
        for j, p in enumerate(prompts, 1):
            print(f"    {j}: {p[:100]}...")
        return True

    try:
        img_name = upload_image(COMFYUI_IP, image_path)
        print(f"  uploaded -> {img_name}")
    except Exception as exc:
        print(f"  [error] ComfyUI upload failed: {exc}")
        return False

    for j, prompt in enumerate(prompts, 1):
        print(f"  [{j}/{len(prompts)}] {prompt[:70]}...")
        # Use a unique sub-id per prompt so each pipeline call gets its own
        # output directory and manifest (prevents overwriting).
        prompt_id = f"{idx}_p{j}"
        env = {
            **os.environ,
            "VARIANTS_PER_PROMPT": "1",
            "POPPY_S3_BUCKET_GENERATED": S3_BUCKET,
            "POPPY_CHARACTER_ID": "",  # DB save handled by bulk script after all manifests are written
            "POPPY_API_BASE_URL": API_BASE,
            "POPPY_API_TOKEN": "",
        }
        result = subprocess.run([
            VENV_PYTHON, PIPELINE_SCRIPT,
            COMFYUI_IP, prompt_id, image_path, OUT_DIR, img_name,
            CKPT, "1.05", "0.0", "0.75", "30", "4.5", "dpmpp_2m", "karras",
            NEGATIVE, QUALITY, prompt,
        ], env=env, timeout=600)
        if result.returncode != 0:
            print(f"  [warn] pipeline non-zero for persona {idx} prompt {j}")

    return True


# ---- Main ----

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=143)
    parser.add_argument("--dry-run", action="store_true",
                        help="Call Stheno and print prompts, skip image generation")
    args = parser.parse_args()

    if not STHENO_URL:
        sys.exit("ERROR: set STHENO_URL (e.g. http://<gpu-ip>:11434/api/generate)")
    if not args.dry_run and not COMFYUI_IP:
        sys.exit("ERROR: set COMFYUI_IP to the GPU box IP address.")
    if not args.dry_run and not S3_BUCKET:
        print("WARN: POPPY_S3_BUCKET_GENERATED not set -- images saved locally only.")

    if not os.path.exists(STHENO_PROMPT_FILE):
        sys.exit(f"ERROR: stheno-prompt.txt not found at {STHENO_PROMPT_FILE}")
    with open(STHENO_PROMPT_FILE, "r", encoding="utf-8") as f:
        prompt_template = f.read()

    print("[bulk] Parsing persona list...")
    personas = parse_persona_list(PERSONA_LIST_MD)
    print(f"[bulk] {len(personas)} personas found")

    if not args.dry_run:
        print(f"[bulk] Checking ComfyUI at {COMFYUI_IP}:8188...")
        if not wait_for_comfyui(COMFYUI_IP):
            sys.exit(f"ERROR: ComfyUI not reachable at {COMFYUI_IP}:8188")
        print("[bulk] ComfyUI ready")

    total = sum(1 for i in range(args.start, args.end + 1)
                if i in personas and find_persona_image(i))
    print(f"[bulk] {total} personas to process (index {args.start}-{args.end})")
    print(f"[bulk] Stheno endpoint: {STHENO_URL}  model: {STHENO_MODEL}")
    print()

    done = 0
    for idx in range(args.start, args.end + 1):
        if idx not in personas:
            continue
        p = personas[idx]
        name, location, bio = p["name"], p["location"], p["bio"]

        image_path = find_persona_image(idx)
        if not image_path:
            print(f"[{idx}] {name} -- no image, skipping")
            continue

        character_id = lookup_character_id(idx)
        prod_character_id = lookup_character_id(idx, PROD_DATABASE_URL) if PROD_DATABASE_URL else ""
        db_status = f"local={'ok:'+character_id[:8] if character_id else 'not found'}"
        if PROD_DATABASE_URL:
            db_status += f" prod={'ok:'+prod_character_id[:8] if prod_character_id else 'not found'}"
        print(f"[{idx}/{args.end}] {name} ({location}) {db_status}")

        try:
            prompts = get_five_prompts(name, location, bio, prompt_template)
        except Exception as exc:
            print(f"  [error] Stheno call failed: {exc}")
            continue

        if generate_persona(idx, image_path, prompts, args.dry_run):
            done += 1
            if not args.dry_run and character_id:
                saved = save_generated_to_db(character_id, idx, len(prompts), prod_character_id)
                print(f"  local-db: {saved} generated images saved (image 1 is new primary, 2-5 are gallery)")
        print()

    print(f"[bulk] Complete: {done}/{total} personas processed ({done * 5} images total)")
    if S3_BUCKET and not args.dry_run:
        print(f"[bulk] Images uploaded to s3://{S3_BUCKET}/images/")


if __name__ == "__main__":
    main()
