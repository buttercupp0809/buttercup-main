// Body OpenPose ControlNet with the head freed. DWPose extracts keypoints from a
// curated skeleton image; ultimate-openpose-editor re-renders it with
// show_face=false so the skeleton carries NO head keypoints; the xinsir OpenPose
// SDXL ControlNet then pins the body at strength 0.6, end_percent 0.6 so late
// steps release the face for InstantID to settle unopposed. The head stays free
// to rotate, which is why identity is not stiffened.
export const POSE = {
  controlnet: "controlnet-openpose-sdxl-1.0.safetensors",
  strength: 0.6,
  endPercent: 0.6,
  ipWeight: 0.75, // lowered from 1.05 so InstantID does not fight the pose or stiffen expression
} as const;

export function poseControlNetNodes(a: { skeletonName: string }): {
  nodes: Record<string, unknown>;
  modelRef: [string, number];
  posRef: [string, number];
  negRef: [string, number];
} {
  const nodes: Record<string, unknown> = {
    "90": { class_type: "LoadImage", inputs: { image: a.skeletonName } },
    "91": {
      class_type: "DWPreprocessor",
      inputs: { image: ["90", 0], detect_body: "enable", detect_hand: "enable", detect_face: "disable", resolution: 1024 },
    },
    "92": {
      class_type: "OpenposeEditorNode",
      inputs: { pose_kps: ["91", 1], show_body: true, show_hands: true, show_face: false },
    },
    "93": { class_type: "ControlNetLoader", inputs: { control_net_name: POSE.controlnet } },
    "94": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["6", 0],
        negative: ["7", 0],
        control_net: ["93", 0],
        image: ["92", 0],
        strength: POSE.strength,
        start_percent: 0.0,
        end_percent: POSE.endPercent,
        vae: ["4", 2],
      },
    },
  };
  // The pose block owns the conditioning InstantID consumes; the model stays base.
  return { nodes, modelRef: ["4", 0], posRef: ["94", 0], negRef: ["94", 1] };
}
