// Local demo of the self-hosted Wan 2.2 video generation path. Runs the REAL
// backend code (resolveVideoBaseUrl -> buildWanWorkflow -> generateWithComfyWan
// -> download) against a small mock ComfyUI HTTP server standing in for the g6e
// GPU box. No GPU, no cloud, no API keys. Shows the exact ComfyUI graph that
// would be sent, then writes the "generated" clip to disk.
//
// Run:  npx tsx backend/scripts/wan-local-demo.ts

import http from "node:http";
import { writeFileSync } from "node:fs";
import { buildWanWorkflow } from "../src/media/video/workflow";

const OUT = "/private/tmp/claude-501/-Users-kshitijpratap-Documents-Projects-poppy/598c8160-980e-483c-b01f-5019405593d6/scratchpad";

// A tiny placeholder "clip" the mock returns from /view. In production this is
// the real .webm the GPU renders; here it just proves the download path works.
const FAKE_CLIP = Buffer.from("PLACEHOLDER_WEBM_BYTES_from_mock_comfyui", "utf8");

let lastPromptBody: unknown = null;

const server = http.createServer((req, res) => {
  const url = req.url ?? "";
  if (req.method === "POST" && url.startsWith("/prompt")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastPromptBody = JSON.parse(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ prompt_id: "demo1" }));
    });
    return;
  }
  if (req.method === "POST" && url.startsWith("/upload/image")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ name: "wan-ref.png" }));
    return;
  }
  if (req.method === "GET" && url.startsWith("/history/")) {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        demo1: { outputs: { "61": { gifs: [{ filename: "demo.webm", subfolder: "", type: "output" }] } } },
      }),
    );
    return;
  }
  if (req.method === "GET" && url.startsWith("/view")) {
    res.setHeader("content-type", "video/webm");
    res.end(FAKE_CLIP);
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  // Point the backend at the mock box BEFORE importing the provider chain logic.
  process.env.POPPY_WAN_URL = base;
  // Import after env is set so the module reads the mock URL.
  const { generateVideo, _resetVideoDisabled } = await import("../src/media/video/providers");
  _resetVideoDisabled();

  console.log(`\nMock ComfyUI (stands in for the g6e Wan box) at ${base}\n`);

  // ---- 1. Show the EXACT ComfyUI graph that gets sent for a text-to-video job.
  const t2vGraph = buildWanWorkflow({
    mode: "t2v",
    positive: "a woman in a red dress walking through a neon-lit street at night",
    negative: "blurry, distorted",
    quality: "p480",
    seconds: 5,
    seed: 12345,
    preset: "lightning",
  });
  console.log("=== T2V ComfyUI workflow (Wan 2.2 A14B, lightning, 480p, 5s) ===");
  console.log(`nodes: ${Object.keys(t2vGraph).length}`);
  for (const [id, node] of Object.entries(t2vGraph)) {
    const n = node as { class_type: string };
    console.log(`  [${id}] ${n.class_type}`);
  }

  // ---- 2. Run the REAL generation path against the mock box (t2v).
  console.log("\n=== Running generateVideo (t2v) through the real provider chain ===");
  const t2v = await generateVideo({
    mode: "t2v",
    prompt: "a woman in a red dress walking through a neon-lit street at night",
    negativePrompt: "blurry, distorted",
    referenceImageUrls: [],
    seconds: 5,
  });
  const t2vPath = `${OUT}/wan-demo-t2v.webm`;
  writeFileSync(t2vPath, t2v.buffer);
  console.log(`provider=${t2v.provider}  latencyMs=${t2v.latencyMs}  meta=${JSON.stringify(t2v.meta)}`);
  console.log(`wrote ${t2v.buffer.length} bytes -> ${t2vPath}`);

  // ---- 3. Run the i2v path too (animates a character frame). The mock accepts
  //         the reference upload; a data: URL stands in for the S3-signed frame.
  console.log("\n=== Running generateVideo (i2v, animates a reference frame) ===");
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const i2v = await generateVideo({
    mode: "i2v",
    prompt: "she smiles and waves at the camera",
    negativePrompt: "blurry",
    referenceImageUrls: [dataUrl],
    seconds: 5,
  });
  const i2vPath = `${OUT}/wan-demo-i2v.webm`;
  writeFileSync(i2vPath, i2v.buffer);
  console.log(`provider=${i2v.provider}  latencyMs=${i2v.latencyMs}  meta=${JSON.stringify(i2v.meta)}`);
  console.log(`wrote ${i2v.buffer.length} bytes -> ${i2vPath}`);

  console.log("\nThe /prompt payload the box received last (i2v graph, truncated):");
  const wf = (lastPromptBody as { prompt?: Record<string, unknown> })?.prompt ?? {};
  console.log(`  ${Object.keys(wf).length} nodes, includes LoadImage=${JSON.stringify(Object.values(wf).some((n) => (n as { class_type?: string }).class_type === "LoadImage"))}`);

  server.close();
  console.log("\nDone. In production the only change is POPPY_WAN_URL pointing at the real g6e box; everything above is the real code path.");
}

main().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
