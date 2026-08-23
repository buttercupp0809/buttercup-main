// Reproduce the comfyui_400: build the consistent workflow (all flags off ==
// current prod graph), upload a dummy reference frame, submit to the box, and
// print the full validation body so we can see node_errors.
// Run: npx tsx backend/scripts/repro-comfy400.ts
import { assembleConsistentWorkflow } from "../src/media/image/workflow/assemble";
import { resolveImageFlags } from "../src/media/image/flags";

const BASE = process.env.POPPY_JUGGERNAUT_URL ?? "http://51.20.178.118:8188";

// 1x1 transparent PNG (67 bytes).
const TINY_PNG = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000000000200015E0A62F00000000049454E44AE426082",
  "hex",
);

async function main() {
  console.log(`box: ${BASE}`);
  // Upload the reference frame ComfyUI's LoadImage node expects.
  const fd = new FormData();
  fd.append("image", new Blob([new Uint8Array(TINY_PNG)], { type: "image/png" }), "chat-ref.png");
  fd.append("overwrite", "true");
  const up = await fetch(`${BASE}/upload/image`, { method: "POST", body: fd });
  const upName = ((await up.json().catch(() => ({}))) as { name?: string }).name;
  console.log(`upload/image http=${up.status} name=${upName}`);

  const workflow = assembleConsistentWorkflow({
    ckpt: "juggernautXL_v9.safetensors",
    positive: "looking directly at camera, full body, a woman standing, photorealistic",
    negative: "child, lowres, bad anatomy",
    refName: upName ?? "chat-ref.png",
    seed: 1,
    flags: resolveImageFlags(), // all OFF == current prod graph
  });

  const q = await fetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: `repro-${Date.now()}` }),
  });
  const body = await q.text();
  console.log(`\n/prompt http=${q.status}`);
  console.log("body:");
  console.log(body);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
