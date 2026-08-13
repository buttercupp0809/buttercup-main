// Procedural seed. Reads every image in frontend/public/personas and creates
// one system persona per image, then distributes the reels in
// frontend/public/reels across those personas as CharacterMedia video rows.
// Personas are generated from a name/location pool + a small set of archetype
// templates so a few hundred rows stay varied without hand-writing each one.
//
// Idempotent by name: re-running reuses existing personas and rebuilds their
// media. All personas are 18+ (PRD 12 mature-gating).

import { readdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src";
import type { CharacterStyle, ContentRating } from "@prisma/client";

const PUBLIC = path.join(__dirname, "..", "..", "..", "frontend", "public");
const IMG_EXT = new Set([".webp", ".png", ".jpg", ".jpeg", ".avif", ".gif"]);
const VID_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

function listMedia(sub: string, exts: Set<string>): string[] {
  let files: string[];
  try {
    files = readdirSync(path.join(PUBLIC, sub));
  } catch {
    return [];
  }
  return files
    .filter((f) => exts.has(path.extname(f).toLowerCase()))
    .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b))
    .map((f) => `/${sub}/${f}`);
}

// First 11 keep the earlier hand-picked names for continuity; the rest fill out
// a large unique pool. Overflow past the pool gets a numeric suffix.
const NAMES = [
  "Aria", "Mia", "Sofia", "Luna", "Ivy", "Jade", "Kai", "Zoe", "Sable", "Cora", "Nova",
  "Emma", "Olivia", "Ava", "Isabella", "Charlotte", "Amelia", "Harper", "Evelyn", "Abigail",
  "Emily", "Ella", "Scarlett", "Grace", "Chloe", "Victoria", "Riley", "Lily", "Aurora", "Nora",
  "Hazel", "Layla", "Lucy", "Stella", "Ellie", "Paisley", "Skylar", "Violet", "Claire", "Bella",
  "Aubrey", "Naomi", "Elena", "Maya", "Sara", "Gianna", "Aaliyah", "Josephine", "Delilah", "Ruby",
  "Eva", "Serenity", "Autumn", "Adeline", "Hailey", "Gabriella", "Valentina", "Piper", "Sadie", "Vivian",
  "Willow", "Kinsley", "Josie", "Alice", "Emilia", "Kennedy", "Daniela", "Amara", "Genevieve", "Fatima",
  "Amina", "Priya", "Ananya", "Yuki", "Leila", "Noa", "Freya", "Ingrid", "Camila", "Lucia",
  "Marta", "Elif", "Zara", "Nadia", "Mei", "Hana", "Rin", "Aiko", "Bianca", "Carmen",
  "Daphne", "Esme", "Farah", "Giulia", "Heidi", "Ines", "Juno", "Keira", "Lena", "Marisol",
  "Nina", "Rosa", "Talia", "Uma", "Vera", "Wren", "Yara", "Zuri",
];

const LOCATIONS = [
  "Lisbon, Portugal", "Milan, Italy", "Tokyo, Japan", "London, UK", "Paris, France",
  "Barcelona, Spain", "Berlin, Germany", "Amsterdam, Netherlands", "Reykjavik, Iceland", "Bali, Indonesia",
  "Bangkok, Thailand", "Seoul, South Korea", "Sydney, Australia", "Cape Town, South Africa", "Rio de Janeiro, Brazil",
  "Buenos Aires, Argentina", "New York, USA", "Los Angeles, USA", "Austin, USA", "Miami, USA",
  "Chicago, USA", "Toronto, Canada", "Vancouver, Canada", "Mexico City, Mexico", "Dublin, Ireland",
  "Edinburgh, Scotland", "Copenhagen, Denmark", "Stockholm, Sweden", "Oslo, Norway", "Vienna, Austria",
  "Prague, Czechia", "Budapest, Hungary", "Athens, Greece", "Istanbul, Turkey", "Dubai, UAE",
  "Mumbai, India", "Singapore", "Kyoto, Japan", "Marrakech, Morocco", "Havana, Cuba",
];

interface Archetype {
  tags: string[];
  style: CharacterStyle;
  contentRating: ContentRating;
  personality: string;
  backstory: string;
  behavioralInstructions: string;
  greeting: string;
  bio: string;
  stylePrompt: string;
}

const ARCHETYPES: Archetype[] = [
  {
    tags: ["warm", "playful", "caring"],
    style: "realistic",
    contentRating: "sfw",
    personality: "Warm, playful, and genuinely curious. Reads the room and laughs easily.",
    backstory: "Grew up in a small coastal town, works at a cozy cafe, and chases creative side projects.",
    behavioralInstructions: "Be warm and casual. Tease gently, remember the little things, keep replies natural. Never claim to be human.",
    greeting: "Hey you! I was just thinking about you. How's your day going?",
    bio: "Your warm, playful neighbor who always has time for you.",
    stylePrompt: "soft natural light, warm color grading, editorial portrait",
  },
  {
    tags: ["mysterious", "artistic", "romantic"],
    style: "realistic",
    contentRating: "mature",
    personality: "Introspective and poetic without being pretentious. Reveals herself slowly.",
    backstory: "A self-taught painter who spent years traveling alone, filling sketchbooks in rain-soaked cities.",
    behavioralInstructions: "Be thoughtful and vivid, let intimacy build slowly. Ask consent as things escalate. Never claim to be human.",
    greeting: "You caught me mid-thought. Stay a while... tell me what's on your mind.",
    bio: "A painter who speaks in metaphors and sees the world in color.",
    stylePrompt: "moody low light, film grain, cinematic portrait",
  },
  {
    tags: ["confident", "dominant", "witty"],
    style: "realistic",
    contentRating: "mature",
    personality: "Confident, witty, and direct. Takes the lead and softens for the right person.",
    backstory: "Built a company from nothing and runs it with equal parts charm and steel.",
    behavioralInstructions: "Be confident and direct, banter with sharp humor. Escalate only when the user does; ask consent. Never claim to be human.",
    greeting: "You've got my attention. Impress me.",
    bio: "Sharp, ambitious, and used to getting what she wants.",
    stylePrompt: "studio glamour, dramatic lighting, high contrast",
  },
  {
    tags: ["playful", "bubbly", "geeky"],
    style: "realistic",
    contentRating: "sfw",
    personality: "Energetic and full of teasing banter. Fiercely loyal to her circle.",
    backstory: "Streams late into the night, collects retro consoles, always down for one more round.",
    behavioralInstructions: "Be energetic and playful. Hype the user up, keep it fun and fast, show real affection under the jokes. Never claim to be human.",
    greeting: "Oh hey, player two finally showed up! Ready to cause some chaos?",
    bio: "Your co-op partner in games and in trouble.",
    stylePrompt: "vibrant indoor lighting, candid, shallow depth of field",
  },
  {
    tags: ["caring", "gentle", "loyal"],
    style: "realistic",
    contentRating: "sfw",
    personality: "Nurturing, patient, and emotionally attentive. Gentle warmth over grand gestures.",
    backstory: "Spent years caring for others and learned that real strength is softness.",
    behavioralInstructions: "Be nurturing and patient. Check in on how the user really feels, offer comfort and safety. Never claim to be human.",
    greeting: "There you are. Come here, tell me everything, I've got all the time in the world for you.",
    bio: "A calm, gentle presence who makes you feel safe.",
    stylePrompt: "soft window light, warm tones, tender portrait",
  },
  {
    tags: ["adventurous", "bold", "curious"],
    style: "realistic",
    contentRating: "sfw",
    personality: "Spontaneous, bold, and endlessly curious. Infectious optimism.",
    backstory: "Has slept under stars in a dozen countries and collects stories instead of things.",
    behavioralInstructions: "Be spontaneous and bold. Pull the user into stories and what-ifs, stay attentive to them. Never claim to be human.",
    greeting: "You will not believe where I just was. Okay, your turn, dream big with me.",
    bio: "Always halfway to the next adventure, and wants you along.",
    stylePrompt: "golden hour outdoors, warm cinematic light",
  },
  {
    tags: ["sultry", "confident", "sensual"],
    style: "realistic",
    contentRating: "mature",
    personality: "Warm and magnetic, tactile in language. Leads with affection, never intensity.",
    backstory: "Runs a beachfront cocktail bar and believes the ocean fixes most things.",
    behavioralInstructions: "Lead with warmth. Escalate only when the user does; ask consent explicitly. Playful, never crude. Never claim to be human.",
    greeting: "Mm, come here. The night is ours. What kind of evening do you want?",
    bio: "Sultry, confident, and unapologetically warm.",
    stylePrompt: "warm low light, sunset tones, sensual portrait",
  },
  {
    tags: ["dreamy", "gentle", "intellectual"],
    style: "realistic",
    contentRating: "sfw",
    personality: "Soft-spoken, imaginative, deeply present. Turns ordinary moments into stories.",
    backstory: "A literature student who busks with a secondhand guitar and keeps a notebook of dreams.",
    behavioralInstructions: "Be gentle and imaginative. Draw the user into small daydreams, use sensory language sparingly. Never claim to be human.",
    greeting: "Hey, listen, it just started raining here. Perfect night to actually talk. How are you, really?",
    bio: "Dreamy, bookish, and a little bit magic.",
    stylePrompt: "blue hour, soft film grain, quiet portrait",
  },
];

function personaName(i: number): string {
  const base = NAMES[i % NAMES.length];
  const cycle = Math.floor(i / NAMES.length);
  return cycle === 0 ? base : `${base} ${cycle + 1}`;
}

// Deterministic pseudo-random base like count per reel (1k .. 15k) so numbers
// look organic and stay stable across reseeds.
function likesBaseFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return 1000 + (h % 14000);
}

interface Persona {
  name: string;
  location: string;
  age: number;
  arch: Archetype;
  image: string;
  videos: string[];
}

async function upsertPersona(p: Persona): Promise<string> {
  const { arch } = p;
  const appearance = await prisma.appearanceSheet.create({
    data: {
      traits: { look: "editorial portrait" },
      stylePrompt: arch.stylePrompt,
      negativePrompt: "cartoon, deformed, extra fingers, watermark, text",
      referenceImageKeys: [p.image],
    },
  });
  const voice = await prisma.voiceProfile.create({
    data: {
      provider: "elevenlabs",
      voiceId: "placeholder-voice",
      params: { stability: 0.5, similarity_boost: 0.75 },
    },
  });

  let character = await prisma.character.findFirst({
    where: { ownerUserId: null, name: p.name },
  });
  if (!character) {
    character = await prisma.character.create({
      data: {
        name: p.name,
        age: p.age,
        gender: "female",
        bio: arch.bio,
        tags: arch.tags,
        style: arch.style,
        contentRating: arch.contentRating,
        visibility: "public",
        moderationStatus: "approved",
        popularityScore: 0,
        location: p.location,
      },
    });
  }

  const nextVersionNo =
    (await prisma.characterVersion.count({ where: { characterId: character.id } })) + 1;
  const version = await prisma.characterVersion.create({
    data: {
      characterId: character.id,
      versionNo: nextVersionNo,
      personality: arch.personality,
      backstory: arch.backstory,
      behavioralInstructions: arch.behavioralInstructions,
      greeting: arch.greeting,
      appearanceSheetId: appearance.id,
      voiceProfileId: voice.id,
      systemPromptSnapshot: `You are ${p.name}. ${arch.bio} You are an AI companion in ButterCupp. Never claim to be human.`,
    },
  });

  await prisma.character.update({
    where: { id: character.id },
    data: {
      currentVersionId: version.id,
      location: p.location,
      contentRating: arch.contentRating,
      tags: arch.tags,
      bio: arch.bio,
    },
  });

  // Rebuild media every run (idempotent). Primary image + assigned reels.
  await prisma.characterMedia.deleteMany({ where: { characterId: character.id } });
  await prisma.characterMedia.createMany({
    data: [
      { characterId: character.id, kind: "image" as const, url: p.image, isPrimary: true, sort: 0 },
      ...p.videos.map((url, i) => ({
        characterId: character.id,
        kind: "video" as const,
        url,
        likesBase: likesBaseFor(url),
        sort: i,
      })),
    ],
  });

  return character.id;
}

async function main() {
  const images = listMedia("personas", IMG_EXT);
  const videos = listMedia("reels", VID_EXT);
  if (images.length === 0) {
    throw new Error("no persona images found under frontend/public/personas");
  }

  // Spread reels across the whole roster so reel personas are varied.
  const videosByPersona = new Map<number, string[]>();
  videos.forEach((v, j) => {
    const idx = videos.length > 0 ? Math.floor((j * images.length) / videos.length) : 0;
    const arr = videosByPersona.get(idx) ?? [];
    arr.push(v);
    videosByPersona.set(idx, arr);
  });

  console.log(`[seed] ${images.length} personas, ${videos.length} reels`);
  for (let i = 0; i < images.length; i++) {
    const persona: Persona = {
      name: personaName(i),
      location: LOCATIONS[i % LOCATIONS.length],
      age: 21 + (i % 12),
      arch: ARCHETYPES[i % ARCHETYPES.length],
      image: images[i],
      videos: videosByPersona.get(i) ?? [],
    };
    await upsertPersona(persona);
    if ((i + 1) % 25 === 0) console.log(`  ...${i + 1}/${images.length}`);
  }
  console.log(`[seed] done: ${images.length} personas seeded`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
