// Local persona stock images served from frontend/public/personas. Used as a
// deterministic avatar fallback so a character with no generated/reference
// image still shows a picture instead of a blank letter tile. The mapping is
// stable per character (hashed from a seed like the character id) so a card
// does not change image between renders.

export const PERSONA_IMAGES = [
  "/personas/1.webp",
  "/personas/2.webp",
  "/personas/3.webp",
  "/personas/4.webp",
  "/personas/5.webp",
  "/personas/6.webp",
  "/personas/7.webp",
  "/personas/8.webp",
  "/personas/9.png",
  "/personas/10.png",
  "/personas/11.png",
] as const;

export function pickPersonaImage(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PERSONA_IMAGES[h % PERSONA_IMAGES.length];
}
