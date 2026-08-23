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
  // Forces the inswapper faceswap paste off regardless of the yaw gate. NOTE:
  // skipping the swap loses the EXACT reference face (InstantID alone is close,
  // not exact). The video path therefore keeps the swap and uses refineBlend.
  skipFaceSwap?: boolean;
  // Video restyle path: keep the exact-face inswapper result, then run a light
  // full-frame low-denoise refiner pass over the whole image. This harmonizes
  // (blends) the rectangular inswapper paste seam into the background WITHOUT
  // dropping the swapped face. Denoise is intentionally low so the exact face
  // survives; raise refineDenoise to blend harder, lower it to stay more exact.
  refineBlend?: boolean;
  refineDenoise?: number;
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

  // Video restyle: light full-frame img2img refiner over the swapped image. The
  // inswapper gives the exact face but leaves a hard rectangular paste seam; a
  // low-denoise pass over the WHOLE frame repaints the seam boundary into the
  // background while keeping the swapped face (denoise stays low so identity is
  // preserved). Uses the raw checkpoint model (no InstantID re-conditioning, so
  // it cannot pull the exact face back toward a generic one).
  if (a.refineBlend) {
    const denoise = typeof a.refineDenoise === "number" ? a.refineDenoise : 0.25;
    g["100"] = { class_type: "VAEEncode", inputs: { pixels: lastImage, vae: ["4", 2] } };
    g["101"] = {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["100", 0],
        seed: a.seed,
        steps: 20,
        cfg: 5,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise,
      },
    };
    g["102"] = { class_type: "VAEDecode", inputs: { samples: ["101", 0], vae: ["4", 2] } };
    lastImage = ["102", 0];
  }

  g["9"] = { class_type: "SaveImage", inputs: { filename_prefix: "poppy-chat", images: lastImage } };
  return g;
}
