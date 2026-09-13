// Worker-boundary tests for processLoraJob.
//
// Mirrors media-worker.test.ts's approach of driving the exported job
// processor directly (no BullMQ / Redis). Focuses on the trust boundary:
//   - a VALID payload is parsed and handed to runTrainLoraJob
//   - an INVALID payload (fails trainLoraJobPayloadSchema) is swallowed
//     (logged, never thrown, handler NOT called) so BullMQ does not retry
//     a job that can never succeed
//
// runTrainLoraJob is mocked so this test never touches the DB / GPU / S3.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrainLoraJobPayload } from "@buttercupp/shared";

vi.mock("../media/lora/handler", () => ({
  runTrainLoraJob: vi.fn().mockResolvedValue(undefined),
}));

const { processLoraJob } = await import("./lora-worker");

const VALID_PAYLOAD: TrainLoraJobPayload = {
  source: "train-lora",
  characterId: "char-1",
  characterVersionId: "ver-1",
  requestedBy: "admin@test.local",
  targetImageCount: 30,
  baseModel: "realvisxl_v5",
};

interface JobLike {
  id: string;
  data: unknown;
  attemptsMade: number;
  opts: { attempts?: number };
}

function makeJob(data: unknown): JobLike {
  return { id: "job-1", data, attemptsMade: 0, opts: { attempts: 1 } };
}

describe("processLoraJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a valid payload and delegates to runTrainLoraJob", async () => {
    const { runTrainLoraJob } = await import("../media/lora/handler");
    const runMock = runTrainLoraJob as ReturnType<typeof vi.fn>;

    await processLoraJob(makeJob(VALID_PAYLOAD));

    expect(runMock).toHaveBeenCalledOnce();
    expect(runMock.mock.calls[0][0]).toMatchObject({
      source: "train-lora",
      characterId: "char-1",
      characterVersionId: "ver-1",
    });
  });

  it("swallows an invalid payload without throwing and does NOT call the handler", async () => {
    const { runTrainLoraJob } = await import("../media/lora/handler");
    const runMock = runTrainLoraJob as ReturnType<typeof vi.fn>;

    // Missing required fields => fails trainLoraJobPayloadSchema.
    const badJob = makeJob({ source: "train-lora" });

    // Must resolve (not reject): an invalid payload can never succeed on
    // retry, so we mark the job done rather than looping forever.
    await expect(processLoraJob(badJob)).resolves.toBeUndefined();
    expect(runMock).not.toHaveBeenCalled();
  });

  it("swallows a totally malformed payload (wrong source) without throwing", async () => {
    const { runTrainLoraJob } = await import("../media/lora/handler");
    const runMock = runTrainLoraJob as ReturnType<typeof vi.fn>;

    const badJob = makeJob({ source: "not-train-lora", foo: 123 });

    await expect(processLoraJob(badJob)).resolves.toBeUndefined();
    expect(runMock).not.toHaveBeenCalled();
  });
});
