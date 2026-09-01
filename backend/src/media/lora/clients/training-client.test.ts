// Unit tests for the training box HTTP client.
//
// Mocks global fetch so no real network calls are made.
// Covers: submitJob correct URL+shape, collectCheckpoints polling until done/failed,
// timeout, and fail-loud when POPPY_TRAINING_URL is unset.

import { describe, it, expect, vi, afterEach } from "vitest";

describe("training-client", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.useRealTimers();
  });

  async function loadClient() {
    return import("./training-client");
  }

  // ---------------------------------------------------------------------------
  // submitJob
  // ---------------------------------------------------------------------------
  describe("submitJob", () => {
    it("POSTs tomlConfig to /train and returns jobId", async () => {
      process.env.POPPY_TRAINING_URL = "http://box:8282";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, jobId: "job-abc" }),
      });
      global.fetch = mockFetch;

      const { submitJob } = await loadClient();
      const jobId = await submitJob("# toml config\n[general]\n");

      expect(jobId).toBe("job-abc");
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://box:8282/train");
      const body = JSON.parse(opts.body as string);
      expect(body.tomlConfig).toContain("[general]");
      expect(typeof body.jobId).toBe("string");
    });

    it("throws when POPPY_TRAINING_URL is not set", async () => {
      delete process.env.POPPY_TRAINING_URL;

      const { submitJob } = await loadClient();
      await expect(submitJob("# toml")).rejects.toThrow(
        "Training box not configured",
      );
    });

    it("throws when the endpoint returns a non-2xx status", async () => {
      process.env.POPPY_TRAINING_URL = "http://box:8282";
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        text: async () => "another training job is already running",
        json: async () => ({}),
      });

      const { submitJob } = await loadClient();
      await expect(submitJob("# toml")).rejects.toThrow("training /train returned 409");
    });
  });

  // ---------------------------------------------------------------------------
  // collectCheckpoints
  // ---------------------------------------------------------------------------
  describe("collectCheckpoints", () => {
    it("polls until done and returns checkpoints", async () => {
      process.env.POPPY_TRAINING_URL = "http://box:8282";
      process.env.POPPY_TRAINING_POLL_INTERVAL_MS = "10";
      process.env.POPPY_TRAINING_POLL_TIMEOUT_MS = "5000";

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return {
            ok: true,
            json: async () => ({ state: "running", jobId: "job-1" }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            state: "done",
            jobId: "job-1",
            checkpoints: [
              { step: 500, key: "lora/ch_abc/job-1/step-500.safetensors" },
              { step: 1000, key: "lora/ch_abc/job-1/step-1000.safetensors" },
            ],
          }),
        };
      });

      const { collectCheckpoints } = await loadClient();
      const checkpoints = await collectCheckpoints("job-1");

      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0]).toMatchObject({ step: 500, key: expect.stringContaining("step-500") });
      expect(checkpoints[1]).toMatchObject({ step: 1000, key: expect.stringContaining("step-1000") });
    });

    it("throws when job fails on box", async () => {
      process.env.POPPY_TRAINING_URL = "http://box:8282";
      process.env.POPPY_TRAINING_POLL_INTERVAL_MS = "10";
      process.env.POPPY_TRAINING_POLL_TIMEOUT_MS = "5000";

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "failed",
          jobId: "job-fail",
          log: "CUDA out of memory",
        }),
      });

      const { collectCheckpoints } = await loadClient();
      await expect(collectCheckpoints("job-fail")).rejects.toThrow(
        "training job job-fail failed on box",
      );
    });

    it("returns empty checkpoints when done response omits checkpoints field", async () => {
      process.env.POPPY_TRAINING_URL = "http://box:8282";
      process.env.POPPY_TRAINING_POLL_INTERVAL_MS = "10";
      process.env.POPPY_TRAINING_POLL_TIMEOUT_MS = "5000";

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ state: "done", jobId: "job-empty" }),
      });

      const { collectCheckpoints } = await loadClient();
      const checkpoints = await collectCheckpoints("job-empty");
      expect(checkpoints).toEqual([]);
    });

    it("throws when POPPY_TRAINING_URL is not set", async () => {
      delete process.env.POPPY_TRAINING_URL;

      const { collectCheckpoints } = await loadClient();
      await expect(collectCheckpoints("job-1")).rejects.toThrow(
        "Training box not configured",
      );
    });

    it("throws on timeout", async () => {
      process.env.POPPY_TRAINING_URL = "http://box:8282";
      process.env.POPPY_TRAINING_POLL_INTERVAL_MS = "10";
      process.env.POPPY_TRAINING_POLL_TIMEOUT_MS = "50"; // very short timeout

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ state: "running", jobId: "job-slow" }),
      });

      const { collectCheckpoints } = await loadClient();
      await expect(collectCheckpoints("job-slow")).rejects.toThrow("timed out");
    });
  });
});
