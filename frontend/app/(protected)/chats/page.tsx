import Link from "next/link";
import { requireAgeVerified } from "@/lib/auth";
import { listConversations } from "@/lib/chats";
import { AffectionMeter } from "@/components/relationship/AffectionMeter";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  const user = await requireAgeVerified();
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

      {rows.length === 0 ? (
        <div
          className="rounded-2xl border p-8 text-center"
          style={{
            borderColor: "hsl(var(--buttercupp-border))",
            backgroundColor: "hsl(var(--buttercupp-surface))",
          }}
        >
          <h2 className="font-display text-xl">No conversations yet</h2>
          <p className="mt-2 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
            Pick a companion in Discover and say hi.
          </p>
          <Link
            href="/gallery"
            className="mt-4 inline-block rounded-md px-4 py-2 text-sm font-semibold text-black"
            style={{ backgroundColor: "hsl(var(--buttercupp-accent-rose))" }}
          >
            Browse companions
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.characterId}>
              <Link
                href={`/chat/${r.characterId}`}
                className="flex items-center gap-3 rounded-xl border p-3 transition hover:-translate-y-0.5"
                style={{
                  borderColor: "hsl(var(--buttercupp-border))",
                  backgroundColor: "hsl(var(--buttercupp-surface))",
                }}
              >
                <div
                  className="h-12 w-12 shrink-0 overflow-hidden rounded-full"
                  style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
                >
                  {r.avatarUrl ? (
                    <img src={r.avatarUrl} alt={r.characterName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-semibold">
                      {r.characterName[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{r.characterName}</span>
                    {r.relationship ? (
                      <AffectionMeter
                        affectionLevel={r.relationship.affectionLevel}
                        mood={r.relationship.mood}
                        size="sm"
                      />
                    ) : null}
                  </div>
                  <div className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                    {r.messageCount} messages
                    {r.lastMessageAt ? ` · ${new Date(r.lastMessageAt).toLocaleString()}` : ""}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
