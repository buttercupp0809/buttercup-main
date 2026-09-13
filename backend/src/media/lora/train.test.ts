// TDD tests for the kohya SDXL LoRA trainer config builder and training runner.
//
// All box interaction is injected via Deps so no real SSH/HTTP calls are made.

import { describe, it, expect } from "vitest";
import { buildKohyaConfig, runTraining } from "./train";

describe("buildKohyaConfig", () => {
  it("emits rank 32 alpha 16 at 1024 res", () => {
    const toml = buildKohyaConfig({ datasetDir: "/d", outputName: "ch_abc", rank: 32 });
    expect(toml).toMatch(/network_dim\s*=\s*32/);
    expect(toml).toMatch(/network_alpha\s*=\s*16/);
    expect(toml).not.toContain("\u2014");
  });

  it("embeds the datasetDir in the TOML", () => {
    const toml = buildKohyaConfig({ datasetDir: "/data/ch_xyz", outputName: "ch_xyz", rank: 16 });
    expect(toml).toContain("/data/ch_xyz");
  });

  it("embeds the outputName in the TOML", () => {
    const toml = buildKohyaConfig({ datasetDir: "/d", outputName: "ch_test", rank: 32 });
    expect(toml).toContain("ch_test");
  });

  it("sets resolution to 1024 in the TOML", () => {
    const toml = buildKohyaConfig({ datasetDir: "/d", outputName: "ch_abc", rank: 32 });
    expect(toml).toMatch(/resolution\s*=\s*["']?1024,1024["']?|resolution\s*=\s*1024/);
  });

  it("respects a custom rank value", () => {
    const toml = buildKohyaConfig({ datasetDir: "/d", outputName: "ch_custom", rank: 64 });
    expect(toml).toMatch(/network_dim\s*=\s*64/);
    // alpha stays fixed at 16 regardless of rank
    expect(toml).toMatch(/network_alpha\s*=\s*16/);
  });
});

describe("runTraining", () => {
  it("returns checkpoint keys from the box dep", async () => {
    const fakeCheckpoints = [
      { step: 500, key: "lora/ch_abc/ckpt-500.safetensors" },
      { step: 1000, key: "lora/ch_abc/ckpt-1000.safetensors" },
    ];

    const result = await runTraining(
      { datasetDir: "/d", outputName: "ch_abc", rank: 32 },
      {
        submitJob: async (_config: string) => "job-001",
        collectCheckpoints: async (_jobId: string) => fakeCheckpoints,
      },
    );

    expect(result.checkpoints).toEqual(fakeCheckpoints);
  });

  it("passes the generated TOML config to submitJob", async () => {
    let capturedConfig = "";

    await runTraining(
      { datasetDir: "/data/ch_xyz", outputName: "ch_xyz", rank: 32 },
      {
        submitJob: async (config: string) => {
          capturedConfig = config;
          return "job-002";
        },
        collectCheckpoints: async () => [],
      },
    );

    expect(capturedConfig).toMatch(/network_dim\s*=\s*32/);
    expect(capturedConfig).toContain("/data/ch_xyz");
  });

  it("passes the jobId returned by submitJob to collectCheckpoints", async () => {
    let capturedJobId = "";

    await runTraining(
      { datasetDir: "/d", outputName: "ch_abc", rank: 32 },
      {
        submitJob: async () => "job-xyz-999",
        collectCheckpoints: async (jobId: string) => {
          capturedJobId = jobId;
          return [];
        },
      },
    );

    expect(capturedJobId).toBe("job-xyz-999");
  });
});
