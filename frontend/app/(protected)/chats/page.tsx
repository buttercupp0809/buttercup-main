import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listConversations } from "@/lib/chats";
import { ChatsPageList } from "@/components/chat/ChatsPageList";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  const user = await requireAuth();
  const rows = await listConversations(user.id);

  return (
    <section className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Chats</h1>
        <Link
          href="/gallery"
          className="text-sm underline"
          style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
        >
          Discover new companions
        </Link>
      </header>

      <ChatsPageList rows={rows} />
    </section>
  );
}
