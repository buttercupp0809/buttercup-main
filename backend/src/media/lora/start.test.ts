// Unit tests for startCharacterLoraTraining: the reusable "create pending row +
// enqueue" entry point shared by the admin route and the on-publish auto-train
// trigger. The duplicate guard is the key behavior: publishing (or re-publishing)
// a character must not spawn a second training run when one is already active or
// a ready LoRA already exists, because each run is a real ~1hr GPU job.
//
// Prisma is mocked (no DB); enqueue is injected via deps (no Redis).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loraFindFirstMock = vi.fn();
const loraCreateMock = vi.fn();
const characterFindUniqueMock = vi.fn();

vi.mock("@buttercupp/database", () => ({
  prisma: {
    characterLora: {
      findFirst: (...a: unknown[]) => loraFindFirstMock(...a),
      create: (...a: unknown[]) => loraCreateMock(...a),
    },
    character: {
      findUnique: (...a: unknown[]) => characterFindUniqueMock(...a),
    },
  },
}));

const { startCharacterLoraTraining, loraAutotrainEnabled } = await import("./start");

beforeEach(() => {
  loraFindFirstMock.mockReset();
  loraCreateMock.mockReset();
  characterFindUniqueMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("loraAutotrainEnabled", () => {
  const prev = process.env.LORA_AUTOTRAIN;
  afterEach(() => {
    if (prev === undefined) delete process.env.LORA_AUTOTRAIN;
    else process.env.LORA_AUTOTRAIN = prev;
  });

  it("defaults to OFF when LORA_AUTOTRAIN is unset", () => {
    delete process.env.LORA_AUTOTRAIN;
    expect(loraAutotrainEnabled()).toBe(false);
  });

  it("is on for '1' or 'true'", () => {
    process.env.LORA_AUTOTRAIN = "1";
    expect(loraAutotrainEnabled()).toBe(true);
    process.env.LORA_AUTOTRAIN = "true";
    expect(loraAutotrainEnabled()).toBe(true);
  });

  it("is off for any other value", () => {
    process.env.LORA_AUTOTRAIN = "false";
    expect(loraAutotrainEnabled()).toBe(false);
    process.env.LORA_AUTOTRAIN = "0";
    expect(loraAutotrainEnabled()).toBe(false);
  });
});

describe("startCharacterLoraTraining", () => {
  it("creates a pending row and enqueues when no prior row exists", async () => {
    loraFindFirstMock.mockResolvedValue(null);
    loraCreateMock.mockResolvedValue({ id: "lora-1", status: "pending" });
    const enqueue = vi.fn().mockResolvedValue({ jobId: "job-1" });

    const r = await startCharacterLoraTraining(
      { characterId: "c1", characterVersionId: "v1", requestedBy: "auto-publish" },
      { enqueue },
    );

    expect(loraCreateMock).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      characterId: "c1",
      characterVersionId: "v1",
      requestedBy: "auto-publish",
    });
    expect(r).toMatchObject({ loraId: "lora-1", status: "pending", jobId: "job-1" });
  });

  it("does NOT create or enqueue when an active run already exists (duplicate guard)", async () => {
    loraFindFirstMock.mockResolvedValue({ id: "lora-existing", status: "training" });
    const enqueue = vi.fn();

    const r = await startCharacterLoraTraining(
      { characterId: "c1", characterVersionId: "v1", requestedBy: "auto-publish" },
      { enqueue },
    );

    expect(loraCreateMock).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(r).toMatchObject({ loraId: "lora-existing", status: "training", skipped: "already_active" });
  });

  it("does NOT retrain when a ready LoRA already exists", async () => {
    loraFindFirstMock.mockResolvedValue({ id: "lora-ready", status: "ready" });
    const enqueue = vi.fn();

    const r = await startCharacterLoraTraining(
      { characterId: "c1", characterVersionId: "v1", requestedBy: "auto-publish" },
      { enqueue },
    );

    expect(loraCreateMock).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(r).toMatchObject({ loraId: "lora-ready", status: "ready", skipped: "already_ready" });
  });

  it("retrains when the prior run failed", async () => {
    loraFindFirstMock.mockResolvedValue({ id: "lora-old", status: "failed" });
    loraCreateMock.mockResolvedValue({ id: "lora-2", status: "pending" });
    const enqueue = vi.fn().mockResolvedValue({ jobId: "job-2" });

    const r = await startCharacterLoraTraining(
      { characterId: "c1", characterVersionId: "v1", requestedBy: "auto-publish" },
      { enqueue },
    );

    expect(loraCreateMock).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ loraId: "lora-2", status: "pending", jobId: "job-2" });
  });

  it("resolves characterVersionId from currentVersionId when omitted", async () => {
    characterFindUniqueMock.mockResolvedValue({ currentVersionId: "v9" });
    loraFindFirstMock.mockResolvedValue(null);
    loraCreateMock.mockResolvedValue({ id: "lora-3", status: "pending" });
    const enqueue = vi.fn().mockResolvedValue({ jobId: "job-3" });

    const r = await startCharacterLoraTraining(
      { characterId: "c1", requestedBy: "auto-publish" },
      { enqueue },
    );

    expect(enqueue.mock.calls[0][0]).toMatchObject({ characterVersionId: "v9" });
    expect(r).toMatchObject({ loraId: "lora-3", status: "pending" });
  });

  it("returns character_not_found when the character does not exist and no version was given", async () => {
    characterFindUniqueMock.mockResolvedValue(null);
    const enqueue = vi.fn();

    const r = await startCharacterLoraTraining({ characterId: "missing", requestedBy: "auto-publish" }, { enqueue });

    expect(enqueue).not.toHaveBeenCalled();
    expect(r.skipped).toBe("character_not_found");
  });

  it("still returns the created row (with enqueueError) when enqueue throws", async () => {
    loraFindFirstMock.mockResolvedValue(null);
    loraCreateMock.mockResolvedValue({ id: "lora-4", status: "pending" });
    const enqueue = vi.fn().mockRejectedValue(new Error("REDIS_URL not configured"));

    const r = await startCharacterLoraTraining(
      { characterId: "c1", characterVersionId: "v1", requestedBy: "auto-publish" },
      { enqueue },
    );

    expect(r).toMatchObject({ loraId: "lora-4", status: "pending" });
    expect(r.enqueueError).toContain("REDIS_URL");
    expect(r.jobId).toBeUndefined();
  });
});
