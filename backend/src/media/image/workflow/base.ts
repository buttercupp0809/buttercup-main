// Core nodes shared by every variant: checkpoint, empty latent, CLIP encodes.
// These are the unchanged head of the consistent workflow (nodes 4,5,6,7).
export const CANVAS = { width: 768, height: 1344 } as const;

export function baseNodes(a: {
  ckpt: string;
  positive: string;
  negative: string;
  // Optional LoRA clip output. When present, CLIP encodes (6,7) read from the
  // LoRA loader instead of the raw checkpoint so the trigger token is active.
  // When absent, falls back to ["4", 1] and the output is byte-identical to today.
  clipRef?: [string, number];
}): Record<string, unknown> {
  const clip = a.clipRef ?? (["4", 1] as [string, number]);
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: a.ckpt } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: CANVAS.width, height: CANVAS.height, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: a.positive, clip } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: a.negative, clip } },
  };
}
