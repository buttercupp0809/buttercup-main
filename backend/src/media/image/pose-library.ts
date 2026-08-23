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
