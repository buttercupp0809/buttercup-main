// Audio helpers. ffmpeg conversion runs in the container (Dockerfile
// installs ffmpeg). truncateForVoice caps input at MAX_VOICE_WORDS so a
// runaway reply cannot produce a 5-minute TTS render.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { MAX_VOICE_WORDS } from "./constants";

export function truncateForVoice(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= MAX_VOICE_WORDS) return text.trim();
  return words.slice(0, MAX_VOICE_WORDS).join(" ") + " ...";
}

// Convert an input Buffer (mp3 or wav) to ogg/opus 48k mono. Uses temp
// files because piping large binaries through ffmpeg stdio is fragile on
// some platforms.
export async function convertToOggOpus(
  input: Buffer,
  inputExt: "mp3" | "wav",
): Promise<Buffer> {
  const dir = os.tmpdir();
  const id = crypto.randomUUID();
  const inPath = path.join(dir, `${id}.${inputExt}`);
  const outPath = path.join(dir, `${id}.ogg`);
  await fs.writeFile(inPath, input);
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn("ffmpeg", [
        "-y",
        "-i",
        inPath,
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        "-ar",
        "48000",
        "-ac",
        "1",
        outPath,
      ]);
      p.on("error", reject);
      p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg_exit_${code}`))));
    });
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(inPath, { force: true }).catch(() => null);
    await fs.rm(outPath, { force: true }).catch(() => null);
  }
}
