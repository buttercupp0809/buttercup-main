// Verify the FaceDetailer/hand fix validates on the real box. Builds the
// consistent workflow with the flags ON and submits to /prompt; http=200 means
// ComfyUI accepted it (the comfyui_400 is resolved). Run:
//   npx tsx backend/scripts/verify-facedetailer-fix.ts
import { assembleConsistentWorkflow } from "../src/media/image/workflow/assemble";
import type { ImageWorkflowFlags } from "../src/media/image/flags";

const BASE = process.env.POPPY_JUGGERNAUT_URL ?? "http://51.20.178.118:8188";
const TINY_PNG = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000000000200015E0A62F00000000049454E44AE426082",
  "hex",
);

async function submit(label: string, flags: ImageWorkflowFlags) {
  const fd = new FormData();
  fd.append("image", new Blob([new Uint8Array(TINY_PNG)], { type: "image/png" }), "chat-ref.png");
  fd.append("overwrite", "true");
  await fetch(`${BASE}/upload/image`, { method: "POST", body: fd });

  const wf = assembleConsistentWorkflow({
    ckpt: "juggernautXL_v9.safetensors",
    positive: "looking directly at camera, full body, a woman standing, photorealistic",
    negative: "child, lowres, bad anatomy",
    refName: "chat-ref.png",
    seed: 1,
    flags,
  });
  const q = await fetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: wf, client_id: `verify-${Date.now()}` }),
  });
  const body = await q.text();
  const ok = q.status === 200;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: http=${q.status}`);
  if (!ok) console.log(`      body: ${body.slice(0, 500)}`);
}

const off: ImageWorkflowFlags = { faceDetailer: false, handDetailer: false, poseControlNet: false, yawGate: false, pulid: false };
async function main() {
  console.log(`box: ${BASE}\n`);
  await submit("baseline (all off)", off);
  await submit("IMG_FACEDETAILER on", { ...off, faceDetailer: true });
  await submit("IMG_FACEDETAILER + IMG_HAND_DETAILER on", { ...off, faceDetailer: true, handDetailer: true });
}
main().catch((e) => { console.error(e); process.exit(1); });
