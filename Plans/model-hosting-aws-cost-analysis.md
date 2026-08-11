# Self-Hosted Model Stack on AWS: Cost & Architecture (AS-BUILT)

This document reflects what is **actually deployed**, not a proposal. Two models
run on one **always-on (24/7)** GPU box with a stable Elastic IP.

| Purpose | Model | Serving | Status |
|---------|-------|---------|--------|
| Text generation | `L3-8B-Stheno-v3.2` (Q5_K_M GGUF) | llama.cpp, OpenAI API `:8001` | LIVE, verified |
| Image generation | `Juggernaut-XL-v9` + **InstantID** (same-face identity) | ComfyUI `:8188` | LIVE, verified |
| Video generation | `Wan 2.2` (14B) | - | NOT deployed (deferred, see section 6) |

> Prices are eu-north-1, verified via the AWS Pricing API (2026).
>
> **Architecture change (2026-08):** switched from scale-to-zero to **24/7
> always-on**. Scale-to-zero was unreliable: stopping an on-demand instance
> returns the GPU to AWS, and restarting frequently failed with
> `InsufficientInstanceCapacity`, taking chat and images down. Running 24/7 and
> never auto-stopping removes that failure mode entirely. Trade-off: cost rises
> to ~$790/mo (over the old $587 target). Idle auto-stop and the EventBridge
> schedules are now OFF; `./30-stop.sh` (manual) still fully halts compute billing.

---

## 1. What is deployed

- **1x g5.xlarge** (NVIDIA A10G, 24GB VRAM), Availability Zone **eu-north-1c**.
  - Runs **both** models co-located: Stheno (~7-8GB VRAM) + Juggernaut (~6-7GB VRAM
    on generation) fit comfortably in 24GB.
- **130GB gp3** root volume: DLAMI + Docker images (~20GB) + both models
  (Stheno ~5.7GB + Juggernaut XL ~7.1GB) + a **16GB swapfile** (critical:
  absorbs the RAM load spike; see section 5). Grown from 100GB to 130GB after
  the 100GB volume filled to 100% and truncated the image-model download.
- **Stable Elastic IP** attached to the instance: the backend points at a fixed
  address (`POPPY_STHENO_URL` / `POPPY_JUGGERNAUT_URL`), no router IP-resolution
  needed. An EIP on a running instance is free.
- **Always-on**: idle auto-stop is DISABLED (`ENABLE_IDLE_STOP=false`), both
  EventBridge schedules are DISABLED. The box only stops when you run
  `./30-stop.sh`. The scale-to-zero router (Lambda + API GW) is left deployed but
  is optional now; nothing depends on it for normal operation.
- **Guardrails**: $850 AWS Budget alert (24/7 g5 runs ~$790/mo).

Everything is isolated (own VPC/subnet/SG/key, tagged `Project=poppy-inference`)
and separate from the app's backend/frontend. Scripts live in
`Plans/inference-aws/` (`10-deploy`, `20-start`, `30-stop`, `40-status`,
`50-destroy`, `60-router-deploy`, `65-router-destroy`).

---

## 2. Why g5.xlarge (not g6)

The plan was g6.xlarge (L4 24GB, $0.8536/hr). At deploy time **eu-north-1 had no
g6 capacity in any AZ** (InsufficientInstanceCapacity), and us-east-1 has a
**GPU quota of 0** by default (increase requested, pending). g5.xlarge (A10G
24GB) had capacity in eu-north-1c and has the **same 24GB VRAM**, so it fits both
models identically. It costs more per hour but the start/stop model keeps the
monthly bill under cap.

| Option | GPU | VRAM | $/hr (eu-north-1) | Notes |
|--------|-----|------|-------------------|-------|
| **g5.xlarge (chosen)** | A10G | 24GB | **$1.0670** | had capacity; deployed |
| g6.xlarge (planned) | L4 | 24GB | $0.8536 | no capacity at deploy time |
| us-east-1 g6.xlarge | L4 | 24GB | $0.8048 | cheapest, but quota pending |

---

## 3. Final cost (24/7 always-on)

### Fixed (billed even when the GPU is STOPPED): ~$14/mo
| Item | Cost |
|------|------|
| EBS 130GB gp3 @ $0.0836/GB-mo | $10.87 |
| Elastic IP (only while instance is stopped, ~$0.005/hr) | ~$0-3.6 |
| Router: Lambda + API Gateway (optional, low volume) | ~$1 |

The EIP is **free while the instance runs 24/7**; it only bills if you stop the box.

### Variable: $1.0670 per GPU-hour running
g5.xlarge running 24/7 = **~$779/mo compute + ~$11 fixed = ~$790/mo all-in.**

| GPU-on time | Compute | + fixed | **Total/mo** |
|-------------|---------|---------|--------------|
| **24x7 (current)** | **$779** | **$11** | **~$790** |
| 16 h/day (if you stop nightly) | $512 | $11 | ~$523 |
| 12 h/day | $384 | $11 | ~$395 |
| 8 h/day | $256 | $11 | ~$267 |

You can still cut cost by running `./30-stop.sh` when you don't need it (e.g.
overnight), which drops compute to $0 for those hours. That reintroduces the
capacity risk on restart, so it is a manual choice, not automatic.

### Cheaper 24/7 options (not applied)
- **1-yr Compute Savings Plan** on g5.xlarge: ~28-30% off, ~$520-575/mo all-in
  (under the old cap), but a 1-year commitment that bills even when stopped.
- **us-east-1 g6.xlarge**: $0.8048/hr, ~$600/mo, better capacity (needs the
  pending GPU quota).

### Per-unit economics (approx, A10G)
- Text: fast; a single g5 serves many concurrent chats.
- Image (Juggernaut XL, 768x1024, ~35 steps): a few seconds/image once warm.
  With 24/7, the checkpoint stays hot in VRAM (no cold-start load).

---

## 4. Cost controls (24/7 mode)
1. **Manual stop** - `./30-stop.sh` halts all compute billing (only ~$14/mo
   fixed continues). `./20-start.sh` brings it back (subject to AWS capacity).
2. **AWS Budget $850** - email alerts at 80% ($680) and 100% ($850). No
   auto-stop action, so a budget alert will NOT kill the 24/7 box.
3. **Idle auto-stop is OFF** - re-enable with `ENABLE_IDLE_STOP=true` in
   `config.sh` (and `systemctl enable --now poppy-idle.timer` on the box) if you
   ever want scale-to-zero back.

---

## 4b. GPU and memory (Stheno + Juggernaut co-located)
- **GPU in use: NVIDIA A10G** (on `g5.xlarge`), **24 GB** GDDR6 VRAM. Also 4
  vCPU and **16 GB system RAM**.
- **VRAM usage, both models live:**
  - Stheno L3-8B (Q5, all layers on GPU + 8k-token KV cache): **~7-8.5 GB** resident.
  - Juggernaut XL during image generation: **~8-10 GB** peak.
  - **Combined peak ~16-18 GB of 24 GB** (worst case with a large image batch +
    long chat context, ~20-22 GB). Always under the 24 GB ceiling.
- **System RAM (16 GB) is the real limit, not VRAM.** Loading both model files
  at once briefly exceeds 16 GB, which is why the 16 GB swapfile is mandatory.
- **This is why 24 GB is required.** A 16 GB card (T4 / g4dn) cannot hold both
  models, so the cheapest viable GPUs are the A10G (g5) or L4 (g6), both 24 GB.

## 4c. Character consistency: InstantID + FaceDetailer + FaceSwap
The persona pipeline generates **new poses and backgrounds while keeping the
same face**, at a professional consistency level. Three stages (both the
command pipeline `persona_pipeline.py` and the in-chat pipeline use the same
graph):
1. **InstantID** - embeds the reference face and locks it onto a fresh txt2img
   scene (ip-adapter + face ControlNet). Pose/outfit/background from the prompt.
2. **FaceDetailer** (ComfyUI Impact Pack, pinned to a Sept-2024 commit for this
   ai-dock ComfyUI) - detects the face, upscales the crop, re-diffuses it at high
   res with the identity locked. Fixes the weak-face-on-full-body problem.
3. **FaceSwap** (filter-free `PoppyFaceSwap` node using insightface inswapper) -
   copies the EXACT reference face onto the result. This is what turns "similar"
   into "the same person." No NSFW filter (unlike ReActor).

Extra models on disk (~9GB total): InstantID ip-adapter (1.6GB) + face ControlNet
(2.4GB) + antelopev2 (0.4GB) + `face_yolov8m.pt` (50MB) + `inswapper_128.onnx`
(0.5GB) + buffalo_l (auto, ~0.3GB). A custom image `poppy-comfyui-full:local`
bakes the nodes + deps so it survives the ephemeral `--rm` container; models and
the faceswap node stay on EBS mounts. This is why the root volume is 130GB.

Tuning (in the pipeline scripts): `IP_WEIGHT=1.05`, `CN_STRENGTH=0.35`, 30 steps,
CFG 4.5, dpmpp_2m/karras, 9:16 (768x1344) for the command pipeline. InstantID +
FaceSwap lock the FACE; hair/body still follow the prompt (add hair descriptors
if you want those consistent too). Best results come from a clean, front-facing
portrait as the reference. In chat, the character's primary image is the
reference (falls back to plain txt2img if the character has no image).

## 5. Key build details (fixes baked into the scripts)
- **Swap is mandatory.** g5/g6.xlarge have only 16GB RAM. Loading the 6.5GB
  SDXL checkpoint while llama.cpp holds the 5.7GB GGUF in page cache overran RAM
  and hung the box. A 16GB swapfile, created **before** the model services start,
  absorbs the transient spike. VRAM (24GB) was never the constraint; system RAM
  was.
- **ComfyUI auth off.** The ai-dock image gates the API behind a login proxy;
  `WEB_ENABLE_AUTH=false` exposes the ComfyUI API directly on 8188.
- **Output dir writable.** ComfyUI runs as non-root; the output mount is chmod
  777 so SaveImage can persist PNGs (retrieved via the `/view` API).
- **Multi-AZ launch.** Deploy sweeps every AZ that offers the instance type and
  falls through InsufficientInstanceCapacity automatically.

---

## 6. Not deployed: Wan 2.2 video (deferred)
Video was analysed but not built. If added later it is a **separate, larger**
cost (14B needs 40-48GB VRAM @ 480p, i.e. an L40S/A100-class GPU, not this g5),
and should run as its own scale-to-zero async queue on spot. Rough add-on: see
the per-clip math in git history of this file; budget it independently of the
$587 text+image cap.

---

## 7. Cheaper future option (us-east-1)
A GPU quota increase is pending in **us-east-1**, where g6.xlarge is **$0.8048/hr**
(cheaper than this g5's $1.067) with far better capacity. Once approved, redeploy
there by flipping `AWS_REGION` and `INSTANCE_TYPE` in `config.sh` and running
`10-deploy.sh`. Same 24GB VRAM, ~25% lower hourly rate, so every row in the
section 3 table drops ~25% on compute.

| If moved to us-east-1 g6 | Compute/mo | + fixed | Total |
|--------------------------|-----------|---------|-------|
| 8 h/day | $193 | $9 | ~$202 |
| 12 h/day | $290 | $9 | ~$299 |
| 16 h/day | $386 | $9 | ~$395 |
| 24x7 | $587 | $9 | ~$596 (about the cap) |

Note: on g6 in us-east-1, even 24x7 is ~at the cap, so the budget pressure eases
considerably.

---

## 8. Controls
```bash
cd Plans/inference-aws
./40-status.sh          # state, IP, endpoints, month-to-date cost
./20-start.sh           # start + open firewall to your IP + print endpoints
./30-stop.sh            # stop (halts compute billing; models kept)
./50-destroy.sh         # remove everything (type DESTROY)
# Router (already deployed): 60-router-deploy.sh / 65-router-destroy.sh
```
App integration (24/7 mode, static IP): in `backend/.env` set
```
POPPY_STHENO_URL=http://<ELASTIC_IP>:8001
POPPY_JUGGERNAUT_URL=http://<ELASTIC_IP>:8188
```
The backend uses these static URLs first (no router IP-resolution), so chat
routes to Stheno and images to ComfyUI directly, with cloud providers as
fallback. You can leave `POPPY_ROUTER_URL` unset in 24/7 mode.
