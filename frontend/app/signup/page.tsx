import { prisma } from "@buttercupp/database";

// DB is unreachable from the Amplify build container; force SSR so the
// prisma call only runs at request time when RDS is accessible.
export const dynamic = "force-dynamic";
import { signAssetUrl } from "@/lib/cdn";
import { CharacterPreviewPanel, type PreviewChar } from "@/components/auth/CharacterPreviewPanel";
import { SignupForm } from "./SignupForm";

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
      skip: 4,
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

export default async function SignupPage() {
  const chars = await getFeaturedChars();
  return (
    <main className="flex min-h-screen">
      <CharacterPreviewPanel
        chars={chars}
        tagline="Your companion awaits."
        subtitle="Create your account in seconds."
      />
      <SignupForm />
    </main>
  );
}
