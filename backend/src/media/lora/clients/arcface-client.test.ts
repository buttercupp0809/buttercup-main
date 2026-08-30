// Unit tests for the ArcFace scoring HTTP client.
//
// Mocks global fetch so no real network calls are made.
// Covers: correct URL + request shape, response parsing, and
// fail-loud behavior when POPPY_ARCFACE_URL is unset.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("arcface-client", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  async function loadClient() {
    return import("./arcface-client");
  }

  // ---------------------------------------------------------------------------
  // scoreImages
  // ---------------------------------------------------------------------------
  describe("scoreImages", () => {
    it("POSTs ref_key + candidate_key to /score and returns similarity", async () => {
      process.env.POPPY_ARCFACE_URL = "http://box:5000";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ similarity: 0.87 }),
      });
      global.fetch = mockFetch;

      const { scoreImages } = await loadClient();
      const score = await scoreImages("ref/char/v1", "images/gen/a.png");

      expect(score).toBe(0.87);
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://box:5000/score");
      const body = JSON.parse(opts.body as string);
      expect(body).toMatchObject({
        ref_key: "ref/char/v1",
        candidate_key: "images/gen/a.png",
      });
    });

    it("throws when POPPY_ARCFACE_URL is not set", async () => {
      delete process.env.POPPY_ARCFACE_URL;

      const { scoreImages } = await loadClient();
      await expect(scoreImages("ref", "cand")).rejects.toThrow(
        "ArcFace scorer not configured",
      );
    });

    it("throws when the endpoint returns a non-2xx status", async () => {
      process.env.POPPY_ARCFACE_URL = "http://box:5000";
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      });

      const { scoreImages } = await loadClient();
      await expect(scoreImages("ref", "cand")).rejects.toThrow("arcface /score returned 503");
    });

    it("throws when the response is missing the similarity field", async () => {
      process.env.POPPY_ARCFACE_URL = "http://box:5000";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ score: 0.8 }), // wrong field name
      });

      const { scoreImages } = await loadClient();
      await expect(scoreImages("ref", "cand")).rejects.toThrow(
        "missing 'similarity' field",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getBaseline
  // ---------------------------------------------------------------------------
  describe("getBaseline", () => {
    it("throws when POPPY_ARCFACE_URL is not set", async () => {
      delete process.env.POPPY_ARCFACE_URL;

      const { getBaseline } = await loadClient();
      await expect(getBaseline("ref/char/v1")).rejects.toThrow(
        "ArcFace scorer not configured",
      );
    });

    it("returns score from /baseline when endpoint is available", async () => {
      process.env.POPPY_ARCFACE_URL = "http://box:5000";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ score: 0.72 }),
      });

      const { getBaseline } = await loadClient();
      const score = await getBaseline("ref/char/v1");
      expect(score).toBe(0.72);
    });

    it("falls back to 0.65 when /baseline returns non-2xx", async () => {
      process.env.POPPY_ARCFACE_URL = "http://box:5000";
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      });

      const { getBaseline } = await loadClient();
      const score = await getBaseline("ref/char/v1");
      expect(score).toBe(0.65);
    });
  });

  // ---------------------------------------------------------------------------
  // scoreChain
  // ---------------------------------------------------------------------------
  describe("scoreChain", () => {
    it("delegates to scoreImages and returns its result", async () => {
      process.env.POPPY_ARCFACE_URL = "http://box:5000";
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ similarity: 0.91 }),
      });

      const { scoreChain } = await loadClient();
      const score = await scoreChain("ref/char/v1", "lora/ckpt-1000.safetensors");
      expect(score).toBe(0.91);
    });
  });
});
