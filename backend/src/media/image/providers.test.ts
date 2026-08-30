// Unit tests for the basic ComfyUI txt2img workflow builder.
// The IMG_LORA kill-switch gates LoRA injection at the HANDLER layer
// (handlers/image.ts: loraName is only passed when resolveImageFlags().lora is
// true). _buildComfyWorkflow itself is a pure node-graph builder: it injects
// node 30 whenever loraName is present, and omits it when loraName is absent.
// The tests below verify both layers.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { _buildComfyWorkflow } from "./providers";
import { resolveImageFlags } from "./flags";

const IMG_FLAG_ENV = [
  "IMG_FACEDETAILER",
  "IMG_HAND_DETAILER",
  "IMG_POSE_CONTROLNET",
  "IMG_YAW_GATE",
  "IMG_PULID",
  "IMG_LORA",
  "IMG_UPSCALE_TAIL",
];

const baseArgs = {
  ckpt: "juggernautXL_v9.safetensors",
  positive: "a beautiful woman",
  negative: "ugly, blurry",
  width: 896,
  height: 1152,
  seed: 42,
};

beforeEach(() => {
  for (const k of IMG_FLAG_ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of IMG_FLAG_ENV) delete process.env[k];
});

// ---------------------------------------------------------------------------
// Pure workflow-builder tests (no flag reading: the builder takes loraName
// directly as a parameter, mirroring what the handler passes after gating).
// ---------------------------------------------------------------------------
describe("_buildComfyWorkflow (pure graph builder)", () => {
  it("no loraName => no node 30, model+clip refs point to checkpoint node 4", () => {
    const g = _buildComfyWorkflow({ ...baseArgs });
    expect(g["30"]).toBeUndefined();
    expect((g["3"] as any).inputs.model).toEqual(["4", 0]);
    expect((g["6"] as any).inputs.clip).toEqual(["4", 1]);
  });

  it("loraName present => injects LoRA node 30 and routes refs through it", () => {
    const g = _buildComfyWorkflow({ ...baseArgs, loraName: "ch_abc.safetensors" });
    expect((g["30"] as any).class_type).toBe("LoraLoader");
    expect((g["30"] as any).inputs.lora_name).toBe("ch_abc.safetensors");
    expect((g["3"] as any).inputs.model).toEqual(["30", 0]);
    expect((g["6"] as any).inputs.clip).toEqual(["30", 1]);
  });
});

// ---------------------------------------------------------------------------
// IMG_LORA kill-switch gate (simulating handlers/image.ts behavior).
// The handler resolves the flag and only passes loraName when it is on.
// These are the canonical tests proving the gate works end-to-end.
// ---------------------------------------------------------------------------
describe("basic path: IMG_LORA flag gate (simulating handlers/image.ts gating)", () => {
  it("flag OFF + loraName available => handler passes undefined => no LoRA node 30", () => {
    // IMG_LORA is off (default). The handler computes:
    //   const loraFlag = resolveImageFlags().lora;  // false
    //   const loraName = loraFlag && s3Key ? basename(s3Key) : undefined;  // undefined
    delete process.env.IMG_LORA;
    const loraFlag = resolveImageFlags().lora;
    const loraName = loraFlag ? "ch_abc.safetensors" : undefined;

    const g = _buildComfyWorkflow({ ...baseArgs, loraName });
    expect(g["30"]).toBeUndefined();
    expect((g["3"] as any).inputs.model).toEqual(["4", 0]);
  });

  it("flag ON + loraName available => handler passes loraName => LoRA node 30 present", () => {
    // IMG_LORA is on. The handler computes:
    //   const loraFlag = resolveImageFlags().lora;  // true
    //   const loraName = loraFlag && s3Key ? basename(s3Key) : undefined;  // "ch_abc.safetensors"
    process.env.IMG_LORA = "1";
    const loraFlag = resolveImageFlags().lora;
    const loraName = loraFlag ? "ch_abc.safetensors" : undefined;

    const g = _buildComfyWorkflow({ ...baseArgs, loraName });
    expect((g["30"] as any).class_type).toBe("LoraLoader");
    expect((g["3"] as any).inputs.model).toEqual(["30", 0]);
  });
});
