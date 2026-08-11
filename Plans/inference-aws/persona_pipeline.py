#!/usr/bin/env python3
"""
Persona image pipeline (InstantID + Juggernaut XL / ComfyUI).

Given a persona's reference image (already uploaded to ComfyUI) and a list of
prompts, generate one variant per prompt that KEEPS THE SAME FACE while the
pose, outfit, and background come entirely from the prompt.

This uses InstantID (not img2img): the reference face is embedded (InsightFace),
locked onto a fresh txt2img generation via the InstantID ip-adapter + a face
ControlNet. That is why pose/background can change freely while identity holds.
Plain img2img could not do this (it re-painted the same composition).

Invoked by generate-persona-images.sh. Uses only the Python stdlib.

argv:
  1  ip                GPU box public IP
  2  persona_id        logical id for this persona (folder + manifest key)
  3  main_image_path   original reference image path (recorded in the manifest)
  4  out_dir           base output directory
  5  uploaded_name     filename of the reference as uploaded to ComfyUI
  6  ckpt              SDXL checkpoint filename (Juggernaut XL)
  7  ip_weight         InstantID identity strength (face lock). ~0.8
  8  cn_strength       face ControlNet strength. LOW (~0.35) lets the head turn
                       and be framed freely; HIGH copies the reference head
                       orientation/position (and crops it).
  9  end_at            fraction of steps the ControlNet stays active (~0.75).
                       Releasing it early lets pose/lighting/framing settle.
  10 steps             sampler steps
  11 cfg               classifier-free guidance
  12 sampler           sampler_name (e.g. dpmpp_2m)
  13 scheduler         scheduler (e.g. karras)
  14 negative          negative prompt (safety already appended)
  15 quality_prefix    prepended to every positive prompt
  16+ prompts          one positive prompt per variant
"""
import hashlib
import json
import os
import random
import sys
import time
import urllib.request
import uuid
import requests
import boto3

ip = sys.argv[1]
persona_id = sys.argv[2]
main_image_path = sys.argv[3]
out_dir = sys.argv[4]
uploaded_name = sys.argv[5]
ckpt = sys.argv[6]
ip_weight = float(sys.argv[7])
cn_strength = float(sys.argv[8])
end_at = float(sys.argv[9])
steps = int(sys.argv[10])
cfg = float(sys.argv[11])
sampler = sys.argv[12]
scheduler = sys.argv[13]
negative = sys.argv[14]
quality_prefix = sys.argv[15]
prompts = sys.argv[16:]

# 9:16 vertical frame (mobile/reel aspect). Taller canvas gives the room needed
# to fit the whole body head-to-toe with padding above the head and below the
# feet, so heads/hands do not get cropped.
WIDTH = 768
HEIGHT = 1344

# Face pose: cn_strength=0 removes the ControlNet keypoint lock so the head
# can rotate freely. Identity is kept by ip_weight (ArcFace embedding) plus
# PoppyFaceSwap (inswapper) which copies the exact reference face after
# KSampler. Each variant cycles to a different pose descriptor so generated
# images look in different directions instead of all copying the reference angle.
POSE_PREFIXES = [
    "looking directly at camera",
    "looking slightly to the left, relaxed",
    "looking slightly to the right, candid",
    "three-quarter view turning right",
    "three-quarter view turning left",
    "glancing over shoulder",
]

VARIANTS_PER_PROMPT = 4

S3_BUCKET = os.environ.get("POPPY_S3_BUCKET_GENERATED", "")
AWS_REGION_PIPELINE = os.environ.get("AWS_REGION", "eu-north-1")
# CF_URL line removed -- no longer needed, gallery stores bare s3Key
API_BASE = os.environ.get("POPPY_API_BASE_URL", "http://localhost:4000")
CHARACTER_ID = os.environ.get("POPPY_CHARACTER_ID", "")
API_TOKEN = os.environ.get("POPPY_API_TOKEN", "")

_s3 = None

def get_s3():
    global _s3
    if _s3 is None and S3_BUCKET:
        _s3 = boto3.client("s3", region_name=AWS_REGION_PIPELINE)
    return _s3


def upload_image_to_s3(local_path: str) -> str:
    """Upload a PNG to S3 and return the s3Key."""
    s3 = get_s3()
    if not s3 or not S3_BUCKET:
        return ""
    key = f"images/{uuid.uuid4()}.png"
    try:
        with open(local_path, "rb") as fh:
            s3.put_object(Bucket=S3_BUCKET, Key=key, Body=fh.read(), ContentType="image/png")
        return key
    except Exception as exc:
        print(f"  [warn] S3 upload failed: {exc}")
        return ""


def save_to_db(s3_key: str, is_primary: bool) -> bool:
    """Create a CharacterMedia row via the app API."""
    if not CHARACTER_ID or not API_BASE or not s3_key:
        return False
    try:
        resp = requests.post(
            f"{API_BASE}/api/characters/{CHARACTER_ID}/gallery",
            json={"url": s3_key, "kind": "image", "isPrimary": is_primary},
            headers={"Authorization": f"Bearer {API_TOKEN}"},
            timeout=10,
        )
        return resp.ok
    except Exception as exc:
        print(f"  [warn] DB save failed: {exc}")
        return False


# InstantID model file names as ComfyUI sees them (mounted on the box).
INSTANTID_FILE = "ip-adapter.bin"
CONTROLNET_FILE = "instantid_control.safetensors"

BASE = f"http://{ip}:8188"
persona_dir = os.path.join(out_dir, persona_id)
os.makedirs(persona_dir, exist_ok=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_workflow(positive, seed, prefix):
    # InstantID txt2img graph:
    #   CheckpointLoader -> (model, clip, vae)
    #   LoadImage(reference) -> InstantIDFaceAnalysis embeds the face
    #   ApplyInstantID(ip-adapter + face ControlNet) patches model + conditioning
    #   KSampler(denoise 1.0) generates a brand-new scene with the locked face
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": WIDTH, "height": HEIGHT, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["4", 1]}},
        "10": {"class_type": "LoadImage", "inputs": {"image": uploaded_name}},
        "20": {"class_type": "InstantIDModelLoader", "inputs": {"instantid_file": INSTANTID_FILE}},
        "21": {"class_type": "InstantIDFaceAnalysis", "inputs": {"provider": "CPU"}},
        "22": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": CONTROLNET_FILE}},
        "23": {
            "class_type": "ApplyInstantIDAdvanced",
            "inputs": {
                "instantid": ["20", 0],
                "insightface": ["21", 0],
                "control_net": ["22", 0],
                "image": ["10", 0],
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "ip_weight": ip_weight,      # identity (face) strength
                "cn_strength": cn_strength,  # LOW = head can turn, better framing
                "start_at": 0.0,
                "end_at": end_at,            # release ControlNet before the end
                "noise": 0.0,
                "combine_embeds": "average",
            },
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed, "steps": steps, "cfg": cfg,
                "sampler_name": sampler, "scheduler": scheduler, "denoise": 1.0,
                "model": ["23", 0], "positive": ["23", 1], "negative": ["23", 2],
                "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        # Face swap + high-res restore (in the node): inswapper copies the EXACT
        # reference face (node 10), then GPEN-BFR-512 restores it to a crisp
        # 512px face so it matches the sharpness of the rest of the image. GPEN
        # is the final face op (kept last) for maximum clarity.
        "50": {"class_type": "PoppyFaceSwap",
               "inputs": {"target_image": ["8", 0], "source_image": ["10", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["50", 0]}},
    }


def submit(workflow):
    data = json.dumps({"prompt": workflow, "client_id": "persona-pipeline"}).encode()
    req = urllib.request.Request(f"{BASE}/prompt", data=data, headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]


def wait_image(pid, timeout=360):
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(3)
        try:
            hist = json.load(urllib.request.urlopen(f"{BASE}/history/{pid}", timeout=15))
        except Exception:
            continue
        rec = hist.get(pid)
        if not rec:
            continue
        st = rec.get("status", {})
        if any(m[0] == "execution_error" for m in st.get("messages", [])):
            msgs = [m for m in st.get("messages", []) if m[0] == "execution_error"]
            raise RuntimeError(json.dumps(msgs)[:800])
        outs = rec.get("outputs")
        if outs:
            for node in outs.values():
                if node.get("images"):
                    return node["images"][0]
    return None


def download(img, dest):
    url = (f"{BASE}/view?filename={img['filename']}"
           f"&subfolder={img.get('subfolder','')}&type={img.get('type','output')}")
    with urllib.request.urlopen(url, timeout=60) as r, open(dest, "wb") as f:
        f.write(r.read())


manifest = {
    "persona_id": persona_id,
    "main_image": os.path.abspath(main_image_path),
    "main_image_sha256": sha256(main_image_path),
    "method": "instantid+facedetailer+faceswap",
    "checkpoint": ckpt,
    "params": {"ip_weight": ip_weight, "cn_strength": cn_strength, "end_at": end_at,
               "steps": steps, "cfg": cfg, "sampler": sampler, "scheduler": scheduler,
               "width": WIDTH, "height": HEIGHT},
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "variants": [],
}

print(f"[persona {persona_id}] {len(prompts)} prompt(s) x {VARIANTS_PER_PROMPT} variants = {len(prompts) * VARIANTS_PER_PROMPT} images. Face from {uploaded_name}")
first_saved = not bool(CHARACTER_ID)  # skip isPrimary if no character ID

for i, prompt in enumerate(prompts, start=1):
    for v in range(1, VARIANTS_PER_PROMPT + 1):
        seed = random.randint(1, 2_000_000_000)
        pose_index = (i - 1) * VARIANTS_PER_PROMPT + (v - 1)
        pose = POSE_PREFIXES[pose_index % len(POSE_PREFIXES)]
        positive = pose + ", " + quality_prefix + prompt
        prefix = f"{persona_id}_p{i}_v{v}"
        print(f"  (p{i} v{v}/{VARIANTS_PER_PROMPT}) seed={seed} pose={pose[:30]}")
        try:
            pid = submit(build_workflow(positive, seed, prefix))
            img = wait_image(pid)
        except Exception as e:
            print(f"  FAILED: {e}")
            manifest["variants"].append({"index": i, "variant": v, "prompt": prompt, "seed": seed, "file": None, "status": "error"})
            continue
        if not img:
            print(f"  FAILED (timeout)")
            manifest["variants"].append({"index": i, "variant": v, "prompt": prompt, "seed": seed, "file": None, "status": "timeout"})
            continue
        dest_name = f"variant-p{i}-v{v}.png"
        dest = os.path.join(persona_dir, dest_name)
        download(img, dest)
        size = os.path.getsize(dest)
        s3_key = upload_image_to_s3(dest)
        is_primary = (not first_saved)
        if is_primary:
            first_saved = True  # designate as primary before the API call
        db_ok = save_to_db(s3_key, is_primary)
        if is_primary and not db_ok:
            print("  [warn] primary image save failed -- character may have no isPrimary image set")
        print(f"  saved {dest_name} ({size} bytes) s3={'ok' if s3_key else 'skipped'} db={'ok' if db_ok else 'skipped'}")
        manifest["variants"].append({
            "index": i, "variant": v, "prompt": prompt, "seed": seed, "pose": pose,
            "file": dest_name, "s3Key": s3_key,
            "references_main_image": manifest["main_image"],
            "status": "ok", "bytes": size,
        })

with open(os.path.join(persona_dir, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)

ok = sum(1 for v in manifest["variants"] if v["status"] == "ok")
print(f"[persona {persona_id}] done: {ok}/{len(prompts) * VARIANTS_PER_PROMPT} saved to {persona_dir}/")
