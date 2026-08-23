import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateVideo, _resetVideoDisabled } from "./providers";
import * as endpoint from "../../inference/videoEndpoint";

describe("generateVideo provider ordering", () => {
  beforeEach(() => {
    _resetVideoDisabled();
    process.env.POPPY_WAN_URL = "http://box:8188";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.POPPY_WAN_URL;
  });

  it("tries the self-hosted Wan box first when configured", async () => {
    vi.spyOn(endpoint, "resolveVideoBaseUrl").mockResolvedValue("http://box:8188");
    const calls: string[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/prompt")) {
        return new Response(JSON.stringify({ prompt_id: "p1" }), { status: 200 });
      }
      if (u.includes("/history/")) {
        return new Response(
          JSON.stringify({ p1: { outputs: { "61": { gifs: [{ filename: "a.webm", type: "output" }] } } } }),
          { status: 200 },
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    const out = await generateVideo({
      mode: "t2v",
      prompt: "hi",
      negativePrompt: "blur",
      referenceImageUrls: [],
      aspect: "landscape",
      preset: "balanced",
    });
    expect(out.provider).toBe("comfywan");
    expect(calls.some((c) => c.endsWith("/prompt"))).toBe(true);
    // aspect + preset flow through to the comfywan result meta.
    expect(out.meta.aspect).toBe("landscape");
    expect(out.meta.preset).toBe("balanced");
  });

  it("defaults to balanced preset and portrait aspect when omitted", async () => {
    vi.spyOn(endpoint, "resolveVideoBaseUrl").mockResolvedValue("http://box:8188");
    vi.spyOn(global, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/prompt")) {
        return new Response(JSON.stringify({ prompt_id: "p2" }), { status: 200 });
      }
      if (u.includes("/history/")) {
        return new Response(
          JSON.stringify({ p2: { outputs: { "61": { gifs: [{ filename: "b.webm", type: "output" }] } } } }),
          { status: 200 },
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    const out = await generateVideo({
      mode: "t2v",
      prompt: "hi",
      negativePrompt: "blur",
      referenceImageUrls: [],
    });
    expect(out.meta.preset).toBe("balanced");
    expect(out.meta.aspect).toBe("portrait");
  });
});
