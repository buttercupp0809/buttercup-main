import type { Pose } from "@buttercupp/shared";

// Map a free-text pose hint to a curated OpenPose skeleton PNG (uploaded to the
// ComfyUI input dir at box-provision time). Returns null to fall back to the
// text-descriptor pose path that providers.ts already prepends.
const POSE_MAP: Array<{ re: RegExp; file: string }> = [
  { re: /\bsit(ting)?\b/i, file: "pose-sitting.png" },
  { re: /\b(l(y|ie)ing|lay(ing)?)\b/i, file: "pose-lying.png" },
  { re: /\b(arms? up|reaching|stretch)/i, file: "pose-arms-up.png" },
  { re: /\bkneel/i, file: "pose-kneeling.png" },
];

export function matchPoseSkeleton(text: string): string | null {
  for (const p of POSE_MAP) if (p.re.test(text)) return p.file;
  return null;
}

// Map structured Pose enum values (from poseSchema) to skeleton filenames.
// front / three_quarter_left / three_quarter_right / profile / over_shoulder:
//   no skeleton needed; pose is driven by the head-direction text descriptor
//   that providers.ts prepends. Return null so the assembler skips the
//   poseControlNet block and falls back to the text path.
// sitting / lying / arms_up: an OpenPose skeleton locks the body
//   so the model does not invent the pose independently of the text.

const POSE_SCHEMA_SKELETON: Record<Pose, string | null> = {
  front: null,
  three_quarter_left: null,
  three_quarter_right: null,
  profile: null,
  over_shoulder: null,
  sitting: "pose-sitting.png",
  lying: "pose-lying.png",
  arms_up: "pose-arms-up.png",
};

export function poseSchemaToSkeleton(pose: Pose): string | null {
  return POSE_SCHEMA_SKELETON[pose] ?? null;
}
