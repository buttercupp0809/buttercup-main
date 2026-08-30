// TDD tests for runTrainLoraJob.
//
// Strategy: inject fake stage deps + mock the prisma singleton so no live DB,
// GPU box, or S3 is required. Asserts the CharacterLora status transitions:
//   success path:  building -> training -> validating -> ready (via promoteLora)
//   failure paths: any thrown stage -> failed + error message stored
//
// The handler is responsible for updating CharacterLora.status at each stage
// boundary. The test captures every prisma.characterLora.update call and
// verifies the status sequence.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrainLoraJobPayload } from "@buttercupp/shared";
import type { HandlerDeps } from "./handler";

// ---------------------------------------------------------------------------
// Mock @buttercupp/database before importing the module under test.
// ---------------------------------------------------------------------------
vi.mock("@buttercupp/database", () => ({
  prisma: {
    characterLora: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Import AFTER mock registration.
const { runTrainLoraJob } = await import("./handler");

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------
const PAYLOAD: TrainLoraJobPayload = {
  source: "train-lora",
  characterId: "char-1",
  characterVersionId: "ver-1",
  requestedBy: "admin@test.local",
  targetImageCount: 30,
  baseModel: "realvisxl_v5",
};

// A fake ValidateLoraResult that signals PASS.
const PASS_RESULT = {
  bestStep: 1000,
  bestKey: "lora/char-1/ckpt-1000.safetensors",
  meanScore: 0.85,
  baselineScore: 0.7,
  pass: true,
};

// A fake ValidateLoraResult that signals FAIL.
const FAIL_RESULT = {
  bestStep: 500,
  bestKey: "lora/char-1/ckpt-500.safetensors",
  meanScore: 0.5,
  baselineScore: 0.7,
  pass: false,
};

// Helper: build fake deps where all stages succeed.
function buildSuccessDeps(): HandlerDeps {
  return {
    buildDataset: vi.fn().mockResolvedValue({
      images: [{ key: "img.jpg", kind: "gallery", arcfaceScore: 0.9 }],
      manifestKey: "manifest.json",
    }),
    captionImage: vi.fn().mockResolvedValue("ch_abc123 a neutral pose"),
    runTraining: vi.fn().mockResolvedValue({
      checkpoints: [{ step: 1000, key: "lora/char-1/ckpt-1000.safetensors" }],
    }),
    validateLora: vi.fn().mockResolvedValue(PASS_RESULT),
    promoteLora: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
describe("runTrainLoraJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Helpers to grab the mock
  // -------------------------------------------------------------------------
  async function getPrismaUpdateMock() {
    const { prisma } = await import("@buttercupp/database");
    return prisma.characterLora.update as ReturnType<typeof vi.fn>;
  }

  async function getPrismaFindFirstMock() {
    const { prisma } = await import("@buttercupp/database");
    return prisma.characterLora.findFirst as ReturnType<typeof vi.fn>;
  }

  async function getPrismaCreateMock() {
    const { prisma } = await import("@buttercupp/database");
    return prisma.characterLora.create as ReturnType<typeof vi.fn>;
  }

  // -------------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------------
  describe("success path", () => {
    it("transitions status: building -> training -> validating, then calls promoteLora", async () => {
      const updateMock = await getPrismaUpdateMock();
      const findFirstMock = await getPrismaFindFirstMock();
      const createMock = await getPrismaCreateMock();

      // No existing row; the handler must create one.
      findFirstMock.mockResolvedValue(null);
      createMock.mockResolvedValue({ id: "lora-new", status: "pending" });
      // Each update returns the new row.
      updateMock.mockResolvedValue({ id: "lora-new" });

      const deps = buildSuccessDeps();
      await runTrainLoraJob(PAYLOAD, deps);

      // Collect the status values in order.
      const statusUpdates = updateMock.mock.calls.map(
        (c: [{ data: { status: string } }]) => c[0].data.status,
      );

      expect(statusUpdates).toContain("building");
      expect(statusUpdates).toContain("training");
      expect(statusUpdates).toContain("validating");
      // promoteLora handles the final ready/rejected transition.
      expect(deps.promoteLora).toHaveBeenCalledOnce();
    });

    it("calls buildDataset with correct args", async () => {
      const findFirstMock = await getPrismaFindFirstMock();
      const createMock = await getPrismaCreateMock();
      const updateMock = await getPrismaUpdateMock();

      findFirstMock.mockResolvedValue(null);
      createMock.mockResolvedValue({ id: "lora-x" });
      updateMock.mockResolvedValue({ id: "lora-x" });

      const deps = buildSuccessDeps();
      await runTrainLoraJob(PAYLOAD, deps);

      expect(deps.buildDataset).toHaveBeenCalledOnce();
      const [args] = (deps.buildDataset as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { characterId: string; characterVersionId: string; targetCount: number },
        unknown,
      ];
      expect(args.characterId).toBe("char-1");
      expect(args.characterVersionId).toBe("ver-1");
      expect(args.targetCount).toBe(30);
    });

    it("calls runTraining once", async () => {
      const findFirstMock = await getPrismaFindFirstMock();
      const createMock = await getPrismaCreateMock();
      const updateMock = await getPrismaUpdateMock();

      findFirstMock.mockResolvedValue(null);
      createMock.mockResolvedValue({ id: "lora-y" });
      updateMock.mockResolvedValue({ id: "lora-y" });

      const deps = buildSuccessDeps();
      await runTrainLoraJob(PAYLOAD, deps);

      expect(deps.runTraining).toHaveBeenCalledOnce();
    });

    it("calls validateLora with the checkpoints from runTraining", async () => {
      const findFirstMock = await getPrismaFindFirstMock();
      const createMock = await getPrismaCreateMock();
      const updateMock = await getPrismaUpdateMock();

      findFirstMock.mockResolvedValue(null);
      createMock.mockResolvedValue({ id: "lora-z" });
      updateMock.mockResolvedValue({ id: "lora-z" });

      const deps = buildSuccessDeps();
      await runTrainLoraJob(PAYLOAD, deps);

      expect(deps.validateLora).toHaveBeenCalledOnce();
      const validateCall = (deps.validateLora as ReturnType<typeof vi.fn>).mock.calls[0] as [
        { checkpoints: unknown[] },
        unknown,
      ];
      // The checkpoints from runTraining must be forwarded.
      expect(validateCall[0].checkpoints).toEqual([
        { step: 1000, key: "lora/char-1/ckpt-1000.safetensors" },
      ]);
    });

    it("uses an existing CharacterLora row if one already exists for this job", async () => {
      const findFirstMock = await getPrismaFindFirstMock();
      const createMock = await getPrismaCreateMock();
      const updateMock = await getPrismaUpdateMock();

      // Existing row found.
      findFirstMock.mockResolvedValue({ id: "existing-lora", status: "pending" });
      updateMock.mockResolvedValue({ id: "existing-lora" });

      const deps = buildSuccessDeps();
      await runTrainLoraJob(PAYLOAD, deps);

      // create must NOT be called when a row already exists.
      expect(createMock).not.toHaveBeenCalled();
      expect(deps.buildDataset).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Failure paths
  // -------------------------------------------------------------------------
  describe("failure path", () => {
    it("sets status to failed if buildDataset throws", async () => {
      const findFirstMock = await getPrismaFindFirstMock();
      const createMock = await getPrismaCreateMock();
      const updateMock = await getPrismaUpdateMock();

      findFirstMock.mockResolvedValue(null);
      createMock.mockResolvedValue({ id: "lora-fail-1" });
      updateMock.mockResolvedValue({ id: "lora-fail-1" });

      const deps = buildSuccessDeps();
      (deps.buildDataset as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("S3 unavailable"),
      );

      await runTrainLoraJob(PAYLOAD, deps);

      const failCall = updateMock.mock.calls.find(
        (c: [{ data: { status: string } }]) => c[0].data.status === "failed",
      );
      expect(failCall).toBeDefined();
      expect(failCall![0].data.error).toContain("S3 unavailable");
    });

    it("sets status to failed if runTraining throws", async () => {
      const findFirstMock = await getPrismaFindFirstMock();
      const createMock = await getPrismaCreateMock();
      const updateMock = await getPrismaUpdateMock();

      findFirstMock.mockResolvedValue(null);
      createMock.mockResolvedValue({ id: "lora-fail-2" });
      updateMock.mockResolvedValue({ id: "lora-fail-2" });

      const deps = buildSuccessDeps();
      (deps.runTraining as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("GPU box timeout"),
      );

      await runTrainLoraJob(PAYLOAD, deps);

      const failCall = updateMock.mock.calls.find(
        (c: [{ data: { status: string } }]) => c[0].data.status === "failed",
      );
      expect(failCall).toBeDefined();
      expect(failCall![0].data.error).toContain("GPU box timeout");
    });

    it("sets status to failed if validateLora throws", async () => {
      const findFirstMock = await getPrismaFindFirstMock();
      const createMock = await getPrismaCreateMock();
      const updateMock = await getPrismaUpdateMock();

      findFirstMock.mockResolvedValue(null);
      createMock.mockResolvedValue({ id: "lora-fail-3" });
      updateMock.mockResolvedValue({ id: "lora-fail-3" });

      const deps = buildSuccessDeps();
      (deps.validateLora as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ArcFace model error"),
      );

      await runTrainLoraJob(PAYLOAD, deps);

      const failCall = updateMock.mock.calls.find(
        (c: [{ data: { status: string } }]) => c[0].data.status === "failed",
      );
      expect(failCall).toBeDefined();
      expect(failCall![0].data.error).toContain("ArcFace model error");
    });

    it("sets status to failed if promoteLora throws", async () => {
      const findFirstMock = await getPrismaFindFirstMock();
      const createMock = await getPrismaCreateMock();
      const updateMock = await getPrismaUpdateMock();

      findFirstMock.mockResolvedValue(null);
      createMock.mockResolvedValue({ id: "lora-fail-4" });
      updateMock.mockResolvedValue({ id: "lora-fail-4" });

      const deps = buildSuccessDeps();
      (deps.promoteLora as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("DB write failed"),
      );

      await runTrainLoraJob(PAYLOAD, deps);

      const failCall = updateMock.mock.calls.find(
        (c: [{ data: { status: string } }]) => c[0].data.status === "failed",
      );
      expect(failCall).toBeDefined();
      expect(failCall![0].data.error).toContain("DB write failed");
    });

    it("does not rethrow after a stage failure", async () => {
      const findFirstMock = await getPrismaFindFirstMock();
      const createMock = await getPrismaCreateMock();
      const updateMock = await getPrismaUpdateMock();

      findFirstMock.mockResolvedValue(null);
      createMock.mockResolvedValue({ id: "lora-no-throw" });
      updateMock.mockResolvedValue({ id: "lora-no-throw" });

      const deps = buildSuccessDeps();
      (deps.buildDataset as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));

      // Must resolve (not reject) even on stage failure.
      await expect(runTrainLoraJob(PAYLOAD, deps)).resolves.toBeUndefined();
    });
  });
});
