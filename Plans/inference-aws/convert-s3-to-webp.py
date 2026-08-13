#!/usr/bin/env python3
"""
Convert all JPEG/PNG images in one or more S3 buckets to WebP in-place.

Each image is downloaded, converted with Pillow (quality=85), and re-uploaded
with a .webp extension. The original file is deleted only when --delete-original
is passed. A manifest is written to ./webp-conversion-manifest.json so you can
track what was processed.

Requirements:
    pip install boto3 Pillow

Usage:
    # Dry run (no changes to S3):
    python convert-s3-to-webp.py --bucket poppy-uploads-123456 --dry-run

    # Convert and keep originals:
    python convert-s3-to-webp.py --bucket poppy-uploads-123456

    # Convert and delete originals after successful upload:
    python convert-s3-to-webp.py --bucket poppy-uploads-123456 --delete-original

    # Run on all three buckets:
    python convert-s3-to-webp.py \
        --bucket poppy-uploads-123456 \
        --bucket poppy-generated-123456 \
        --bucket poppy-videos-123456

Environment:
    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (or aws configure).
    S3_BUCKET can be used instead of --bucket if only one bucket is needed.
"""

import argparse
import io
import json
import os
import sys
import time
from pathlib import Path

try:
    import boto3
except ImportError:
    print("ERROR: boto3 not installed. Run: pip install boto3")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow not installed. Run: pip install Pillow")
    sys.exit(1)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff"}
WEBP_QUALITY = 85
MANIFEST_FILE = Path(__file__).parent / "webp-conversion-manifest.json"


def convert_to_webp(data: bytes, original_key: str) -> bytes:
    img = Image.open(io.BytesIO(data))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=WEBP_QUALITY, method=4)
    out.seek(0)
    return out.read()


def webp_key(key: str) -> str:
    stem = key.rsplit(".", 1)[0] if "." in key.split("/")[-1] else key
    return f"{stem}.webp"


def process_bucket(
    s3,
    bucket: str,
    dry_run: bool,
    delete_original: bool,
    manifest: dict,
) -> dict:
    paginator = s3.get_paginator("list_objects_v2")
    converted = 0
    skipped = 0
    failed = 0

    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            ext = Path(key).suffix.lower()
            if ext not in IMAGE_EXTENSIONS:
                skipped += 1
                continue

            new_key = webp_key(key)

            # Skip if already converted and original is gone.
            if key == new_key:
                skipped += 1
                continue

            print(f"  {'[DRY] ' if dry_run else ''}Converting {key} -> {new_key}")

            if dry_run:
                skipped += 1
                continue

            try:
                response = s3.get_object(Bucket=bucket, Key=key)
                original_bytes = response["Body"].read()
                original_size = len(original_bytes)

                webp_bytes = convert_to_webp(original_bytes, key)
                webp_size = len(webp_bytes)
                savings_pct = round((1 - webp_size / original_size) * 100, 1)

                s3.put_object(
                    Bucket=bucket,
                    Key=new_key,
                    Body=webp_bytes,
                    ContentType="image/webp",
                    CacheControl="public, max-age=31536000, immutable",
                )

                entry = {
                    "bucket": bucket,
                    "original_key": key,
                    "webp_key": new_key,
                    "original_bytes": original_size,
                    "webp_bytes": webp_size,
                    "savings_pct": savings_pct,
                    "converted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }

                if delete_original:
                    s3.delete_object(Bucket=bucket, Key=key)
                    entry["original_deleted"] = True

                manifest.setdefault(bucket, []).append(entry)
                converted += 1
                print(f"    {original_size // 1024}KB -> {webp_size // 1024}KB ({savings_pct}% smaller)")

            except Exception as exc:
                print(f"    ERROR: {exc}")
                failed += 1

    return {"converted": converted, "skipped": skipped, "failed": failed}


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert S3 images to WebP")
    parser.add_argument(
        "--bucket",
        action="append",
        dest="buckets",
        metavar="BUCKET",
        help="S3 bucket name (repeat for multiple buckets)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would be converted without making any changes",
    )
    parser.add_argument(
        "--delete-original",
        action="store_true",
        help="Delete the original PNG/JPEG after successful WebP upload",
    )
    args = parser.parse_args()

    buckets = args.buckets or []
    env_bucket = os.environ.get("S3_BUCKET")
    if env_bucket and env_bucket not in buckets:
        buckets.append(env_bucket)

    if not buckets:
        print("ERROR: Provide at least one --bucket name or set the S3_BUCKET env var.")
        parser.print_help()
        sys.exit(1)

    region = os.environ.get("AWS_REGION", "eu-north-1")
    s3 = boto3.client("s3", region_name=region)

    manifest: dict = {}
    if MANIFEST_FILE.exists():
        manifest = json.loads(MANIFEST_FILE.read_text())

    total_converted = 0
    total_skipped = 0
    total_failed = 0

    for bucket in buckets:
        print(f"\n==> Bucket: {bucket}")
        stats = process_bucket(s3, bucket, args.dry_run, args.delete_original, manifest)
        total_converted += stats["converted"]
        total_skipped += stats["skipped"]
        total_failed += stats["failed"]

    if not args.dry_run:
        MANIFEST_FILE.write_text(json.dumps(manifest, indent=2))
        print(f"\nManifest saved to {MANIFEST_FILE}")

    print(
        f"\n==> Done. Converted: {total_converted} | Skipped: {total_skipped} | Failed: {total_failed}"
    )
    if total_failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
