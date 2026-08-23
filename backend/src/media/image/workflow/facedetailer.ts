// FaceDetailer re-diffuses ONLY the detected face box at high res, low denoise,
// so a tiny far-from-camera face becomes crisp without changing the person. It
// runs AFTER the swap. denoise is the identity valve: hard cap 0.35.
export const FACEDETAILER = {
  // Impact-Subpack lists ultralytics models with a subfolder prefix; the bare
  // name fails ComfyUI validation ("Value not in list").
  bboxModel: "bbox/face_yolov8m.pt",
  denoise: 0.25,
  guideSize: 768,
  maxSize: 1024,
  bboxCropFactor: 3.0,
  bboxDilation: 6,
  feather: 8,
  bboxThreshold: 0.45,
  steps: 24,
  cfg: 7,
} as const;

// The value the swap node's GPEN restore should use when FaceDetailer is on
// (dropped from the implicit 1.0 so FaceDetailer, not GPEN, sets final sharpness).
export const FACEDETAILER_GPEN_VISIBILITY = 0.6;

export function faceDetailerNodes(a: {
  inputImage: [string, number];
}): { nodes: Record<string, unknown>; outId: string } {
  const nodes: Record<string, unknown> = {
    "70": { class_type: "UltralyticsDetectorProvider", inputs: { model_name: FACEDETAILER.bboxModel } },
    "71": {
      class_type: "FaceDetailer",
      inputs: {
        image: a.inputImage,
        model: ["4", 0],
        clip: ["4", 1],
        vae: ["4", 2],
        positive: ["6", 0],
        negative: ["7", 0],
        bbox_detector: ["70", 0],
        guide_size: FACEDETAILER.guideSize,
        guide_size_for: true,
        max_size: FACEDETAILER.maxSize,
        denoise: Math.min(0.35, FACEDETAILER.denoise),
        feather: FACEDETAILER.feather,
        bbox_threshold: FACEDETAILER.bboxThreshold,
        bbox_dilation: FACEDETAILER.bboxDilation,
        bbox_crop_factor: FACEDETAILER.bboxCropFactor,
        steps: FACEDETAILER.steps,
        cfg: FACEDETAILER.cfg,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        seed: 0,
        noise_mask: true,
        force_inpaint: true,
        cycle: 1,
        // Required by the box's Impact-Pack FaceDetailer signature. FaceDetailer
        // runs bbox-only here (no SAM model wired), so these are inert defaults;
        // omitting them fails prompt validation with "Required input is missing".
        wildcard: "",
        sam_detection_hint: "center-1",
        sam_dilation: 0,
        sam_threshold: 0.93,
        sam_bbox_expansion: 0,
        sam_mask_hint_threshold: 0.7,
        sam_mask_hint_use_negative: "False",
        drop_size: 10,
      },
    },
  };
  return { nodes, outId: "71" };
}
