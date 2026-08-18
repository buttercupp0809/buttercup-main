import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { listConversations } from "@/lib/chats";
import { ChatsPageList } from "@/components/chat/ChatsPageList";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  const user = await requireAuth();
  const rows = await listConversations(user.id);

  const activeCount = rows.length;

  return (
    <section className="mx-auto max-w-5xl px-6 py-10 sm:py-12">
      <PageHeader
        eyebrow={activeCount > 0 ? `${activeCount} active` : "Inbox"}
        title="Your"
        accent="conversations"
        description="Pick up where you left off, or start something new with a fresh companion."
        actions={
          <>
            <Link href="/discover">
              <Button variant="outline" size="sm">Discover</Button>
            </Link>
            <Link href="/create">
              <Button size="sm">Create companion</Button>
            </Link>
          </>
        }
      />

      <ChatsPageList rows={rows} />
    </section>
  );
}
