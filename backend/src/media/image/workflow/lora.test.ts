import { describe, it, expect } from "vitest";
import { loraNode, LORA_DEFAULTS } from "./lora";

describe("loraNode", () => {
  it("wires LoraLoader off the checkpoint and exposes model+clip refs", () => {
    const r = loraNode({ loraName: "ch_abc.safetensors" });
    const n = r.nodes["30"] as { class_type: string; inputs: Record<string, unknown> };
    expect(n.class_type).toBe("LoraLoader");
    expect(n.inputs.model).toEqual(["4", 0]);
    expect(n.inputs.clip).toEqual(["4", 1]);
    expect(n.inputs.lora_name).toBe("ch_abc.safetensors");
    expect(n.inputs.strength_model).toBe(LORA_DEFAULTS.strength);
    expect(r.modelRef).toEqual(["30", 0]);
    expect(r.clipRef).toEqual(["30", 1]);
  });
});
