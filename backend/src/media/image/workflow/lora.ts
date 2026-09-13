// LoRA loader (node 30). Sits between the checkpoint (node 4) and everything
// that consumes model/clip, so a per-character trained LoRA conditions the whole
// graph. modelRef feeds InstantID's model input; clipRef re-encodes the prompt
// (with the trigger token) so the LoRA's identity token is active.
export const LORA_DEFAULTS = { strength: 0.85 } as const;

export function loraNode(a: { loraName: string; strength?: number }): {
  nodes: Record<string, unknown>;
  modelRef: [string, number];
  clipRef: [string, number];
} {
  const strength = a.strength ?? LORA_DEFAULTS.strength;
  return {
    nodes: {
      "30": {
        class_type: "LoraLoader",
        inputs: {
          model: ["4", 0],
          clip: ["4", 1],
          lora_name: a.loraName,
          strength_model: strength,
          strength_clip: strength,
        },
      },
    },
    modelRef: ["30", 0],
    clipRef: ["30", 1],
  };
}
