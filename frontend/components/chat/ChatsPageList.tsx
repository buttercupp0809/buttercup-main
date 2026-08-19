"use client";

// Full-page chat list for /chats. Mirrors the logic in ChatList (sidebar) but
// renders the wider card layout used on the standalone Chats page.
// Remove = hide in UI + persist to localStorage.
// Delete chat = DELETE /api/conversations/:id + hide in UI.

import * as React from "react";
import Link from "next/link";
import { MoreVertical, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BondPill } from "@/components/progress/BondMeter";
import type { BondProgress } from "@/lib/bond";
import type { ConversationRow } from "@/lib/chats";
import { relativeTime } from "@/lib/text";

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

export function ChatsPageList({
  rows,
  bonds = {},
}: {
  rows: ConversationRow[];
  /** Derived bond per characterId. Absent entries simply render no pill. */
  bonds?: Record<string, BondProgress>;
}) {
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
      <div className="flex flex-col items-center gap-3 rounded-[var(--bc-radius-lg)] border border-dashed border-[hsl(var(--bc-border-strong))] px-6 py-16 text-center">
        <h2 className="font-display text-xl font-semibold text-[hsl(var(--bc-fg))]">
          Nobody is waiting on you yet.
        </h2>
        <p className="max-w-[42ch] text-sm text-[hsl(var(--bc-muted))]">
          Pick anyone from the roster. She opens the conversation, so there is no blank page to
          stare at.
        </p>
        <Link href="/gallery" className="mt-1">
          <Button variant="brand" size="sm">
            Browse companions
          </Button>
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
          bond={bonds[r.characterId]}
          onRemove={() => handleRemove(r.conversationId)}
          onDelete={() => handleDelete(r.conversationId)}
        />
      ))}
    </ul>
  );
}

function ChatsPageRow({
  row,
  bond,
  onRemove,
  onDelete,
}: {
  row: ConversationRow;
  bond?: BondProgress;
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
        className="group relative flex items-center gap-3 rounded-[var(--bc-radius)] border border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface))] p-3 transition-[transform,border-color,background-color] duration-200 ease-[var(--ease-out)] hover:border-[hsl(var(--bc-amber)/0.32)] hover:bg-[hsl(var(--bc-surface-2)/0.7)] motion-safe:hover:-translate-y-0.5"
        style={{ zIndex: menuOpen ? 10 : "auto" }}
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
            <div className="flex items-baseline gap-2">
              <span className="truncate font-medium text-[hsl(var(--bc-fg))]">
                {row.characterName}
              </span>
              <span className="tabular ml-auto shrink-0 text-xs text-[hsl(var(--bc-subtle))]">
                {relativeTime(row.lastMessageAt)}
              </span>
            </div>
            {/*
              The last line she said is the reason to tap this row. The wide
              layout had room for it and was spending that room on a full
              locale timestamp instead.
            */}
            <p className="mt-0.5 truncate text-sm text-[hsl(var(--bc-muted))]">
              {row.lastMessage
                ? row.lastMessage.replace(/\*/g, "").trim()
                : "Say hello and she takes it from there."}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {bond ? <BondPill bond={bond} /> : null}
              <span className="tabular text-xs text-[hsl(var(--bc-subtle))]">
                {row.messageCount} {row.messageCount === 1 ? "message" : "messages"}
              </span>
            </div>
          </div>
        </Link>

        {/* Three-dot menu button */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setMenuOpen((o) => !o); }}
            aria-label="Conversation actions"
            aria-expanded={menuOpen}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-[hsl(var(--bc-muted))] transition-colors duration-200 hover:bg-[hsl(var(--bc-cream)/0.07)] hover:text-[hsl(var(--bc-fg))]"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div
              // Scales from the trigger in the top-right, not from its own centre.
              className="absolute right-0 top-11 z-50 w-44 origin-top-right overflow-hidden rounded-[var(--bc-radius-sm)] border border-[hsl(var(--bc-border-strong))] bg-[hsl(var(--bc-surface-2))] shadow-[var(--bc-shadow-lg)] motion-safe:animate-[buttercupp-card-in_160ms_var(--ease-out)_both]"
            >
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onRemove(); }}
                className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm text-[hsl(var(--bc-fg))] transition-colors duration-150 hover:bg-[hsl(var(--bc-cream)/0.06)]"
              >
                <EyeOff className="h-4 w-4 shrink-0 text-[hsl(var(--bc-muted))]" />
                Hide from list
              </button>
              <div className="mx-3 h-px bg-[hsl(var(--bc-border))]" />
              {/*
                Destructive, so it reads as danger rather than brand amber. The
                previous styling used the brand accent, which made deleting a
                conversation look like the recommended action.
              */}
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onDelete(); }}
                className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm text-[hsl(2_84%_74%)] transition-colors duration-150 hover:bg-[hsl(var(--bc-danger)/0.14)]"
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
