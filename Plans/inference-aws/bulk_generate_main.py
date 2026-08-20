#!/usr/bin/env python3
"""
Bulk MAIN image generator: exactly one image per character.

Purpose (locked decision, Plans/cursor-prompt/35-major-fixes-batch.md #C):
  Produce one fresh image per character (144 total when --all is passed),
  upload to S3, and emit a manifest that the TS promoter
  (packages/database/prisma/promote-main-images.ts) then uses to atomically
  set isMain on the new row and demote every prior image on that character
  to secondary.

Reuses the two-stage Stheno + ComfyUI + persona_pipeline plumbing from
bulk_generate_v2.py. NUM_IMAGES is pinned to 1 here.

CRITICAL: this script does NOT itself write CharacterMedia rows. It only
uploads to S3 and writes a manifest. The DB mutation is a separate TS step
so the "exactly one isMain per character" invariant lives next to the Prisma
schema (see plan #C step 2).

Usage:
  ./.venv/bin/python3 bulk_generate_main.py --all
  ./.venv/bin/python3 bulk_generate_main.py --ids 1,2,5
  ./.venv/bin/python3 bulk_generate_main.py --from-file main-image-list.txt

  --dry-run           Print the plan (persona ids + prompts) without calling
                      the GPU or uploading to S3. Fails loud if the GPU box
                      is unreachable.
  --manifest-out PATH Write the manifest JSON to PATH (default:
                      main-image-manifest-<yyyymmdd>.json).
"""

# ruff: noqa: E501
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Reuse plumbing from bulk_generate_v2.py so we do not duplicate the Stheno
# call, ComfyUI request, or persona parser. Adding this dir to sys.path
# because the sibling script is not packaged.
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# These names are stable across the v2 script; importing directly keeps
# behavior in lockstep so a fix in v2 propagates here for free.
try:
    from bulk_generate_v2 import (  # type: ignore[import-not-found]
        parse_persona_list,
        generate_base_prompt,
        reform_prompts,
        find_persona_image,
        generate_persona,
        collect_s3_keys,
        BASE_PROMPT_FILE,
        REFORM_PROMPT_FILE,
        S3_BUCKET,
        COMFYUI_IP,
        STHENO_URL,
    )
except ImportError as e:
    # Loud failure: matches the plan's "fail loud" contract when box or S3
    # is unreachable. Missing sibling script means the environment is not
    # what the plan assumes; do not silently limp along.
    print(f"[bulk_main] fatal: cannot import bulk_generate_v2 helpers: {e}", file=sys.stderr)
    sys.exit(2)

REPO_ROOT = os.path.join(HERE, "..", "..")
PERSONA_LIST_MD = os.path.join(REPO_ROOT, "Plans", "persona-list.md")
DEFAULT_INPUT_FILE = os.path.join(HERE, "main-image-list.txt")


def load_ids_from_file(path: str) -> list[int]:
    """Read persona indices from a file, one per line, allowing '#' comments."""
    if not os.path.exists(path):
        print(f"[bulk_main] input file not found: {path}", file=sys.stderr)
        sys.exit(2)
    ids: list[int] = []
    for raw in Path(path).read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        # Support "persona-<n>" or bare integer.
        if line.startswith("persona-"):
            line = line.removeprefix("persona-")
        try:
            ids.append(int(line))
        except ValueError:
            print(f"[bulk_main] ignoring unparseable line: {raw!r}", file=sys.stderr)
    return ids


def preflight_or_die() -> None:
    """Fail loud if the GPU box or S3 bucket is unreachable / unconfigured.

    Matches the plan (#C step 4): the GPU box may be down, and we must
    NEVER silently write partial state. This function returns only on a
    fully healthy environment.
    """
    missing: list[str] = []
    if not S3_BUCKET:
        missing.append("POPPY_S3_BUCKET_GENERATED")
    if not COMFYUI_IP:
        missing.append("COMFYUI_IP")
    if not STHENO_URL:
        missing.append("STHENO_URL")
    if missing:
        print(f"[bulk_main] fatal: required env vars missing: {', '.join(missing)}", file=sys.stderr)
        sys.exit(2)
    # Quick reachability probes (best-effort; the real errors will surface
    # in the pipeline call, but we want to stop early on the obvious cases).
    try:
        import urllib.request

        req = urllib.request.Request(f"http://{COMFYUI_IP}:8188/", method="HEAD")
        urllib.request.urlopen(req, timeout=5)  # noqa: S310
    except Exception as e:  # noqa: BLE001
        print(f"[bulk_main] fatal: ComfyUI unreachable at {COMFYUI_IP}:8188 ({e})", file=sys.stderr)
        sys.exit(2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="Regenerate for every persona in persona-list.md")
    group.add_argument("--ids", type=str, help="Comma-separated persona indices")
    group.add_argument("--from-file", type=str, help=f"Read indices from a file (default: {DEFAULT_INPUT_FILE})")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--manifest-out",
        type=str,
        default=os.path.join(HERE, f"main-image-manifest-{datetime.now(timezone.utc).strftime('%Y%m%d')}.json"),
    )
    args = parser.parse_args()

    personas = parse_persona_list(PERSONA_LIST_MD)
    if args.all:
        ids = sorted(personas.keys())
    elif args.ids:
        ids = [int(x) for x in args.ids.split(",") if x.strip()]
    else:
        ids = load_ids_from_file(args.from_file or DEFAULT_INPUT_FILE)

    if not args.dry_run:
        preflight_or_die()

    # Load the same Stheno prompt templates v2 uses, so a MAIN image is built
    # with the identical two-stage (base -> reform) pipeline. We only keep the
    # first reformed variant (NUM_IMAGES == 1 for this script's purpose).
    for fpath, label in [(BASE_PROMPT_FILE, "stheno-base-prompt.txt"), (REFORM_PROMPT_FILE, "stheno-reform-prompt.txt")]:
        if not os.path.exists(fpath):
            print(f"[bulk_main] fatal: {label} not found at {fpath}", file=sys.stderr)
            sys.exit(2)
    base_template = Path(BASE_PROMPT_FILE).read_text()
    reform_template = Path(REFORM_PROMPT_FILE).read_text()

    manifest: dict = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dryRun": args.dry_run,
        "items": [],
    }
    ok = 0
    failed = 0

    for pid in ids:
        p = personas.get(pid)
        if not p:
            print(f"  [skip] {pid}: not in persona-list.md")
            continue
        seed_key = f"persona-{pid}"

        image_path = find_persona_image(pid)
        if not image_path:
            print(f"  [skip] {pid} {p['name']}: no reference image in frontend/public/personas")
            failed += 1
            continue

        try:
            base = generate_base_prompt(p["name"], p["location"], p["bio"], base_template)
            reformed = reform_prompts(base, reform_template)
            final_prompt = reformed[0] if reformed else base
        except Exception as e:  # noqa: BLE001
            print(f"  [fail] {pid} {p['name']}: prompt gen failed: {e}")
            failed += 1
            continue

        if args.dry_run:
            print(f"  [dry] {pid} {p['name']} ({seed_key}) -> {final_prompt[:100]}")
            manifest["items"].append({"seedKey": seed_key, "personaIndex": pid, "prompt": final_prompt, "s3Key": None})
            ok += 1
            continue

        # Real generation: reuse v2's generate_persona (uploads the reference
        # to ComfyUI, shells out to persona_pipeline.py, uploads the result to
        # S3, and writes OUT_DIR/{pid}_p1/manifest.json). We pass exactly ONE
        # prompt so exactly one image is produced. v2 is imported unchanged.
        print(f"  [gen] {pid} {p['name']} ({seed_key})")
        try:
            gen_ok = generate_persona(pid, image_path, [final_prompt], dry_run=False)
        except Exception as e:  # noqa: BLE001
            print(f"  [fail] {pid} {p['name']}: generation raised: {e}")
            failed += 1
            continue
        if not gen_ok:
            print(f"  [fail] {pid} {p['name']}: generate_persona reported failure")
            failed += 1
            continue

        # The pipeline chose the real S3 key; read it back from the manifest
        # (num_prompts == 1). This is the key the TS promoter will set isMain on.
        s3_keys = collect_s3_keys(pid, 1)
        if not s3_keys:
            print(f"  [fail] {pid} {p['name']}: no S3 key in manifest after generation")
            failed += 1
            continue
        s3_key = s3_keys[0]
        print(f"    -> s3://{S3_BUCKET}/{s3_key}")
        manifest["items"].append({"seedKey": seed_key, "personaIndex": pid, "prompt": final_prompt, "s3Key": s3_key})
        ok += 1

    manifest_path = args.manifest_out
    Path(manifest_path).write_text(json.dumps(manifest, indent=2))
    print(f"[bulk_main] done: ok={ok}, failed={failed}, manifest={manifest_path}")


if __name__ == "__main__":
    main()
