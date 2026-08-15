#!/usr/bin/env python3
"""
quality_filter.py  --  Zero-cost image quality filter.

Uses ONLY existing infrastructure (no paid APIs):
  1. Pillow Laplacian variance    -- blur detection (local, instant)
  2. ComfyUI face_yolov8m.pt      -- face presence check (GPU box, YOLO)
     Workflow: LoadImage -> UltralyticsDetectorProvider -> BboxDetectorCombined_v2
               -> MaskToImage -> PreviewImage
     If mask is all black: no face detected = distorted or missing face.

Scans all generated CharacterMedia rows (kind=image, url not starting with /)
and reports which images fail. With --delete, removes them from S3 + DB.

Usage (dry-run, just prints report):
  ./.venv/bin/python3 quality_filter.py

Usage (actually delete):
  ./.venv/bin/python3 quality_filter.py --delete

Options:
  --comfyui-ip IP       GPU box IP (default: $COMFYUI_IP or 51.20.178.118)
  --bucket NAME         S3 bucket  (default: $POPPY_S3_BUCKET_GENERATED or poppy-generated)
  --blur-threshold N    Laplacian variance below this = blurry (default: 60)
  --face-threshold N    mask max-pixel below this (0-255) = no face (default: 10)
  --limit N             max images to scan (default: all)
  --character-id ID     scope to one character only
  --skip-face           skip face check (blur only, faster)
  --delete              delete failing images from S3 + DB

Requires (in .venv):  Pillow, numpy, boto3, psycopg2-binary, requests
  Install: .venv/bin/pip install Pillow numpy

DATABASE_URL is auto-loaded from ../../backend/.env if not in environment.
"""

import argparse
import io
import json
import os
import sys
import time
import uuid
from pathlib import Path

try:
    from PIL import Image
    import numpy as np
except ImportError:
    sys.exit("Missing deps. Run: .venv/bin/pip install Pillow numpy")

import boto3
import psycopg2
import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HERE = Path(__file__).parent
REPO_ROOT = HERE.parents[1]


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


_load_dotenv(REPO_ROOT / "backend" / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL", "")
S3_BUCKET = os.environ.get("POPPY_S3_BUCKET_GENERATED", "poppy-generated")
AWS_REGION = os.environ.get("AWS_REGION", "eu-north-1")
DEFAULT_COMFYUI = os.environ.get("COMFYUI_IP", "51.20.178.118")

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args():
    p = argparse.ArgumentParser(description="Quality filter for generated images")
    p.add_argument("--comfyui-ip", default=DEFAULT_COMFYUI)
    p.add_argument("--bucket", default=S3_BUCKET)
    p.add_argument("--blur-threshold", type=float, default=60.0)
    p.add_argument("--face-threshold", type=int, default=10,
                   help="mask max pixel (0-255) below this = no face detected")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--character-id", default=None)
    p.add_argument("--skip-face", action="store_true",
                   help="skip ComfyUI face check (blur only)")
    p.add_argument("--delete", action="store_true",
                   help="delete failing images from S3 + DB (default: report only)")
    return p.parse_args()

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


def get_db():
    if not DATABASE_URL:
        sys.exit("ERROR: DATABASE_URL not set and not found in backend/.env")
    return psycopg2.connect(DATABASE_URL)


def get_generated_images(conn, character_id=None, limit=None):
    cur = conn.cursor()
    sql = """
        SELECT m.id, m."characterId", m.url, m."isPrimary", m."isDisplay", c.name
        FROM   "CharacterMedia" m
        JOIN   "Character"      c ON c.id = m."characterId"
        WHERE  m.kind  = 'image'
          AND  m.url  != ''
          AND  m.url  NOT LIKE '/%%'
          AND  m.url  NOT LIKE 'http://%%'
    """
    params: list = []
    if character_id:
        sql += ' AND m."characterId" = %s'
        params.append(character_id)
    sql += ' ORDER BY m."characterId", m.sort'
    if limit:
        sql += f" LIMIT {int(limit)}"
    cur.execute(sql, params)
    rows = cur.fetchall()
    cur.close()
    return rows  # (id, characterId, url, isPrimary, isDisplay, characterName)


def delete_from_db(conn, media_id: str, character_id: str, is_primary: bool, is_display: bool) -> None:
    cur = conn.cursor()
    cur.execute('DELETE FROM "CharacterMedia" WHERE id = %s', (media_id,))

    # Promote the next image to primary / display if the deleted one held those flags
    if is_primary:
        cur.execute("""
            UPDATE "CharacterMedia"
            SET    "isPrimary" = true
            WHERE  id = (
                SELECT id FROM "CharacterMedia"
                WHERE  "characterId" = %s AND kind = 'image'
                ORDER  BY sort
                LIMIT  1
            )
        """, (character_id,))

    if is_display:
        cur.execute("""
            UPDATE "CharacterMedia"
            SET    "isDisplay" = true
            WHERE  id = (
                SELECT id FROM "CharacterMedia"
                WHERE  "characterId" = %s AND kind = 'image'
                ORDER  BY sort
                LIMIT  1
            )
        """, (character_id,))

    conn.commit()
    cur.close()

# ---------------------------------------------------------------------------
# S3
# ---------------------------------------------------------------------------


def s3_download(key: str, bucket: str) -> bytes:
    s3 = boto3.client("s3", region_name=AWS_REGION)
    obj = s3.get_object(Bucket=bucket, Key=key)
    return obj["Body"].read()


def s3_delete(key: str, bucket: str) -> None:
    s3 = boto3.client("s3", region_name=AWS_REGION)
    s3.delete_object(Bucket=bucket, Key=key)

# ---------------------------------------------------------------------------
# Blur check (Laplacian variance, no GPU needed)
# ---------------------------------------------------------------------------


def check_blur(img_bytes: bytes, threshold: float) -> tuple[float, bool]:
    img = Image.open(io.BytesIO(img_bytes)).convert("L")
    arr = np.array(img, dtype=np.float64)
    # Laplacian via finite differences (no scipy needed)
    lap = (
        arr[:-2, 1:-1]
        + arr[2:, 1:-1]
        + arr[1:-1, :-2]
        + arr[1:-1, 2:]
        - 4.0 * arr[1:-1, 1:-1]
    )
    variance = float(np.var(lap))
    return variance, variance >= threshold

# ---------------------------------------------------------------------------
# ComfyUI face check
# ---------------------------------------------------------------------------

FACE_WORKFLOW = {
    "node_load": {
        "class_type": "LoadImage",
        "inputs": {"image": "__FILENAME__", "upload": "image"},
    },
    "node_detector": {
        "class_type": "UltralyticsDetectorProvider",
        "inputs": {"model_name": "bbox/face_yolov8m.pt"},
    },
    "node_bbox": {
        "class_type": "BboxDetectorCombined_v2",
        "inputs": {
            "bbox_detector": ["node_detector", 0],
            "image": ["node_load", 0],
            "threshold": 0.35,
            "dilation": 4,
        },
    },
    "node_mask2img": {
        "class_type": "MaskToImage",
        "inputs": {"mask": ["node_bbox", 0]},
    },
    "node_preview": {
        "class_type": "PreviewImage",
        "inputs": {"images": ["node_mask2img", 0]},
    },
}


def _comfyui_upload(ip: str, img_bytes: bytes, fname: str) -> str:
    """Upload image bytes to ComfyUI input folder. Returns the filename as stored."""
    resp = requests.post(
        f"http://{ip}:8188/upload/image",
        files={"image": (fname, img_bytes, "image/png")},
        data={"overwrite": "true"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["name"]


def _comfyui_queue(ip: str, workflow: dict) -> str:
    resp = requests.post(
        f"http://{ip}:8188/prompt",
        json={"prompt": workflow},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["prompt_id"]


def _comfyui_poll(ip: str, prompt_id: str, timeout: int = 60) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.get(f"http://{ip}:8188/history/{prompt_id}", timeout=10)
        if r.status_code == 200:
            data = r.json()
            if prompt_id in data:
                return data[prompt_id]
        time.sleep(2)
    raise TimeoutError(f"ComfyUI did not finish prompt {prompt_id} within {timeout}s")


def _comfyui_get_preview(ip: str, history_entry: dict) -> bytes | None:
    """Pull the first PreviewImage output from the history entry."""
    outputs = history_entry.get("outputs", {})
    for node_out in outputs.values():
        images = node_out.get("images", [])
        for img_ref in images:
            fname = img_ref.get("filename")
            ftype = img_ref.get("type", "output")
            if fname:
                r = requests.get(
                    f"http://{ip}:8188/view",
                    params={"filename": fname, "type": ftype},
                    timeout=15,
                )
                if r.status_code == 200:
                    return r.content
    return None


def check_face(img_bytes: bytes, ip: str, threshold: int) -> tuple[bool, str]:
    """
    Returns (face_found, detail_string).
    Uploads image to ComfyUI, runs YOLO face detection, reads mask.
    All-black mask = no face detected.
    """
    uid = uuid.uuid4().hex[:8]
    fname = f"qf_{uid}.png"

    # Convert to PNG bytes for lossless upload
    buf = io.BytesIO()
    Image.open(io.BytesIO(img_bytes)).save(buf, format="PNG")
    png_bytes = buf.getvalue()

    try:
        uploaded = _comfyui_upload(ip, png_bytes, fname)
    except Exception as exc:
        return True, f"upload_error:{exc}"  # skip on error, don't flag

    wf = json.loads(json.dumps(FACE_WORKFLOW).replace("__FILENAME__", uploaded))

    try:
        pid = _comfyui_queue(ip, wf)
    except Exception as exc:
        return True, f"queue_error:{exc}"

    try:
        history = _comfyui_poll(ip, pid, timeout=90)
    except TimeoutError as exc:
        return True, f"timeout:{exc}"

    mask_bytes = _comfyui_get_preview(ip, history)
    if mask_bytes is None:
        return True, "no_preview_output"  # can't determine, skip

    mask_img = Image.open(io.BytesIO(mask_bytes)).convert("L")
    max_pixel = int(np.array(mask_img).max())
    face_found = max_pixel > threshold
    return face_found, f"mask_max={max_pixel}"

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

PASS = "PASS"
FAIL = "FAIL"
SKIP = "SKIP"


def fmt(val, width=22):
    s = str(val)
    return s[:width].ljust(width)


def main():
    args = parse_args()

    print("[quality_filter] Connecting to DB...")
    conn = get_db()
    rows = get_generated_images(conn, character_id=args.character_id, limit=args.limit)
    print(f"[quality_filter] {len(rows)} generated images to scan")
    print(f"  blur threshold : {args.blur_threshold}")
    print(f"  face threshold : {args.face_threshold} (mask max pixel)")
    print(f"  comfyui        : {args.comfyui_ip}")
    print(f"  bucket         : {args.bucket}")
    print(f"  delete mode    : {'YES -- will delete failing images' if args.delete else 'no (dry run)'}")
    print()

    header = (
        f"{'#':<5} {'character':<18} {'url_tail':<28} "
        f"{'blur':>8} {'blur?':>6} {'face?':>6} {'action':<10}"
    )
    print(header)
    print("-" * len(header))

    results = []
    for i, (mid, char_id, url, is_primary, is_display, char_name) in enumerate(rows, 1):
        url_tail = url[-28:] if len(url) > 28 else url

        # -- download from S3 --
        try:
            img_bytes = s3_download(url, args.bucket)
        except Exception as exc:
            print(f"{i:<5} {char_name:<18} {url_tail:<28} {'ERROR':>8} {'?':>6} {'?':>6} SKIP  ({exc})")
            continue

        # -- blur --
        blur_score, blur_ok = check_blur(img_bytes, args.blur_threshold)

        # -- face --
        if args.skip_face:
            face_ok, face_detail = True, "skipped"
        else:
            face_ok, face_detail = check_face(img_bytes, args.comfyui_ip, args.face_threshold)

        passes = blur_ok and face_ok
        reasons = []
        if not blur_ok:
            reasons.append(f"blurry(score={blur_score:.1f})")
        if not face_ok:
            reasons.append(f"no_face({face_detail})")

        action = PASS if passes else FAIL
        print(
            f"{i:<5} {char_name[:18]:<18} {url_tail:<28} "
            f"{blur_score:>8.1f} {'ok' if blur_ok else 'BLUR':>6} "
            f"{'ok' if face_ok else 'NFACE':>6} {action:<10}"
            + (f"  ({', '.join(reasons)})" if reasons else "")
        )

        results.append({
            "id": mid, "char_id": char_id, "url": url,
            "is_primary": is_primary, "is_display": is_display,
            "passes": passes, "reasons": reasons,
        })

    # -- summary --
    total = len(results)
    failing = [r for r in results if not r["passes"]]
    print()
    print(f"Summary: {total} scanned, {len(failing)} failing, {total - len(failing)} passing")

    if not failing:
        print("All images pass. Nothing to delete.")
        conn.close()
        return

    print()
    print("Failing images:")
    for r in failing:
        print(f"  {r['url']}  ({', '.join(r['reasons'])})")

    if not args.delete:
        print()
        print("Dry run -- pass --delete to remove the above from S3 + DB.")
        conn.close()
        return

    # -- delete --
    print()
    print(f"Deleting {len(failing)} images from S3 + DB...")
    deleted = 0
    for r in failing:
        try:
            s3_delete(r["url"], args.bucket)
            print(f"  S3 deleted  : {r['url']}")
        except Exception as exc:
            print(f"  S3 error    : {r['url']}  ({exc})")

        try:
            delete_from_db(conn, r["id"], r["char_id"], r["is_primary"], r["is_display"])
            print(f"  DB deleted  : {r['id']}  (char={r['char_id'][:8]})")
            deleted += 1
        except Exception as exc:
            print(f"  DB error    : {r['id']}  ({exc})")
            conn.rollback()

    print()
    print(f"Done: {deleted}/{len(failing)} deleted from S3 + DB.")
    conn.close()


if __name__ == "__main__":
    main()
