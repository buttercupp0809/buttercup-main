// WebP conversion for generated images. Uses `sharp` when available (installed
// dependency) and falls back to returning the original buffer unchanged.
// Callers always receive a typed result so they can set contentType correctly.

export interface ConvertResult {
  buffer: Buffer;
  contentType: "image/webp" | "image/png" | "image/jpeg";
}

type SharpModule = { default: (input: Buffer) => { webp: (opts: { quality: number; effort: number }) => { toBuffer: () => Promise<Buffer> } } };

let _sharp: SharpModule | null | undefined = undefined;

function loadSharp(): SharpModule | null {
  if (_sharp !== undefined) return _sharp;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _sharp = require("sharp") as SharpModule;
    return _sharp;
  } catch {
    _sharp = null;
    return null;
  }
}

// Convert any image buffer to WebP (quality 85, effort 4 for good speed/size balance).
// Falls back to the original PNG/JPEG if sharp is not installed.
export async function toWebP(input: Buffer): Promise<ConvertResult> {
  const sharp = loadSharp();
  if (!sharp) {
    return { buffer: input, contentType: "image/png" };
  }
  try {
    const buffer = await sharp.default(input)
      .webp({ quality: 85, effort: 4 })
      .toBuffer();
    return { buffer, contentType: "image/webp" };
  } catch {
    return { buffer: input, contentType: "image/png" };
  }
}
