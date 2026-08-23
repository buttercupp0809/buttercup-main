// Wan 2.2 accepts frame counts on the 4n+1 grid (e.g. 81 = 5s at 16fps). These
// helpers keep every caller on that grid so ComfyUI never rejects a job.

export function clampSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 1;
  return Math.min(10, Math.max(1, Math.round(seconds)));
}

export function secondsToFrames(seconds: number, fps: number): number {
  const raw = clampSeconds(seconds) * fps;
  // Snap to the nearest 4n+1 value.
  const n = Math.round((raw - 1) / 4);
  return n * 4 + 1;
}

export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}
