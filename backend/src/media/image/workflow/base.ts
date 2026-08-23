// Core nodes shared by every variant: checkpoint, empty latent, CLIP encodes.
// These are the unchanged head of the consistent workflow (nodes 4,5,6,7).
export const CANVAS = { width: 768, height: 1344 } as const;

export function baseNodes(a: {
  ckpt: string;
  positive: string;
  negative: string;
}): Record<string, unknown> {
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: a.ckpt } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: CANVAS.width, height: CANVAS.height, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: a.positive, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: a.negative, clip: ["4", 1] } },
  };
}
