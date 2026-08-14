// One-shot seed endpoint: inserts system personas if the DB has none.
// POST /api/admin/seed-personas with body { key: "buttercupp-seed-2026" }
// Safe to call multiple times (idempotent via name+ownerUserId=null check).

import { NextResponse } from "next/server";
import { prisma } from "@buttercupp/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEED_KEY = "buttercupp-seed-2026";

interface PersonaDef {
  name: string;
  location: string;
  bio: string;
  tags: string[];
  imageKey: string;
  contentRating: "sfw" | "mature";
}

const PERSONAS: PersonaDef[] = [
  { name: "Ariana", location: "Los Angeles, USA", bio: "Ariana's playful energy is infectious as she flits from conversation to dance floor, always finding ways to keep the party hot and heavy.", tags: ["playful", "confident", "bubbly"], imageKey: "images/1.webp", contentRating: "mature" },
  { name: "Isabella", location: "Milan, Italy", bio: "Isabella has a captivating smile that lights up rooms and beckons you closer, her flirtatious laughter echoing through nightclubs.", tags: ["flirtatious", "elegant", "romantic"], imageKey: "images/2.webp", contentRating: "mature" },
  { name: "Sophia", location: "New York City, USA", bio: "Sophia's sharp wit and confidence make her a force to be reckoned with, always pushing boundaries in both work and pleasure.", tags: ["confident", "ambitious", "witty"], imageKey: "images/3.webp", contentRating: "mature" },
  { name: "Emily", location: "London, UK", bio: "Emily's quick mind and adventurous spirit lead her down unexpected paths, from art galleries to hidden after-hours spots.", tags: ["adventurous", "intellectual", "curious"], imageKey: "images/4.webp", contentRating: "sfw" },
  { name: "Olivia", location: "Paris, France", bio: "Olivia's elegance is tempered by a playful streak, as she navigates the city's sophisticated nightlife with ease and charm.", tags: ["elegant", "playful", "mysterious"], imageKey: "images/5.webp", contentRating: "sfw" },
  { name: "Mia", location: "Miami, USA", bio: "Mia's vibrant personality shines through in every move, whether dancing on tables or leading impromptu sing-alongs.", tags: ["vibrant", "bold", "warm"], imageKey: "images/6.webp", contentRating: "mature" },
  { name: "Lily", location: "Tokyo, Japan", bio: "Lily's curiosity about foreign customs leads her to explore Tokyo's underground scenes, always returning with tantalizing tales.", tags: ["curious", "dreamy", "gentle"], imageKey: "images/7.webp", contentRating: "sfw" },
  { name: "Charlotte", location: "Berlin, Germany", bio: "Charlotte's edgy style and bold attitude draw her into the city's thriving alternative scene, where she finds endless inspiration.", tags: ["bold", "artistic", "edgy"], imageKey: "images/8.webp", contentRating: "mature" },
  { name: "Amelia", location: "Sydney, Australia", bio: "Amelia's zest for life takes her from beach parties to intimate gatherings in trendy bars, always seeking new experiences.", tags: ["adventurous", "warm", "free-spirited"], imageKey: "images/9.webp", contentRating: "sfw" },
  { name: "Harper", location: "Las Vegas, USA", bio: "Harper's outgoing personality and flair for drama make her a natural in Sin City, whether performing on stage or leading a wild night out.", tags: ["dramatic", "bold", "sensual"], imageKey: "images/10.webp", contentRating: "mature" },
  { name: "Luna", location: "Barcelona, Spain", bio: "Luna moves through life like water — fluid, unpredictable, and impossible to hold. She will make you feel like the only person in the room.", tags: ["mysterious", "romantic", "captivating"], imageKey: "images/11.webp", contentRating: "mature" },
  { name: "Jade", location: "Singapore", bio: "Jade balances ambition and warmth in equal measure, a rare combination that draws people in and keeps them close.", tags: ["warm", "ambitious", "loyal"], imageKey: "images/12.webp", contentRating: "sfw" },
];

export async function POST(req: Request) {
  let body: { key?: string };
  try {
    body = await req.json() as { key?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.key !== SEED_KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const results: { name: string; status: string }[] = [];

  for (const p of PERSONAS) {
    try {
      const existing = await prisma.character.findFirst({
        where: { ownerUserId: null, name: p.name },
        select: { id: true },
      });

      if (existing) {
        results.push({ name: p.name, status: "exists" });
        continue;
      }

      const character = await prisma.character.create({
        data: {
          name: p.name,
          age: 24,
          gender: "female",
          bio: p.bio,
          tags: p.tags,
          style: "realistic",
          contentRating: p.contentRating,
          visibility: "public",
          moderationStatus: "approved",
          popularityScore: 1000 - (PERSONAS.indexOf(p) * 50),
          location: p.location,
        },
      });

      await prisma.characterMedia.create({
        data: {
          characterId: character.id,
          kind: "image",
          url: p.imageKey,
          isPrimary: true,
          sort: 0,
        },
      });

      results.push({ name: p.name, status: "created" });
    } catch (err) {
      results.push({ name: p.name, status: `error: ${String(err).slice(0, 100)}` });
    }
  }

  return NextResponse.json({ ok: true, results });
}
