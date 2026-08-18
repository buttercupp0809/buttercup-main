#!/usr/bin/env python3
"""
Bulk image generator v2: two-stage Stheno reform pipeline.

Difference from bulk_generate_llm.py:
  Instead of asking Stheno to produce 5 fully independent prompts, this runs
  a two-stage pipeline:

    Stage 1 -- Base prompt:
      Stheno generates ONE base appearance prompt for the character (hair, eyes,
      skin, style, personality cues) with NO specific scene or background.

    Stage 2 -- Part-based reforms:
      Stheno takes the base prompt and generates 5 variations, each reforming
      ONE specific dimension:
        1. Scene / setting
        2. Outfit / attire
        3. Lighting / time-of-day
        4. Mood / expression
        5. Camera angle / composition

  This produces images that are unmistakably the same character but differ
  visually in a controlled, predictable way rather than being 5 random scenes.

S3 and DB saving:
  - S3 is REQUIRED (script exits if POPPY_S3_BUCKET_GENERATED is unset).
  - Saves to BOTH local (DATABASE_URL) and production (PROD_DATABASE_URL) DBs.
  - If a character is not found in either DB, logs a clear warning but continues.
  - No silent skips -- every save result is printed.

Prerequisites:
  - GPU box running ComfyUI (port 8188) and Stheno.
  - .venv with boto3 + requests + psycopg2 installed.

Required env vars:
  COMFYUI_IP                  GPU box public IP
  STHENO_URL                  Full URL, e.g. http://<ip>:11434/api/generate
  STHENO_MODEL                Model name, e.g. stheno or stheno-v3.5
  POPPY_S3_BUCKET_GENERATED   S3 bucket -- required (no local-only fallback)

Optional env vars:
  POPPY_API_BASE_URL          App API base (default http://localhost:4000)
  POPPY_JUGGERNAUT_CHECKPOINT Checkpoint filename (default juggernautXL_v9.safetensors)
  AWS_REGION                  AWS region (default eu-north-1)
  DATABASE_URL                Local Postgres URL (also read from backend/.env)
  PROD_DATABASE_URL           Prod Postgres URL (also read from backend/.env)

Usage:
  export COMFYUI_IP=<ip>
  export STHENO_URL=http://<ip>:11434/api/generate
  export STHENO_MODEL=stheno
  export POPPY_S3_BUCKET_GENERATED=<bucket>

  ./.venv/bin/python3 bulk_generate_v2.py [--start N] [--end N] [--ids 1,2,5] [--dry-run]

Flags:
  --start N       Start from persona index N (default 1, ignored if --ids set)
  --end N         End at persona index N inclusive (default 143, ignored if --ids set)
  --ids 1,3,7     Comma-separated specific persona indices to process
  --dry-run       Run both Stheno stages and print the reformed prompts, skip image gen
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
BASE_PROMPT_FILE = os.path.join(HERE, "stheno-base-prompt.txt")
REFORM_PROMPT_FILE = os.path.join(HERE, "stheno-reform-prompt.txt")
OUT_DIR = os.path.join(HERE, "persona-output-v2")

COMFYUI_IP = os.environ.get("COMFYUI_IP", "")
STHENO_URL = os.environ.get("STHENO_URL", "")
STHENO_MODEL = os.environ.get("STHENO_MODEL", "stheno")
S3_BUCKET = os.environ.get("POPPY_S3_BUCKET_GENERATED", "")
API_BASE = os.environ.get("POPPY_API_BASE_URL", "http://localhost:4000")
CKPT = os.environ.get("POPPY_JUGGERNAUT_CHECKPOINT", "juggernautXL_v9.safetensors")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
PROD_DATABASE_URL = os.environ.get("PROD_DATABASE_URL", "")

# Load DATABASE_URL and PROD_DATABASE_URL from backend/.env if not in environment
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

NUM_IMAGES = 5


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


# ---- Stheno LLM calls ----

def _call_stheno(prompt_text: str) -> str:
    """Calls Stheno and returns the raw text response. Supports Ollama and OpenAI-compat."""
    import requests
    headers = {"Content-Type": "application/json"}

    if "/v1/chat/completions" in STHENO_URL:
        payload = {
            "model": STHENO_MODEL,
            "messages": [{"role": "user", "content": prompt_text}],
            "stream": False,
        }
        resp = requests.post(STHENO_URL, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()

    # Ollama /api/generate or /api/chat
    payload = {
        "model": STHENO_MODEL,
        "prompt": prompt_text,
        "stream": False,
    }
    resp = requests.post(STHENO_URL, headers=headers, json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    return (data.get("response") or data.get("message", {}).get("content", "")).strip()


def generate_base_prompt(name: str, location: str, bio: str, template: str) -> str:
    """Stage 1: ask Stheno to write one base appearance prompt for the character."""
    filled = template.format(name=name, location=location, bio=bio)
    base = _call_stheno(filled).strip()
    if not base or len(base) < 20:
        raise ValueError(f"Stheno returned an unusable base prompt: {base!r}")
    # Strip any leading label like "Base prompt:" that the model might add
    base = re.sub(r"^(base\s+prompt\s*[:.-]\s*)", "", base, flags=re.IGNORECASE).strip()
    return base


def reform_prompts(base_prompt: str, template: str) -> list:
    """Stage 2: ask Stheno to reform 5 specific parts of the base prompt."""
    filled = template.format(base_prompt=base_prompt)
    raw = _call_stheno(filled)

    prompts = []
    for line in raw.splitlines():
        line = line.strip()
        cleaned = re.sub(r"^\d+[\.\)]\s*", "", line).strip()
        if cleaned and len(cleaned) > 20:
            prompts.append(cleaned)

    # Fallback: split by blank lines
    if len(prompts) < NUM_IMAGES:
        chunks = [c.strip() for c in raw.split("\n\n") if len(c.strip()) > 20]
        prompts = chunks if len(chunks) >= NUM_IMAGES else prompts

    if not prompts:
        raise ValueError(f"Stheno returned no parseable reformed prompts. Raw:\n{raw[:300]}")

    while len(prompts) < NUM_IMAGES:
        prompts.append(prompts[-1])
    return prompts[:NUM_IMAGES]


# ---- DB helpers ----

def _db_conn(db_url: str):
    import psycopg2
    return psycopg2.connect(db_url)


def lookup_character_id(idx: int, db_url: str) -> str:
    """Returns Character.id matching persona index idx, or empty string if not found."""
    if not db_url:
        return ""
    try:
        conn = _db_conn(db_url)
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
        label = (db_url[:40] + "...") if len(db_url) > 40 else db_url
        print(f"  [warn] DB lookup failed for persona {idx} ({label}): {exc}")
        return ""


def _write_media_rows(character_id: str, s3_keys: list, db_url: str, label: str) -> int:
    """
    Inserts CharacterMedia rows for s3_keys into db_url.
    First image is new primary (demotes existing primary first).
    Prints a result line per DB, never silently skips.
    """
    if not s3_keys:
        print(f"  [{label}] skipped -- no S3 keys to write")
        return 0
    if not character_id:
        print(f"  [{label}] WARNING -- character not found in {label} DB, cannot save {len(s3_keys)} images")
        return 0
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
        print(f"  [{label}] {inserted} rows written (character {character_id[:8]}...)")
        return inserted
    except Exception as exc:
        db_short = (db_url[:40] + "...") if len(db_url) > 40 else db_url
        print(f"  [{label}] ERROR writing to DB ({db_short}): {exc}")
        return 0


def collect_s3_keys(idx: int, num_prompts: int) -> list:
    """Reads manifests from persona-output-v2/{idx}_p{1..num_prompts}/manifest.json."""
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
            pass
    return s3_keys


def save_to_both_dbs(idx: int, local_char_id: str, prod_char_id: str, num_prompts: int):
    """Saves generated S3 keys to both local and prod DBs. Always prints results."""
    s3_keys = collect_s3_keys(idx, num_prompts)
    if not s3_keys:
        print(f"  [db] No successful S3 keys found across {num_prompts} prompt manifests")
        return

    print(f"  [db] {len(s3_keys)} S3 key(s) to save: {[k.split('/')[-1][:16]+'...' for k in s3_keys]}")

    if DATABASE_URL:
        _write_media_rows(local_char_id, s3_keys, DATABASE_URL, "local-db")
    else:
        print("  [local-db] skipped -- DATABASE_URL not set")

    if PROD_DATABASE_URL and PROD_DATABASE_URL != DATABASE_URL:
        _write_media_rows(prod_char_id, s3_keys, PROD_DATABASE_URL, "prod-db")
    elif PROD_DATABASE_URL == DATABASE_URL:
        print("  [prod-db] skipped -- same as local DB")
    else:
        print("  [prod-db] skipped -- PROD_DATABASE_URL not set")


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

def generate_persona(idx: int, image_path: str, reformed_prompts: list, dry_run: bool) -> bool:
    if dry_run:
        print(f"  [dry-run] {len(reformed_prompts)} reformed prompts:")
        for j, p in enumerate(reformed_prompts, 1):
            reform_labels = ["scene/setting", "outfit/attire", "lighting/time", "mood/expression", "camera angle"]
            label = reform_labels[j - 1] if j <= len(reform_labels) else f"reform {j}"
            print(f"    {j} [{label}]: {p[:100]}...")
        return True

    try:
        img_name = upload_image(COMFYUI_IP, image_path)
        print(f"  uploaded reference -> {img_name}")
    except Exception as exc:
        print(f"  [error] ComfyUI upload failed: {exc}")
        return False

    reform_labels = ["scene", "outfit", "lighting", "mood", "angle"]
    for j, prompt in enumerate(reformed_prompts, 1):
        label = reform_labels[j - 1] if j <= len(reform_labels) else f"p{j}"
        print(f"  [{j}/{len(reformed_prompts)}] reform={label}: {prompt[:70]}...")
        prompt_id = f"{idx}_p{j}"
        env = {
            **os.environ,
            "VARIANTS_PER_PROMPT": "1",
            "POPPY_S3_BUCKET_GENERATED": S3_BUCKET,
            "POPPY_CHARACTER_ID": "",  # DB handled by save_to_both_dbs after all manifests
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
            print(f"  [warn] pipeline non-zero for persona {idx} reform {j} ({label})")

    return True


# ---- Main ----

def main():
    parser = argparse.ArgumentParser(description="Bulk image generator v2: two-stage Stheno reform pipeline")
    parser.add_argument("--start", type=int, default=1, help="Start persona index (ignored if --ids set)")
    parser.add_argument("--end", type=int, default=143, help="End persona index inclusive (ignored if --ids set)")
    parser.add_argument("--ids", type=str, default="",
                        help="Comma-separated specific persona indices, e.g. --ids 1,3,7")
    parser.add_argument("--dry-run", action="store_true",
                        help="Run both Stheno stages and print reformed prompts, skip image generation")
    args = parser.parse_args()

    # Validate required env vars
    if not STHENO_URL:
        sys.exit("ERROR: STHENO_URL is not set (e.g. http://<gpu-ip>:11434/api/generate)")
    if not args.dry_run and not COMFYUI_IP:
        sys.exit("ERROR: COMFYUI_IP is not set")
    if not args.dry_run and not S3_BUCKET:
        sys.exit("ERROR: POPPY_S3_BUCKET_GENERATED is required (no local-only fallback in v2)")

    # Load prompt templates
    for fpath, label in [(BASE_PROMPT_FILE, "stheno-base-prompt.txt"), (REFORM_PROMPT_FILE, "stheno-reform-prompt.txt")]:
        if not os.path.exists(fpath):
            sys.exit(f"ERROR: {label} not found at {fpath}")
    with open(BASE_PROMPT_FILE, "r", encoding="utf-8") as f:
        base_template = f.read()
    with open(REFORM_PROMPT_FILE, "r", encoding="utf-8") as f:
        reform_template = f.read()

    # Parse persona list
    print("[v2] Parsing persona list...")
    personas = parse_persona_list(PERSONA_LIST_MD)
    print(f"[v2] {len(personas)} personas loaded from persona-list.md")

    # Resolve target indices
    if args.ids:
        try:
            indices = [int(x.strip()) for x in args.ids.split(",") if x.strip()]
        except ValueError:
            sys.exit("ERROR: --ids must be comma-separated integers, e.g. --ids 1,3,7")
    else:
        indices = list(range(args.start, args.end + 1))

    valid_indices = [i for i in indices if i in personas and find_persona_image(i)]
    skipped = [i for i in indices if i not in personas or not find_persona_image(i)]
    if skipped:
        print(f"[v2] Skipping {len(skipped)} indices (not in persona list or no image): {skipped}")

    print(f"[v2] Processing {len(valid_indices)} persona(s): {valid_indices}")
    print(f"[v2] Stheno endpoint: {STHENO_URL}  model: {STHENO_MODEL}")
    print(f"[v2] Pipeline: base-prompt -> reform x{NUM_IMAGES} -> {NUM_IMAGES} images each")
    print(f"[v2] Output dir: {OUT_DIR}")
    if DATABASE_URL:
        print(f"[v2] local-db: {DATABASE_URL[:50]}...")
    if PROD_DATABASE_URL:
        print(f"[v2] prod-db:  {PROD_DATABASE_URL[:50]}...")
    print()

    if not args.dry_run:
        print(f"[v2] Checking ComfyUI at {COMFYUI_IP}:8188...")
        if not wait_for_comfyui(COMFYUI_IP):
            sys.exit(f"ERROR: ComfyUI not reachable at {COMFYUI_IP}:8188")
        print("[v2] ComfyUI ready")
        print()

    os.makedirs(OUT_DIR, exist_ok=True)

    done = 0
    for idx in valid_indices:
        p = personas[idx]
        name, location, bio = p["name"], p["location"], p["bio"]

        image_path = find_persona_image(idx)
        local_char_id = lookup_character_id(idx, DATABASE_URL)
        prod_char_id = lookup_character_id(idx, PROD_DATABASE_URL) if PROD_DATABASE_URL else ""

        local_status = f"ok:{local_char_id[:8]}" if local_char_id else "NOT FOUND"
        prod_status = (f"ok:{prod_char_id[:8]}" if prod_char_id else "NOT FOUND") if PROD_DATABASE_URL else "no prod-db"

        print(f"[{idx}] {name} ({location})")
        print(f"  local-db={local_status}  prod-db={prod_status}")

        # Stage 1: Generate base appearance prompt
        print(f"  [stage-1] Stheno generating base prompt...")
        try:
            base_prompt = generate_base_prompt(name, location, bio, base_template)
            print(f"  [stage-1] base: {base_prompt[:100]}...")
        except Exception as exc:
            print(f"  [error] Stage 1 (base prompt) failed: {exc}")
            print()
            continue

        # Stage 2: Reform 5 parts from the base prompt
        print(f"  [stage-2] Stheno reforming {NUM_IMAGES} prompt parts...")
        try:
            reformed_prompts = reform_prompts(base_prompt, reform_template)
            print(f"  [stage-2] {len(reformed_prompts)} reformed prompts ready")
        except Exception as exc:
            print(f"  [error] Stage 2 (reform) failed: {exc}")
            print()
            continue

        # Generate images
        if generate_persona(idx, image_path, reformed_prompts, args.dry_run):
            done += 1
            if not args.dry_run:
                save_to_both_dbs(idx, local_char_id, prod_char_id, len(reformed_prompts))

        print()

    print(f"[v2] Complete: {done}/{len(valid_indices)} personas processed ({done * NUM_IMAGES} images total)")
    if not args.dry_run and S3_BUCKET:
        print(f"[v2] Images uploaded to s3://{S3_BUCKET}/images/")


if __name__ == "__main__":
    main()
