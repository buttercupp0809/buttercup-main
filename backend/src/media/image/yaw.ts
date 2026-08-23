// Estimate head yaw (degrees) from the pose descriptor the caller prepends. This
// avoids a separate detector pass; the descriptors are a closed set (see
// POSE_DESCRIPTORS in providers.ts). Frontal = 0; profile-ish >= 30, which is the
// gate above which inswapper_128 (frontal-trained) shears and identity is handed
// to PuLID / InstantID instead.
const YAW_HINTS: Array<{ re: RegExp; deg: number }> = [
  { re: /directly at camera|front|facing/i, deg: 0 },
  { re: /slightly to the (left|right)/i, deg: 15 },
  { re: /three-?quarter/i, deg: 35 },
  { re: /over(\s|-)shoulder|glancing/i, deg: 55 },
  { re: /profile|side view/i, deg: 80 },
];

export function estimateYawFromPoseHint(hint: string): number {
  let max = 0;
  for (const h of YAW_HINTS) if (h.re.test(hint)) max = Math.max(max, h.deg);
  return max;
}

export const YAW_GATE_DEG = 30;
