// Unit tests for the VLM captioner HTTP client.
//
// Mocks global fetch so no real network calls are made.
// Covers: correct URL + request shape, response parsing, and
// fail-loud behavior when POPPY_CAPTION_URL is unset.

import { describe, it, expect, vi, afterEach } from "vitest";

describe("caption-client", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  async function loadClient() {
    return import("./caption-client");
  }

  it("POSTs image_key to /caption and returns the caption", async () => {
    process.env.POPPY_CAPTION_URL = "http://box:7000";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ caption: "a woman standing in a studio" }),
    });
    global.fetch = mockFetch;

    const { vlmCaption } = await loadClient();
    const caption = await vlmCaption("images/char/a.png");

    expect(caption).toBe("a woman standing in a studio");
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://box:7000/caption");
    const body = JSON.parse(opts.body as string);
    expect(body).toMatchObject({ image_key: "images/char/a.png" });
  });

  it("throws when POPPY_CAPTION_URL is not set", async () => {
    delete process.env.POPPY_CAPTION_URL;

    const { vlmCaption } = await loadClient();
    await expect(vlmCaption("img.png")).rejects.toThrow(
      "VLM captioner not configured",
    );
  });

  it("throws when the endpoint returns a non-2xx status", async () => {
    process.env.POPPY_CAPTION_URL = "http://box:7000";
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { vlmCaption } = await loadClient();
    await expect(vlmCaption("img.png")).rejects.toThrow("caption /caption returned 500");
  });

  it("throws when the response caption field is missing", async () => {
    process.env.POPPY_CAPTION_URL = "http://box:7000";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "some text" }), // wrong field name
    });

    const { vlmCaption } = await loadClient();
    await expect(vlmCaption("img.png")).rejects.toThrow("missing 'caption' field");
  });

  it("trims whitespace from the returned caption", async () => {
    process.env.POPPY_CAPTION_URL = "http://box:7000";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ caption: "  a portrait photo  " }),
    });

    const { vlmCaption } = await loadClient();
    const caption = await vlmCaption("img.png");
    expect(caption).toBe("a portrait photo");
  });
});
