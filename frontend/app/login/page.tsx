import { prisma } from "@buttercupp/database";
import { signAssetUrl } from "@/lib/cdn";
import { CharacterPreviewPanel, type PreviewChar } from "@/components/auth/CharacterPreviewPanel";
import { LoginForm } from "./LoginForm";

async function getFeaturedChars(): Promise<PreviewChar[]> {
  try {
    const chars = await prisma.character.findMany({
      where: { ownerUserId: null, visibility: "public", moderationStatus: "approved" },
      orderBy: { popularityScore: "desc" },
      select: {
        name: true,
        media: {
          where: { kind: "image", isPrimary: true },
          take: 1,
          select: { url: true },
        },
      },
      take: 4,
    });
    return chars
      .map((c) => {
        const u = c.media[0]?.url;
        if (!u) return null;
        const avatarUrl = u.startsWith("/") || u.startsWith("http") ? u : signAssetUrl(u);
        return { name: c.name, avatarUrl };
      })
      .filter((c): c is PreviewChar => c !== null);
  } catch {
    return [];
  }
}

export default async function LoginPage() {
  const chars = await getFeaturedChars();
  return (
    <main className="flex min-h-screen">
      <CharacterPreviewPanel
        chars={chars}
        tagline="Your companion awaits."
        subtitle="Sign in and pick up where you left off."
      />
      <LoginForm />
    </main>
  );
}
