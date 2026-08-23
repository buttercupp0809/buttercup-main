// PuLID-SDXL conditions the diffusion model with the reference identity (unlike
// inswapper's rigid pixel paste), so it follows head rotation. Used only on the
// angled branch (yaw >= gate), applied to the base model before InstantID and the
// KSampler consume it. Node class names match cubiq/PuLID_ComfyUI ("Pulid*").
export function pulidNodes(a: { refNodeId: string }): {
  nodes: Record<string, unknown>;
  outModelRef: [string, number];
} {
  const nodes: Record<string, unknown> = {
    "60": { class_type: "PulidModelLoader", inputs: { pulid_file: "ip-adapter_pulid_sdxl_fp16.safetensors" } },
    "61": { class_type: "PulidInsightFaceLoader", inputs: { provider: "CPU" } },
    "62": { class_type: "PulidEvaClipLoader", inputs: {} },
    "63": {
      class_type: "ApplyPulid",
      inputs: {
        model: ["4", 0],
        pulid: ["60", 0],
        eva_clip: ["62", 0],
        face_analysis: ["61", 0],
        image: [a.refNodeId, 0],
        weight: 0.9,
        start_at: 0.0,
        end_at: 1.0,
      },
    },
  };
  return { nodes, outModelRef: ["63", 0] };
}
