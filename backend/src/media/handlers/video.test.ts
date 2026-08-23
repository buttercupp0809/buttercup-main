// Tests for the video handler's sceneMode branching (Stage A wiring).
// With no video provider configured, the handler returns the stub clip, so
// these tests focus on: which helper was called, what the meta contains.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heavy collaborators before importing the handler.
vi.mock("@buttercupp/database", () => ({
  prisma: {
    character: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../reference", () => ({
  resolveCharacterReferenceBytes: vi.fn(),
}));

vi.mock("../video/restyle", () => ({
  restyleFirstFrame: vi.fn(),
}));

// No provider configured -> stub path executes.
vi.mock("../video/providers", () => ({
  videoProvidersConfigured: vi.fn(() => false),
  generateVideo: vi.fn(),
}));

vi.mock("../video/constants", async (importOriginal) => {
  const original = await importOriginal<typeof import("../video/constants")>();
  return {
    ...original,
    videoSelfHostConfigured: vi.fn(() => false),
  };
});

vi.mock("../image/safety", () => ({
  assertCharacterAdult: vi.fn(),
  rejectMinorReference: vi.fn(),
}));

import { prisma } from "@buttercupp/database";
import { resolveCharacterReferenceBytes } from "../reference";
import { restyleFirstFrame } from "../video/restyle";
import { videoHandler } from "./video";
import type { MediaJobData } from "@buttercupp/shared";

// Minimal character fixture: adult, has an appearance sheet.
const mockSheet = {
  stylePrompt: "realistic woman",
  negativePrompt: "bad quality",
  traits: { hair: "brown", eye: "blue" },
};
const mockCharacter = {
  id: "char-1",
  style: "realistic",
  isAdult: true,
  currentVersion: {
    id: "ver-1",
    appearanceSheet: mockSheet,
  },
};

function makeJob(overrides: Partial<Record<string, unknown>> = {}): MediaJobData {
  return {
    characterId: "char-1",
    userId: "user-1",
    jobId: "job-1",
    mediaType: "video",
    payload: {
      userRequest: "on a beach in a blue dress",
      mode: "i2v",
      seconds: 5,
      aspectRatio: "portrait",
      quality: "balanced",
      sceneMode: "transform",
      ...overrides,
    },
  } as unknown as MediaJobData;
}

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.character.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockCharacter);
});

describe("videoHandler sceneMode branching", () => {
  it("(a) sceneMode:transform calls restyleFirstFrame with correct args", async () => {
    (restyleFirstFrame as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("styled"));
    const result = await videoHandler(makeJob({ sceneMode: "transform" }));
    expect(restyleFirstFrame).toHaveBeenCalledOnce();
    expect(restyleFirstFrame).toHaveBeenCalledWith({
      characterId: "char-1",
      userRequest: "on a beach in a blue dress",
      aspect: "portrait",
    });
    // stub path was taken (no provider configured); meta should record result
    expect(result.meta.sceneMode).toBe("transform");
    expect(result.meta.restyle).toBe("applied");
  });

  it("(b) restyle null falls back to resolveCharacterReferenceBytes and marks restyle:failed", async () => {
    (restyleFirstFrame as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (resolveCharacterReferenceBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("raw"));
    const result = await videoHandler(makeJob({ sceneMode: "transform" }));
    expect(restyleFirstFrame).toHaveBeenCalledOnce();
    expect(resolveCharacterReferenceBytes).toHaveBeenCalledWith("char-1");
    expect(result.meta.restyle).toBe("failed");
    expect(result.meta.sceneMode).toBe("transform");
  });

  it("(c) sceneMode:keep does NOT call restyleFirstFrame", async () => {
    (resolveCharacterReferenceBytes as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("raw"));
    const result = await videoHandler(makeJob({ sceneMode: "keep" }));
    expect(restyleFirstFrame).not.toHaveBeenCalled();
    expect(resolveCharacterReferenceBytes).toHaveBeenCalledWith("char-1");
    expect(result.meta.sceneMode).toBe("keep");
    expect(result.meta.restyle).toBe("skipped");
  });

  it("throws video_reference_unresolvable when i2v has no bytes after fallback", async () => {
    (restyleFirstFrame as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (resolveCharacterReferenceBytes as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(videoHandler(makeJob({ sceneMode: "transform", mode: "i2v" }))).rejects.toThrow(
      "video_reference_unresolvable"
    );
  });
});
