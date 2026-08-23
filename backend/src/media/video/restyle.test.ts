import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../reference", () => ({ resolveCharacterReferenceBytes: vi.fn() }));
vi.mock("../image/providers", () => ({ generateWithComfyUIConsistent: vi.fn() }));
vi.mock("@buttercupp/database", () => ({
  prisma: { character: { findUnique: vi.fn() } },
}));

import { resolveCharacterReferenceBytes } from "../reference";
import { generateWithComfyUIConsistent } from "../image/providers";
import { prisma } from "@buttercupp/database";
import { restyleFirstFrame } from "./restyle";

const sheet = { stylePrompt: "s", negativePrompt: "n", traits: {} };
const char = { style: "realistic", currentVersion: { appearanceSheet: sheet } };

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(char);
});

describe("restyleFirstFrame", () => {
  it("returns the restyled buffer on success", async () => {
    (resolveCharacterReferenceBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("ref"));
    (generateWithComfyUIConsistent as ReturnType<typeof vi.fn>).mockResolvedValue({
      buffer: Buffer.from("newframe"),
      provider: "comfyui",
      meta: {},
    });
    const out = await restyleFirstFrame({ characterId: "c1", userRequest: "blue dress on a beach", aspect: "portrait" });
    expect(out?.toString()).toBe("newframe");
  });

  it("returns null when there is no reference image", async () => {
    (resolveCharacterReferenceBytes as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await restyleFirstFrame({ characterId: "c1", userRequest: "x", aspect: "portrait" })).toBeNull();
  });

  it("returns null when generation throws (caller falls back to raw photo)", async () => {
    (resolveCharacterReferenceBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("ref"));
    (generateWithComfyUIConsistent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("box down"));
    expect(await restyleFirstFrame({ characterId: "c1", userRequest: "x", aspect: "portrait" })).toBeNull();
  });
});
