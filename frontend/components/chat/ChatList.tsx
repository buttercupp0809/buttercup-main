"use client";

// Left column of the chat surface: a searchable list of the user's
// conversations. Mirrors the Candy.ai layout (header + New Group + search +
// rows). Purely presentational over data loaded by the chat page.

import * as React from "react";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationRow } from "@/lib/chats";

function shortTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Drop gesture asterisks so the preview reads as plain text.
function preview(text: string | null): string {
  if (!text) return "Say hello";
  return text.replace(/\*/g, "").trim().slice(0, 60);
}

export function ChatList({
  conversations,
  activeCharacterId,
}: {
  conversations: ConversationRow[];
  activeCharacterId: string;
}) {
  const [q, setQ] = React.useState("");
  const filtered = conversations.filter((c) =>
    c.characterName.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <aside
      className="hidden h-full w-80 shrink-0 flex-col border-r lg:flex"
      style={{ borderColor: "hsl(var(--buttercupp-border))" }}
    >
      <div className="flex items-center justify-between px-4 py-4">
        <h2 className="font-display text-2xl font-semibold">Chat</h2>
        <Link
          href="/discover"
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium"
          style={{ borderColor: "hsl(var(--buttercupp-border))", color: "hsl(var(--buttercupp-accent-rose))" }}
        >
          <Users className="h-4 w-4" />
          New Group
        </Link>
      </div>

      <div className="px-3 pb-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: "hsl(var(--buttercupp-muted))" }}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search for a profile..."
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            style={{
              backgroundColor: "hsl(var(--buttercupp-surface))",
              borderColor: "hsl(var(--buttercupp-border))",
              color: "hsl(var(--buttercupp-fg))",
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
            No conversations yet.
          </p>
        ) : (
          filtered.map((c) => {
            const active = c.characterId === activeCharacterId;
            return (
              <Link
                key={c.characterId}
                href={`/chat/${c.characterId}`}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 transition",
                  active ? "" : "hover:bg-white/5",
                )}
                style={active ? { backgroundColor: "hsl(var(--buttercupp-surface-2))" } : undefined}
              >
                <div
                  className="h-11 w-11 shrink-0 overflow-hidden rounded-full"
                  style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
                >
                  {c.avatarUrl ? (
                    <img src={c.avatarUrl} alt={c.characterName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-semibold">
                      {c.characterName[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold" style={{ color: "hsl(var(--buttercupp-fg))" }}>
                      {c.characterName}
                    </span>
                    <span className="shrink-0 text-[11px]" style={{ color: "hsl(var(--buttercupp-muted))" }} suppressHydrationWarning>
                      {shortTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <p className="truncate text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
                    {preview(c.lastMessage)}
                  </p>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </aside>
  );
}
