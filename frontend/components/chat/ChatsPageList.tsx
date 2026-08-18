"use client";

// Full-page chat list for /chats. Mirrors the logic in ChatList (sidebar) but
// renders the wider, glassy card layout used on the standalone Chats page.
// Remove = hide in UI + persist to localStorage.
// Delete chat = DELETE /api/conversations/:id + hide in UI.

import * as React from "react";
import Link from "next/link";
import { MoreVertical, EyeOff, Trash2, MessageCircle, Search, Sparkles } from "lucide-react";
import { AffectionMeter } from "@/components/relationship/AffectionMeter";
import { Button } from "@/components/ui/button";
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
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    setHidden(loadDismissed());
  }, []);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => !hidden.has(r.conversationId))
      .filter((r) => (q ? r.characterName.toLowerCase().includes(q) : true));
  }, [rows, hidden, query]);

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

  const hasAnyRows = rows.length > 0;

  if (!hasAnyRows) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
          style={{ color: "hsl(var(--buttercupp-muted))" }}
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your chats"
          aria-label="Search your chats"
          className="buttercupp-glass w-full rounded-xl py-2.5 pl-10 pr-3 text-sm outline-none transition placeholder:text-[hsl(var(--buttercupp-muted))] focus-visible:ring-2 focus-visible:ring-rose-400/70"
        />
      </div>

      {visible.length === 0 ? (
        <div
          className="buttercupp-glass rounded-2xl p-6 text-center text-sm"
          style={{ color: "hsl(var(--buttercupp-muted))" }}
        >
          No chats match “{query}”.
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visible.map((r) => (
            <ChatsPageRow
              key={r.conversationId}
              row={r}
              onRemove={() => handleRemove(r.conversationId)}
              onDelete={() => handleDelete(r.conversationId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="buttercupp-glass relative overflow-hidden rounded-3xl px-8 py-14 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(30rem 20rem at 50% -10%, hsl(var(--buttercupp-accent-rose) / 0.18), transparent 60%), radial-gradient(30rem 20rem at 50% 110%, hsl(var(--buttercupp-accent-violet) / 0.14), transparent 60%)",
        }}
      />
      <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{
            background:
              "linear-gradient(135deg, hsl(344 84% 71% / 0.18), hsl(262 72% 68% / 0.18))",
            color: "hsl(var(--buttercupp-accent-rose))",
          }}
        >
          <MessageCircle className="h-6 w-6" />
        </div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          No conversations yet
        </h2>
        <p className="text-sm" style={{ color: "hsl(var(--buttercupp-muted))" }}>
          Pick a companion in Discover and say hi, or design one that is uniquely yours.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Link href="/discover">
            <Button>
              <Sparkles className="h-4 w-4" aria-hidden />
              Browse companions
            </Button>
          </Link>
          <Link href="/create">
            <Button variant="outline">Create your own</Button>
          </Link>
        </div>
      </div>
    </div>
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
        className="buttercupp-glass group relative flex items-center gap-4 rounded-2xl p-3.5 transition duration-200 ease-out hover:-translate-y-0.5 hover:border-[hsl(var(--buttercupp-accent-rose)/0.45)] hover:shadow-[0_12px_40px_-16px_hsl(344_84%_71%/0.35)]"
        style={{ zIndex: menuOpen ? 10 : "auto" }}
      >
        {/* Avatar + name + metadata - clickable area */}
        <Link
          href={`/chat/${row.characterId}`}
          className="flex min-w-0 flex-1 items-center gap-4"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl ring-1 ring-white/10"
            style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
          >
            {row.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.avatarUrl}
                alt={row.characterName}
                className="h-full w-full object-cover object-top transition duration-500 ease-out group-hover:scale-105"
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center text-base font-semibold"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(344 84% 71% / 0.25), hsl(262 72% 68% / 0.25))",
                }}
              >
                {row.characterName[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold tracking-tight">{row.characterName}</span>
              {row.relationship ? (
                <AffectionMeter
                  affectionLevel={row.relationship.affectionLevel}
                  mood={row.relationship.mood}
                  size="sm"
                />
              ) : null}
            </div>
            <div
              className="mt-0.5 flex items-center gap-2 text-xs"
              style={{ color: "hsl(var(--buttercupp-muted))" }}
            >
              <span className="inline-flex items-center gap-1">
                <MessageCircle className="h-3 w-3" aria-hidden />
                {row.messageCount} messages
              </span>
              {row.lastMessageAt ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{formatRelative(row.lastMessageAt)}</span>
                </>
              ) : null}
            </div>
          </div>
        </Link>

        {/* Three-dot menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setMenuOpen((o) => !o);
            }}
            aria-label="Conversation actions"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition hover:bg-white/10"
            style={{ color: "hsl(var(--buttercupp-muted))" }}
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div
              className="buttercupp-glass absolute right-0 top-11 z-50 w-44 overflow-hidden rounded-xl"
            >
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-white/5"
                style={{ color: "hsl(var(--buttercupp-fg))" }}
              >
                <EyeOff className="h-4 w-4 shrink-0" style={{ color: "hsl(var(--buttercupp-muted))" }} />
                Hide
              </button>
              <div className="mx-3 h-px" style={{ backgroundColor: "hsl(var(--buttercupp-border))" }} />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
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

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
