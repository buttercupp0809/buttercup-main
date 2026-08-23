/**
 * Bulk video scenario library for character video generation.
 *
 * Rotation logic: character index i (0-based) maps to scenario i % 10.
 * Examples:
 * - char 0 -> scenario 0 (Golden-hour beach)
 * - char 10 -> scenario 0 (Golden-hour beach, wraps)
 * - char 11 -> scenario 1 (Neon city night)
 */

export const BULK_SCENARIOS = [
  {
    title: "Golden-hour beach",
    prompt:
      "wearing a flowing white summer dress, walking barefoot along a golden-hour beach, gentle waves and warm sunlight behind her, hair moving in the sea breeze",
  },
  {
    title: "Neon city night",
    prompt:
      "wearing a stylish black leather jacket, standing on a rain-slick neon city street at night, glowing signs reflecting on the wet pavement, subtle steam rising",
  },
  {
    title: "Rainy cafe",
    prompt:
      "wearing a cozy cream knit sweater, sitting by a fogged-up window in a warm cafe on a rainy afternoon, holding a latte, soft daylight",
  },
  {
    title: "Rooftop sunset",
    prompt:
      "wearing an elegant satin evening gown, standing on a rooftop terrace at sunset with a glowing city skyline behind, breeze moving the fabric",
  },
  {
    title: "Autumn park",
    prompt:
      "wearing a chic wool coat and scarf, walking through an autumn park as golden leaves fall around her, warm afternoon light",
  },
  {
    title: "Luxury poolside",
    prompt:
      "wearing chic resort swimwear and a sheer cover-up, lounging beside a luxury infinity pool, palm trees and bright tropical sun",
  },
  {
    title: "Snowy alpine",
    prompt:
      "wearing a fashionable winter coat with fur trim, standing in a snowy alpine village as soft snow falls, mountains in the background",
  },
  {
    title: "Art gallery",
    prompt:
      "wearing a sleek minimalist outfit, walking slowly through a bright modern art gallery, glancing toward the camera, soft museum lighting",
  },
  {
    title: "Tropical garden",
    prompt:
      "wearing a delicate floral sundress, standing among lush tropical garden greenery and blooming flowers, dappled sunlight through leaves",
  },
  {
    title: "Studio glam",
    prompt:
      "wearing a high-fashion editorial outfit, posing under dramatic studio lighting against a seamless backdrop, confident turn toward the camera",
  },
] as const;

/**
 * Returns the scenario for a given character index using modulo rotation.
 * @param i Character index (0-based)
 * @returns Scenario object with title and prompt
 */
export function scenarioForIndex(i: number): {
  title: string;
  prompt: string;
} {
  return BULK_SCENARIOS[i % BULK_SCENARIOS.length];
}
