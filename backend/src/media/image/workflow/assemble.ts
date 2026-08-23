// Compose enabled blocks into one ComfyUI graph. All flags off => the exact
// current graph: base (4,5,6,7) + InstantID (10,20-23,3,8) + PoppyFaceSwap (50)
// + SaveImage (9). Each enabled block advances `lastImage`, and SaveImage
// consumes whatever the final block produced.
//
// Blocks are added in later tasks (FaceDetailer, hand detailer, pose ControlNet,
// PuLID). This file is extended per task; the all-off path never changes.
import { baseNodes } from "./base";
import { instantIdNodes } from "./instantid";
import { faceSwapNode } from "./faceswap";
import { faceDetailerNodes, FACEDETAILER_GPEN_VISIBILITY } from "./facedetailer";
import { handDetailerNodes } from "./handdetailer";
import { poseControlNetNodes, POSE } from "./pose-controlnet";
import { pulidNodes } from "./pulid";
import { YAW_GATE_DEG } from "../yaw";
import type { ImageWorkflowFlags } from "../flags";

export interface AssembleArgs {
  ckpt: string;
  positive: string;
  negative: string;
  refName: string;
  seed: number;
  flags: ImageWorkflowFlags;
  yawDeg?: number;
  poseSkeletonName?: string;
  ipWeight?: number;
  gpenVisibility?: number;
  // When provided (a live inventory of the box's ComfyUI node classes), an
  // enabled block whose key node is missing is SKIPPED so the job still renders
  // on the current graph instead of failing. Undefined => trust the flags.
  availableNodes?: Set<string>;
  // Forces the inswapper faceswap paste off regardless of the yaw gate. Used by
  // the video first-frame restyle path: the inswapper hard-paste leaves a
  // rectangular seam around the face that is very visible against flat
  // backgrounds and then propagates through every video frame. InstantID (plus
  // FaceDetailer) carries identity without the seam. Chat images do not set
  // this, so they keep the swap unchanged.
  skipFaceSwap?: boolean;
}

export function assembleConsistentWorkflow(a: AssembleArgs): Record<string, unknown> {
  // A block runs only if its flag is on AND (no inventory given OR the box has
  // the block's key node class).
  const has = (cls: string): boolean => !a.availableNodes || a.availableNodes.has(cls);
  const g: Record<string, unknown> = {
    ...baseNodes({ ckpt: a.ckpt, positive: a.positive, negative: a.negative }),
  };

  // Fix 4: when pose control is on AND a skeleton matched, add the body OpenPose
  // ControlNet (head keypoints stripped) and feed its conditioning into
  // InstantID; also lower ip_weight so identity does not fight the pose. When no
  // skeleton matched, fall back to the text-descriptor pose (no block added).
  let modelRef: [string, number] | undefined;
  let posePositive: [string, number] | undefined;
  let poseNegative: [string, number] | undefined;
  if (a.flags.poseControlNet && a.poseSkeletonName && has("ControlNetApplyAdvanced")) {
    const pose = poseControlNetNodes({ skeletonName: a.poseSkeletonName });
    Object.assign(g, pose.nodes);
    modelRef = pose.modelRef;
    posePositive = pose.posRef;
    poseNegative = pose.negRef;
  }

  // Fix 2 (angled branch): on a high-yaw shot with the gate + PuLID on, condition
  // the model with PuLID so identity follows the head rotation. Its model output
  // becomes the InstantID model source (wins over the base/pose model).
  const angled = a.flags.yawGate && (a.yawDeg ?? 0) >= YAW_GATE_DEG;
  if (angled && a.flags.pulid && has("ApplyPulid")) {
    const pulid = pulidNodes({ refNodeId: "10" });
    Object.assign(g, pulid.nodes);
    modelRef = pulid.outModelRef;
  }
  const usePose = a.flags.poseControlNet && Boolean(a.poseSkeletonName) && has("ControlNetApplyAdvanced");
  const ipWeight = usePose ? a.ipWeight ?? POSE.ipWeight : a.ipWeight;

  Object.assign(
    g,
    instantIdNodes({ refName: a.refName, seed: a.seed, ipWeight, modelRef, posePositive, poseNegative }),
  );

  // Terminal image node: starts as the VAEDecode (node 8). Each post-process
  // block advances this reference.
  let lastImage: [string, number] = ["8", 0];

  // Fix 2 (yaw gate) decides whether to run inswapper. Gate off => always run it
  // (current behavior). Gate on + |yaw| >= gate => skip (identity carried by
  // InstantID / PuLID on the angled branch, computed above as `angled`).
  // The video restyle path also forces it off via skipFaceSwap to avoid the
  // rectangular paste seam propagating through the clip.
  const skipSwap = angled || a.skipFaceSwap === true;
  if (!skipSwap) {
    // Fix 1: when FaceDetailer is on, GPEN yields final sharpness to FaceDetailer
    // by dropping its visibility (default 0.6). Otherwise the swap node stays
    // byte-identical to today (no gpen_visibility input emitted).
    const gpenVisibility = a.flags.faceDetailer && has("FaceDetailer")
      ? a.gpenVisibility ?? FACEDETAILER_GPEN_VISIBILITY
      : a.gpenVisibility;
    Object.assign(g, faceSwapNode({ targetRef: lastImage, gpenVisibility }));
    lastImage = ["50", 0];
  }

  // Fix 1: FaceDetailer re-diffuses the face box at low denoise to sharpen the
  // (small, swapped) face without changing identity. Runs after the swap.
  if (a.flags.faceDetailer && has("FaceDetailer")) {
    const fd = faceDetailerNodes({ inputImage: lastImage });
    Object.assign(g, fd.nodes);
    lastImage = [fd.outId, 0];
  }

  // Fix 3: hand detailer runs LAST. Hand SEGS exclude the face, so identity is
  // untouched by construction.
  if (a.flags.handDetailer && has("DetailerForEach")) {
    const hd = handDetailerNodes({ inputImage: lastImage });
    Object.assign(g, hd.nodes);
    lastImage = [hd.outId, 0];
  }

  g["9"] = { class_type: "SaveImage", inputs: { filename_prefix: "poppy-chat", images: lastImage } };
  return g;
}
