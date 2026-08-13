"use client";

// Full-page chat list for /chats. Mirrors the logic in ChatList (sidebar) but
// renders the wider card layout used on the standalone Chats page.
// Remove = hide in UI + persist to localStorage.
// Delete chat = DELETE /api/conversations/:id + hide in UI.

import * as React from "react";
import Link from "next/link";
import { MoreVertical, EyeOff, Trash2 } from "lucide-react";
import { AffectionMeter } from "@/components/relationship/AffectionMeter";
import type { ConversationRow } from "@/lib/chats";

const DISMISSED_KEY = "buttercupp:dismissed_conversations";

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore if storage is unavailable
  }
}

export function ChatsPageList({ rows }: { rows: ConversationRow[] }) {
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    setHidden(loadDismissed());
  }, []);

  const visible = rows.filter((r) => !hidden.has(r.conversationId));

  function handleRemove(conversationId: string) {
    setHidden((prev) => {
      const next = new Set(prev).add(conversationId);
      saveDismissed(next);
      return next;
    });
  }

  async function handleDelete(conversationId: string) {
    try {
      await fetch(`/api/conversations/${conversationId}`, { method: "DELETE" });
    } catch {
      // ignore; still remove from view
    }
    setHidden((prev) => {
      const next = new Set(prev).add(conversationId);
      saveDismissed(next);
      return next;
    });
  }

  if (visible.length === 0) {
    return (
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
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {visible.map((r) => (
        <ChatsPageRow
          key={r.conversationId}
          row={r}
          onRemove={() => handleRemove(r.conversationId)}
          onDelete={() => handleDelete(r.conversationId)}
        />
      ))}
    </ul>
  );
}

function ChatsPageRow({
  row,
  onRemove,
  onDelete,
}: {
  row: ConversationRow;
  onRemove: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  return (
    <li>
      <div
        className="group relative flex items-center gap-3 rounded-xl border p-3 transition hover:-translate-y-0.5"
        style={{
          borderColor: "hsl(var(--buttercupp-border))",
          backgroundColor: "hsl(var(--buttercupp-surface))",
          zIndex: menuOpen ? 10 : "auto",
        }}
      >
        {/* Avatar + name + metadata - clickable area */}
        <Link
          href={`/chat/${row.characterId}`}
          className="flex min-w-0 flex-1 items-center gap-3"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="h-12 w-12 shrink-0 overflow-hidden rounded-full"
            style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
          >
            {row.avatarUrl ? (
              <img src={row.avatarUrl} alt={row.characterName} className="h-full w-full object-cover object-top" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold">
                {row.characterName[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{row.characterName}</span>
              {row.relationship ? (
                <AffectionMeter
                  affectionLevel={row.relationship.affectionLevel}
                  mood={row.relationship.mood}
                  size="sm"
                />
              ) : null}
            </div>
            <div className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              {row.messageCount} messages
              {row.lastMessageAt ? ` · ${new Date(row.lastMessageAt).toLocaleString()}` : ""}
            </div>
          </div>
        </Link>

        {/* Three-dot menu button */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setMenuOpen((o) => !o); }}
            aria-label="Conversation actions"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition hover:bg-white/10"
            style={{ color: "hsl(var(--buttercupp-muted))" }}
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-9 z-50 w-40 overflow-hidden rounded-xl border shadow-xl"
              style={{
                backgroundColor: "hsl(var(--buttercupp-surface))",
                borderColor: "hsl(var(--buttercupp-border))",
              }}
            >
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onRemove(); }}
                className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-white/5"
                style={{ color: "hsl(var(--buttercupp-fg))" }}
              >
                <EyeOff className="h-4 w-4 shrink-0" style={{ color: "hsl(var(--buttercupp-muted))" }} />
                Remove
              </button>
              <div className="mx-3 h-px" style={{ backgroundColor: "hsl(var(--buttercupp-border))" }} />
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onDelete(); }}
                className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-rose-500/10"
                style={{ color: "hsl(var(--buttercupp-accent-rose))" }}
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                Delete chat
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
