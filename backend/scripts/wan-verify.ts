// Submit the Wan i2v workflow directly to the box and print the raw /prompt
// response (node_errors), bypassing the provider fallback that masks the error.
import { buildWanWorkflow } from "../src/media/video/workflow";
const BASE = process.env.POPPY_WAN_URL ?? "http://13.50.16.164:8188";
const TINY_PNG = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000000000200015E0A62F00000000049454E44AE426082",
  "hex",
);
async function main() {
  const fd = new FormData();
  fd.append("image", new Blob([new Uint8Array(TINY_PNG)], { type: "image/png" }), "wan-ref.png");
  fd.append("overwrite", "true");
  const up = await fetch(`${BASE}/upload/image`, { method: "POST", body: fd });
  console.log("upload:", up.status, await up.json().catch(() => ({})));
  const preset = (process.env.WAN_PRESET as "fast" | "balanced" | "max") ?? "balanced";
  console.log("preset:", preset);
  const wf = buildWanWorkflow({
    mode: "i2v", positive: "a woman waves", negative: "blurry",
    aspect: "portrait", seconds: 5, seed: 1, preset, refImageName: "wan-ref.png",
  });
  const q = await fetch(`${BASE}/prompt`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: wf, client_id: "wan-verify" }),
  });
  console.log("/prompt:", q.status);
  console.log(await q.text());
}
main().catch((e) => { console.error(e); process.exit(1); });
