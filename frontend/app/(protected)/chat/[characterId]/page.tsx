import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma, CHARACTER_MEDIA_ORDER_BY } from "@buttercupp/database";
import { requireAuth } from "@/lib/auth";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ChatList, ChatListMobileTrigger } from "@/components/chat/ChatList";
import { PersonaPanel, PersonaPanelMobileTrigger, type PanelMedia } from "@/components/chat/PersonaPanel";
import { getRelationship } from "@/lib/relationship";
import { listConversations } from "@/lib/chats";
import { getCompanionBond } from "@/lib/progress";
import { getCompanionMemories } from "@/lib/memories";
import { freeHeadroom } from "@/lib/bond";
import { signAssetUrl } from "@/lib/cdn";
import { blurMany } from "@/lib/media-blur";
import { dedupeByIdentity, excludeHeroIdentity } from "@/lib/character-media";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  const user = await requireAuth();

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: {
      currentVersion: { include: { appearanceSheet: true } },
      media: {
        // hidden: false is load-bearing: see the HIDDEN MEDIA CONVENTION in
        // schema.prisma. Ordering imported from the canonical constant so
        // this and all other read sites (lib/characters.ts, lib/feed.ts,
        // lib/chats.ts, reels/page.tsx) can never drift.
        where: { hidden: false },
        orderBy: CHARACTER_MEDIA_ORDER_BY,
      },
    },
  });
  if (!character || !character.currentVersionId) notFound();
  if (character.contentRating === "mature") {
    const verified = user.ageVerificationLevel !== "none" && user.ageVerifiedAt !== null;
    if (!verified) notFound();
  }

  // Reuse the most recent open conversation or create one. upsert (not a
  // find-then-create check) so two near-simultaneous loads of the same chat
  // (double-click, tab duplication, a prefetch racing the real navigation)
  // cannot both pass the "does it exist" check and then both try to create,
  // which would trip the (userId, characterId) unique constraint.
  const conv = await prisma.conversation.upsert({
    where: { userId_characterId: { userId: user.id, characterId } },
    create: {
      userId: user.id,
      characterId,
      characterVersionId: character.currentVersionId,
    },
    update: {},
  });

  // The check-in is no longer pre-generated server-side. It now streams live
  // into the chat on entry (see ChatWindow's on-mount checkin call), so this
  // page just loads DB history and never inserts a check-in itself.

  // History window shrunk from 50 to 25 (see Plans/cursor-prompt/35-major-fixes-batch.md #I.3).
  // ChatWindow's client-side lazy loader picks up older turns on scroll-up.
  // This roughly halves the chat page's initial history payload, and once
  // input-image storage moves to MediaAsset (#E step 5), payloads shrink
  // further because content no longer carries multi-MB base64.
  const CHAT_INITIAL_HISTORY = 25;
  const historyRows = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "desc" },
    take: CHAT_INITIAL_HISTORY,
    include: { mediaAsset: { select: { s3Key: true } } },
  });
  const initialMessages = historyRows.reverse().map((m) => {
    // Null-guard: Message.content is String (not-null) in schema, but a
    // legacy row could hold an empty string, and being defensive here is
    // load-bearing: a `.startsWith` on undefined would throw during SSR and
    // 500 the whole /chat/<id> route (the observed "chat is broken" symptom
    // from #E). Coerce first, then match strictly on data:image/ so a
    // message that literally contains the substring "data:" (e.g. a
    // conversation about MIME types) is not misread as an inline image.
    const content = m.content ?? "";
    const isInlineImage = content.startsWith("data:image/");
    return {
      id: m.id,
      role: m.role,
      // Never send a multi-MB base64 blob through as `content` for a message
      // whose imageUrl is set: the ChatWindow renderer only reads `content`
      // when `imageUrl` is missing, but a defensive empty string prevents
      // future refactors from accidentally rendering the raw data URL as
      // text.
      // Never let a base64 data URL reach the client. Inlining a 2MB+ blob
      // (via content OR imageUrl) bloats the SSR response past Amplify's 6MB
      // Lambda limit -> HTTP 413 on the whole /chat/<id> route (the observed
      // "page isn't working" symptom). Legacy inline-image rows render as a
      // small marker instead of the raw data URL.
      content: isInlineImage ? "[shared a photo]" : content,
      createdAt: m.createdAt.toISOString(),
      // Only S3-backed images (via MediaAsset) produce a real imageUrl; a
      // base64 data URL in content is intentionally NOT surfaced.
      imageUrl: m.mediaAsset?.s3Key ? signAssetUrl(m.mediaAsset.s3Key) : undefined,
    };
  });

  // Sidebar conversation list previously fetched 50; the mobile drawer and
  // desktop rail only render ~12 at a time before scrolling, so shrinking
  // this take cuts DB work substantially per chat load. See #I.2.
  const CHAT_SIDEBAR_LIMIT = 12;
  const [relationship, conversations, bond, memories, quota] = await Promise.all([
    getRelationship(user.id, characterId),
    listConversations(user.id, CHAT_SIDEBAR_LIMIT),
    getCompanionBond(user.id, characterId),
    getCompanionMemories(user.id, characterId),
    // Read-only view of the free-trial counter the backend enforces. Presentation
    // only: the server still decides when to refuse a turn.
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        freeMessagesUsed: true,
        subscription: { select: { plan: true, status: true, currentPeriodEnd: true } },
      },
    }),
  ]);

  const onPaidPass =
    quota?.subscription?.status === "active" &&
    quota.subscription.plan !== null &&
    quota.subscription.plan !== "free" &&
    (quota.subscription.currentPeriodEnd === null ||
      quota.subscription.currentPeriodEnd.getTime() > Date.now());
  const headroom = onPaidPass ? null : freeHeadroom(quota?.freeMessagesUsed ?? 0);

  // Persona panel media: images -> carousel, videos -> assets strip. Local
  // paths (starting with /) are Next.js public/ static files (seed stock
  // art), not secret, and must pass through unsigned like every other read
  // site (lib/feed.ts, lib/chats.ts, lib/reels/data.ts) does. Dropping them
  // here previously meant a character whose free/display image happened to
  // be a local path fell through to the isPrimary hero as images[0], which
  // leaked the paywalled asset as the clear chat avatar. That must never
  // happen: images[0] has to be exactly the display asset the query already
  // sorted to the front, local or not.
  const images = character.media
    .filter((m) => m.kind === "image")
    .map((m) => {
      if (m.url.startsWith("/") || m.url.startsWith("http")) return m.url;
      return signAssetUrl(m.url);
    });
  // Dedup the panel image list by media identity (last segment of the key).
  // The seed writes byte-identical PNGs to two different owner-prefixed keys
  // and assigns one to isDisplay (index 0 here) and the other to isPrimary
  // (index 1 here), so string-equality dedup fails and images[1] leaks the
  // same picture as images[0] into the free gallery tile above the paywall.
  // Filtering by `mediaIdentity` normalizes to the last path segment which
  // is stable across owner prefix, signing tokens, and the /api/media proxy.
  // See frontend/lib/character-media.ts.
  const dedupedImages: string[] = dedupeByIdentity(images);
  const heroUrl: string | null = dedupedImages[0] ?? null;
  const galleryTail: string[] = excludeHeroIdentity(heroUrl, dedupedImages.slice(1));
  const carouselImages: string[] = heroUrl ? [heroUrl, ...galleryTail] : [];
  const assets: PanelMedia[] = character.media
    .filter((m) => m.kind === "video")
    .map((m) => ({ kind: "video" as const, url: m.url }));
  const avatarUrl = carouselImages[0] ?? null;

  // Pre-blur gallery images server-side so locked persona-panel tiles never
  // expose a real URL. Index 0 (the free/display image) is free; the rest
  // (including the isPrimary hero, now at index 1+) render blurred.
  //
  // Perf guard (Plans/cursor-prompt/35-major-fixes-batch.md #I step 1): the
  // blur pipeline fetches from S3 and runs sharp resize+blur+webp per
  // carousel image, which could scale linearly with image count and push
  // chat TTFB into seconds. Cap total blur work at 1500ms with a race, and
  // fall back to empty (client renders the safe blur-lg CSS shim already
  // used for missing entries). Long-term fix: precompute blur placeholders
  // at image-creation time so the read path is free.
  const BLUR_TIMEOUT_MS = 1500;
  const imageBlurs: string[] =
    carouselImages.length > 1
      ? await Promise.race([
          blurMany(carouselImages),
          new Promise<string[]>((resolve) => setTimeout(() => resolve([]), BLUR_TIMEOUT_MS)),
        ])
      : [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/*
        No separate mobile top strip. Below xl the two panel triggers and the
        Back control are handed to ChatWindow and rendered inside its header, so
        a phone shows one chat bar instead of three stacked ones.
      */}
      <div className="flex flex-1 overflow-hidden">
        <ChatList conversations={conversations} activeCharacterId={characterId} />

        <div className="min-w-0 flex-1">
          <ChatWindow
            conversationId={conv.id}
            characterId={characterId}
            initialMessages={initialMessages}
            characterName={character.name}
            wsUrl={process.env.NEXT_PUBLIC_WS_URL}
            avatarUrl={avatarUrl}
            relationship={relationship}
            bond={bond}
            greeting={character.currentVersion?.greeting ?? null}
            headroom={headroom}
            mobileLeading={
              <>
                <Link
                  href="/chats"
                  aria-label="Back to chats"
                  className="tap-target flex items-center justify-center rounded-md text-white lg:hidden"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <ChatListMobileTrigger
                  conversations={conversations}
                  activeCharacterId={characterId}
                />
              </>
            }
            mobileTrailing={
              <PersonaPanelMobileTrigger
                name={character.name}
                description={character.bio}
                location={character.location}
                images={carouselImages}
                imageBlurs={imageBlurs}
                assets={assets}
                characterId={characterId}
                memories={memories.items}
                memoryCursor={memories.nextCursor}
                memoryTotal={memories.total}
              />
            }
          />
        </div>

        <PersonaPanel
          name={character.name}
          description={character.bio}
          location={character.location}
          images={carouselImages}
          imageBlurs={imageBlurs}
          assets={assets}
          characterId={characterId}
          memories={memories.items}
          memoryCursor={memories.nextCursor}
          memoryTotal={memories.total}
        />
      </div>
    </div>
  );
}
