// TDD tests for the LoRA promoter.
//
// Strategy: mock the prisma singleton with vitest so no live DB is needed.
// The promoter must:
//   Pass path:
//     - update CharacterLora to status "ready", set s3Key, triggerToken,
//       checkpointStep, arcfaceScore
//     - look up characterVersionId on the CharacterLora row (already in DB,
//       resolved via the update return), then findUnique the CharacterVersion
//       to get its appearanceSheetId, then update AppearanceSheet.loraRef
//   Fail path:
//     - update CharacterLora to status "rejected", set error
//     - NOT touch AppearanceSheet

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ValidateLoraResult } from "./validate";

vi.mock("@buttercupp/database", () => ({
  prisma: {
    characterLora: {
      update: vi.fn(),
    },
    characterVersion: {
      findUnique: vi.fn(),
    },
    appearanceSheet: {
      update: vi.fn(),
    },
  },
}));

// Import AFTER mock registration so the module under test gets the mock.
const { promoteLora } = await import("./promote");

describe("promoteLora", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("pass path (result.pass === true)", () => {
    const passResult: ValidateLoraResult = {
      bestStep: 750,
      bestKey: "lora/ch_abc/ckpt-750.safetensors",
      meanScore: 0.82,
      baselineScore: 0.7,
      pass: true,
    };

    it("updates CharacterLora with status ready and all metadata fields", async () => {
      const { prisma } = await import("@buttercupp/database");
      const updateMock = prisma.characterLora.update as ReturnType<typeof vi.fn>;
      const findMock = prisma.characterVersion.findUnique as ReturnType<typeof vi.fn>;
      const sheetUpdateMock = prisma.appearanceSheet.update as ReturnType<typeof vi.fn>;

      // update returns a row with characterVersionId so the promoter can resolve the sheet
      updateMock.mockResolvedValue({
        id: "lora-1",
        characterVersionId: "ver-1",
        status: "ready",
      });
      findMock.mockResolvedValue({ id: "ver-1", appearanceSheetId: "sheet-1" });
      sheetUpdateMock.mockResolvedValue({ id: "sheet-1" });

      await promoteLora({
        loraId: "lora-1",
        result: passResult,
        s3Key: "lora/ch_abc/best.safetensors",
        triggerToken: "ch_abc",
      });

      expect(updateMock).toHaveBeenCalledOnce();
      const callArg = updateMock.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(callArg.where.id).toBe("lora-1");
      expect(callArg.data.status).toBe("ready");
      expect(callArg.data.s3Key).toBe("lora/ch_abc/best.safetensors");
      expect(callArg.data.triggerToken).toBe("ch_abc");
      expect(callArg.data.checkpointStep).toBe(750);
      expect(callArg.data.arcfaceScore).toBe(0.82);
    });

    it("mirrors s3Key into AppearanceSheet.loraRef", async () => {
      const { prisma } = await import("@buttercupp/database");
      const updateMock = prisma.characterLora.update as ReturnType<typeof vi.fn>;
      const findMock = prisma.characterVersion.findUnique as ReturnType<typeof vi.fn>;
      const sheetUpdateMock = prisma.appearanceSheet.update as ReturnType<typeof vi.fn>;

      updateMock.mockResolvedValue({ id: "lora-1", characterVersionId: "ver-1" });
      findMock.mockResolvedValue({ id: "ver-1", appearanceSheetId: "sheet-99" });
      sheetUpdateMock.mockResolvedValue({ id: "sheet-99" });

      await promoteLora({
        loraId: "lora-1",
        result: passResult,
        s3Key: "lora/ch_abc/best.safetensors",
        triggerToken: "ch_abc",
      });

      expect(findMock).toHaveBeenCalledOnce();
      expect(sheetUpdateMock).toHaveBeenCalledOnce();
      const sheetCallArg = sheetUpdateMock.mock.calls[0][0] as {
        where: { id: string };
        data: { loraRef: string };
      };
      expect(sheetCallArg.where.id).toBe("sheet-99");
      expect(sheetCallArg.data.loraRef).toBe("lora/ch_abc/best.safetensors");
    });

    it("skips AppearanceSheet mirror when the version has no appearanceSheetId", async () => {
      const { prisma } = await import("@buttercupp/database");
      const updateMock = prisma.characterLora.update as ReturnType<typeof vi.fn>;
      const findMock = prisma.characterVersion.findUnique as ReturnType<typeof vi.fn>;
      const sheetUpdateMock = prisma.appearanceSheet.update as ReturnType<typeof vi.fn>;

      updateMock.mockResolvedValue({ id: "lora-2", characterVersionId: "ver-2" });
      // version exists but has no appearance sheet
      findMock.mockResolvedValue({ id: "ver-2", appearanceSheetId: null });
      sheetUpdateMock.mockResolvedValue({ id: "whatever" });

      // must not throw
      await expect(
        promoteLora({
          loraId: "lora-2",
          result: passResult,
          s3Key: "lora/ch_def/best.safetensors",
          triggerToken: "ch_def",
        }),
      ).resolves.toBeUndefined();

      expect(sheetUpdateMock).not.toHaveBeenCalled();
    });

    it("skips AppearanceSheet mirror when the version row is not found", async () => {
      const { prisma } = await import("@buttercupp/database");
      const updateMock = prisma.characterLora.update as ReturnType<typeof vi.fn>;
      const findMock = prisma.characterVersion.findUnique as ReturnType<typeof vi.fn>;
      const sheetUpdateMock = prisma.appearanceSheet.update as ReturnType<typeof vi.fn>;

      updateMock.mockResolvedValue({ id: "lora-3", characterVersionId: "ver-3" });
      findMock.mockResolvedValue(null); // version not found
      sheetUpdateMock.mockResolvedValue({ id: "irrelevant" });

      await expect(
        promoteLora({
          loraId: "lora-3",
          result: passResult,
          s3Key: "lora/ch_xyz/best.safetensors",
          triggerToken: "ch_xyz",
        }),
      ).resolves.toBeUndefined();

      expect(sheetUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("fail path (result.pass === false)", () => {
    const failResult: ValidateLoraResult = {
      bestStep: 500,
      bestKey: "lora/ch_abc/ckpt-500.safetensors",
      meanScore: 0.55,
      baselineScore: 0.7,
      pass: false,
    };

    it("updates CharacterLora with status rejected and sets error", async () => {
      const { prisma } = await import("@buttercupp/database");
      const updateMock = prisma.characterLora.update as ReturnType<typeof vi.fn>;
      const sheetUpdateMock = prisma.appearanceSheet.update as ReturnType<typeof vi.fn>;

      updateMock.mockResolvedValue({ id: "lora-4", status: "rejected" });

      await promoteLora({
        loraId: "lora-4",
        result: failResult,
        s3Key: "lora/ch_abc/ckpt-500.safetensors",
        triggerToken: "ch_abc",
      });

      expect(updateMock).toHaveBeenCalledOnce();
      const callArg = updateMock.mock.calls[0][0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };
      expect(callArg.where.id).toBe("lora-4");
      expect(callArg.data.status).toBe("rejected");
      expect(typeof callArg.data.error).toBe("string");
      expect((callArg.data.error as string).length).toBeGreaterThan(0);
    });

    it("does NOT touch AppearanceSheet on failure", async () => {
      const { prisma } = await import("@buttercupp/database");
      const updateMock = prisma.characterLora.update as ReturnType<typeof vi.fn>;
      const sheetUpdateMock = prisma.appearanceSheet.update as ReturnType<typeof vi.fn>;

      updateMock.mockResolvedValue({ id: "lora-5", status: "rejected" });

      await promoteLora({
        loraId: "lora-5",
        result: failResult,
        s3Key: "lora/ch_abc/ckpt-500.safetensors",
        triggerToken: "ch_abc",
      });

      expect(sheetUpdateMock).not.toHaveBeenCalled();
    });

    it("does NOT call characterVersion.findUnique on failure", async () => {
      const { prisma } = await import("@buttercupp/database");
      const updateMock = prisma.characterLora.update as ReturnType<typeof vi.fn>;
      const findMock = prisma.characterVersion.findUnique as ReturnType<typeof vi.fn>;

      updateMock.mockResolvedValue({ id: "lora-6", status: "rejected" });

      await promoteLora({
        loraId: "lora-6",
        result: failResult,
        s3Key: "lora/ch_abc/ckpt-500.safetensors",
        triggerToken: "ch_abc",
      });

      expect(findMock).not.toHaveBeenCalled();
    });
  });
});
