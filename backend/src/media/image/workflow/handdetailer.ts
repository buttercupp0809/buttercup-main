// Hands-only detailer. Detect hands (YOLO) -> SEGS -> DetailerForEach re-diffuses
// each hand crop at higher denoise to rebuild fingers. Never touches the face:
// hand SEGS exclude the face region, so the identity lock is safe by construction.
// Runs LAST, after the face chain.
export const HANDDETAILER = {
  // Subfolder-prefixed to match the box's Impact-Subpack model listing.
  bboxModel: "bbox/hand_yolov9c.pt",
  denoise: 0.5,
  dilation: 16,
  cropFactor: 3.0,
  feather: 8,
  threshold: 0.4,
  guideSize: 768,
} as const;

export function handDetailerNodes(a: {
  inputImage: [string, number];
}): { nodes: Record<string, unknown>; outId: string } {
  const nodes: Record<string, unknown> = {
    "80": { class_type: "UltralyticsDetectorProvider", inputs: { model_name: HANDDETAILER.bboxModel } },
    "81": {
      class_type: "BboxDetectorSEGS",
      inputs: {
        bbox_detector: ["80", 0],
        image: a.inputImage,
        threshold: HANDDETAILER.threshold,
        dilation: HANDDETAILER.dilation,
        crop_factor: HANDDETAILER.cropFactor,
        // Required by the box's BboxDetectorSEGS signature.
        drop_size: 10,
        labels: "all",
      },
    },
    "82": {
      class_type: "DetailerForEach",
      inputs: {
        image: a.inputImage,
        segs: ["81", 0],
        model: ["4", 0],
        clip: ["4", 1],
        vae: ["4", 2],
        positive: ["6", 0],
        negative: ["7", 0],
        guide_size: HANDDETAILER.guideSize,
        guide_size_for: true,
        max_size: 1024,
        denoise: HANDDETAILER.denoise,
        feather: HANDDETAILER.feather,
        steps: 24,
        cfg: 7,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        seed: 0,
        noise_mask: true,
        force_inpaint: true,
        cycle: 1,
        // Required by the box's DetailerForEach signature.
        wildcard: "",
      },
    },
  };
  return { nodes, outId: "82" };
}
