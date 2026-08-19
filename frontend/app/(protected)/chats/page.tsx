import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listConversations } from "@/lib/chats";
import { getBondsForCharacters, getUserProgress } from "@/lib/progress";
import { ChatsPageList } from "@/components/chat/ChatsPageList";
import { StreakBadge } from "@/components/progress/StreakBadge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  const user = await requireAuth();
  const rows = await listConversations(user.id);
  // Bonds are batched in one pass for the whole list rather than per row: see
  // getBondsForCharacters. Progress carries the streak, which is the reason this
  // page is worth opening on a day when nobody has messaged you.
  const [bonds, progress] = await Promise.all([
    getBondsForCharacters(
      user.id,
      rows.map((r) => r.characterId),
    ),
    getUserProgress(user.id),
  ]);

  return (
    <section className="mx-auto max-w-4xl px-5 px-safe py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:gap-5">
        {/*
          Stacked on phones. Side by side, the title and this button collided at
          390px and the button ran past the right edge.
        */}
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.025em] text-[hsl(var(--bc-cream))] sm:text-4xl">
              Your people
            </h1>
            <p className="mt-1 text-sm text-[hsl(var(--bc-muted))] sm:mt-1.5">
              {rows.length > 0
                ? `${rows.length} ${rows.length === 1 ? "conversation" : "conversations"} in progress.`
                : "Nothing started yet."}
            </p>
          </div>
          {/* /discover, not /gallery: the public page drops the user out of the
              app shell and loses the bottom nav mid-session. */}
          <Link href="/discover" className="shrink-0">
            <Button variant="outline" size="sm">
              Find someone new
            </Button>
          </Link>
        </div>
        <StreakBadge streak={progress.streak} />
      </header>

      <ChatsPageList rows={rows} bonds={Object.fromEntries(bonds)} />
    </section>
  );
}
