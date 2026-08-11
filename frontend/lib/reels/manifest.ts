// Reel feed manifest. Reels are file-driven (videos in public/reels) with
// their display metadata declared here, so adding a reel is: drop N.mp4 in
// public/reels and add a row below. `characterName` links "Chat Now" to a
// seeded system character (resolved to an id at request time), and `avatar`
// is the small circle next to the name. `baseLikes` is the seeded like count
// the per-user ReelLike rows are added on top of.

export interface ReelMeta {
  id: string; // matches the public/reels/<id>.mp4 filename stem
  src: string;
  name: string;
  location: string;
  characterName: string;
  avatar: string;
  baseLikes: number;
}

export const REELS: ReelMeta[] = [
  { id: "1", src: "/reels/1.mp4", name: "Aria", location: "Lisbon, Portugal", characterName: "Aria", avatar: "/personas/1.webp", baseLikes: 6994 },
  { id: "2", src: "/reels/2.mp4", name: "Mia", location: "Austin, USA", characterName: "Mia", avatar: "/personas/2.webp", baseLikes: 4821 },
  { id: "3", src: "/reels/3.mp4", name: "Sofia", location: "Milan, Italy", characterName: "Sofia", avatar: "/personas/3.webp", baseLikes: 8320 },
  { id: "4", src: "/reels/4.mp4", name: "Luna", location: "Reykjavik, Iceland", characterName: "Luna", avatar: "/personas/4.webp", baseLikes: 3157 },
  { id: "5", src: "/reels/5.mp4", name: "Ivy", location: "London, UK", characterName: "Ivy", avatar: "/personas/5.webp", baseLikes: 9640 },
  { id: "6", src: "/reels/6.mp4", name: "Jade", location: "Tokyo, Japan", characterName: "Jade", avatar: "/personas/6.webp", baseLikes: 2748 },
  { id: "7", src: "/reels/7.mp4", name: "Cora", location: "Bali, Indonesia", characterName: "Cora", avatar: "/personas/10.png", baseLikes: 12030 },
  { id: "8", src: "/reels/8.mp4", name: "Zoe", location: "Cape Town, South Africa", characterName: "Zoe", avatar: "/personas/8.webp", baseLikes: 5562 },
];

export function reelById(id: string): ReelMeta | undefined {
  return REELS.find((r) => r.id === id);
}
