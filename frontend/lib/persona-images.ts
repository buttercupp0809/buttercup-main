// Local persona stock images served from frontend/public/personas. Used as a
// deterministic avatar fallback so a character with no generated/reference
// image still shows a picture instead of a blank letter tile. The mapping is
// stable per character (hashed from a seed like the character id) so a card
// does not change image between renders.

// Local stock images are no longer shown in the UI. Only S3/CloudFront URLs
// are rendered; local /personas paths are treated as absent. The files are
// kept on disk for future use.
export const PERSONA_IMAGES: readonly string[] = [];

export function pickPersonaImage(_seed: string): null {
  return null;
}
