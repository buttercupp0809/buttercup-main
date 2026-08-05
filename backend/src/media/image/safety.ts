// 18+ safety at the image path. Belt-and-suspenders over creation-time
// checks. Two guards:
//   1. assertCharacterAdult(character) - hard block if age < 18.
//   2. rejectMinorReference(userRequest) - block user prompts targeting
//      minors regardless of the character's persona.

const MINOR_PATTERNS = [
  /\b(child|kid|minor|underage|teen|preteen|schoolgirl|schoolboy|loli|shota|cub|prepubescent)\b/i,
  /\b(under\s*18|younger\s+girl|younger\s+boy|little\s+girl|little\s+boy)\b/i,
];

export class ImageSafetyError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "ImageSafetyError";
  }
}

export function assertCharacterAdult(character: { age: number }): void {
  if (character.age < 18) throw new ImageSafetyError("character_under_18");
}

export function rejectMinorReference(userRequest: string): void {
  for (const re of MINOR_PATTERNS) {
    if (re.test(userRequest)) throw new ImageSafetyError("minor_reference_in_prompt");
  }
}
