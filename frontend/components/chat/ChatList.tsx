"use client";

// Left column of the chat surface: a searchable list of the user's
// conversations. Each row shows a hover menu with two actions:
//   Remove  - hides the tile locally (localStorage-persisted, no DB write)
//   Delete  - deletes the conversation from the DB, then hides the tile
//
// Below `lg` the inline aside is `hidden`, so `ChatListMobileTrigger` exposes
// the SAME list content through a PanelSheet left slide-over instead.

import * as React from "react";
import Link from "next/link";
import { Search, Users, MoreVertical, Trash2, EyeOff, Image as ImageIcon, Film } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationRow } from "@/lib/chats";
import { PanelSheet } from "@/components/chat/PanelSheet";

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

function shortTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Assistant image / video turns are historically stored with their raw
// data-URL blob as message.content. Detect those (or a rendered attachment
// marker) and surface a clean human label instead of leaking base64 into
// the sidebar. Text messages fall through to the trimmed preview.
interface PreviewContent {
  kind: "text" | "image" | "video" | "empty";
  text: string;
}

function preview(text: string | null): PreviewContent {
  if (!text || !text.trim()) return { kind: "empty", text: "Say hello" };
  const trimmed = text.trim();
  if (/^data:image\//i.test(trimmed) || /\[image\]/i.test(trimmed)) {
    return { kind: "image", text: "Sent a photo" };
  }
  if (/^data:video\//i.test(trimmed) || /\[video\]/i.test(trimmed)) {
    return { kind: "video", text: "Sent a video" };
  }
  return { kind: "text", text: trimmed.replace(/\*/g, "").slice(0, 60) };
}

export interface ChatListContentProps {
  conversations: ConversationRow[];
  activeCharacterId: string;
  onNavigate?: () => void;
}

// Shared header + search + list markup, reused by the desktop inline aside
// and the mobile PanelSheet so the two never drift out of sync.
function ChatListContent({ conversations, activeCharacterId, onNavigate }: ChatListContentProps) {
  const [q, setQ] = React.useState("");
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    setHidden(loadDismissed());
  }, []);

  const filtered = conversations.filter(
    (c) =>
      !hidden.has(c.conversationId) &&
      c.characterName.toLowerCase().includes(q.trim().toLowerCase()),
  );

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

  return (
    <>
      <div className="flex items-center justify-between px-4 py-4">
        <h2 className="font-display text-2xl font-semibold">Chat</h2>
        <Link
          href="/discover"
          onClick={onNavigate}
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
          filtered.map((c) => (
            <ConversationRow
              key={c.conversationId}
              conv={c}
              active={c.characterId === activeCharacterId}
              onRemove={() => handleRemove(c.conversationId)}
              onDelete={() => handleDelete(c.conversationId)}
              onNavigate={onNavigate}
            />
          ))
        )}
      </div>
    </>
  );
}

export function ChatList({ conversations, activeCharacterId }: ChatListContentProps) {
  return (
    <aside
      className="hidden h-full w-80 shrink-0 flex-col border-r lg:flex"
      style={{ borderColor: "hsl(var(--buttercupp-border))" }}
    >
      <ChatListContent conversations={conversations} activeCharacterId={activeCharacterId} />
    </aside>
  );
}

// Mobile/tablet access: below `lg` the aside above is `hidden`, so this
// trigger (surfaced in the compact chat top-bar) opens the same list content
// in a left slide-over PanelSheet.
export function ChatListMobileTrigger({ conversations, activeCharacterId }: ChatListContentProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open conversation list"
        data-testid="chatlist-trigger"
        className="tap-target flex items-center justify-center rounded-md text-white lg:hidden"
      >
        <Users className="h-5 w-5" />
      </button>
      <PanelSheet side="left" open={open} onClose={() => setOpen(false)} label="Conversations">
        <ChatListContent
          conversations={conversations}
          activeCharacterId={activeCharacterId}
          onNavigate={() => setOpen(false)}
        />
      </PanelSheet>
    </>
  );
}

function ConversationRow({
  conv,
  active,
  onRemove,
  onDelete,
  onNavigate,
}: {
  conv: ConversationRow;
  active: boolean;
  onRemove: () => void;
  onDelete: () => void;
  onNavigate?: () => void;
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
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition",
        active ? "" : "hover:bg-white/5",
      )}
      style={{
        ...(active ? { backgroundColor: "hsl(var(--buttercupp-surface-2))" } : undefined),
        zIndex: menuOpen ? 10 : "auto",
      }}
    >
      {/* Main clickable area: avatar + name + preview */}
      <Link
        href={`/chat/${conv.characterId}`}
        className="flex min-w-0 flex-1 items-center gap-3"
        onClick={() => {
          setMenuOpen(false);
          onNavigate?.();
        }}
      >
        <div
          className="h-11 w-11 shrink-0 overflow-hidden rounded-full"
          style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
        >
          {conv.avatarUrl ? (
            <img src={conv.avatarUrl} alt={conv.characterName} className="h-full w-full object-cover object-top" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-semibold">
              {conv.characterName[0]?.toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold" style={{ color: "hsl(var(--buttercupp-fg))" }}>
              {conv.characterName}
            </span>
            <span
              className="shrink-0 text-[11px]"
              style={{ color: "hsl(var(--buttercupp-muted))" }}
              suppressHydrationWarning
            >
              {shortTime(conv.lastMessageAt)}
            </span>
          </div>
          {(() => {
            const p = preview(conv.lastMessage);
            const icon =
              p.kind === "image" ? (
                <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : p.kind === "video" ? (
                <Film className="h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : null;
            return (
              <p
                className="flex items-center gap-1.5 truncate text-sm"
                style={{ color: "hsl(var(--buttercupp-muted))" }}
              >
                {icon}
                <span className={`truncate ${p.kind === "image" || p.kind === "video" ? "italic" : ""}`}>
                  {p.text}
                </span>
              </p>
            );
          })()}
        </div>
      </Link>

      {/* Actions button: visible on hover or when menu is open. tap-target
          keeps the touch hit area >= 44px while the icon glyph stays small. */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); setMenuOpen((o) => !o); }}
          aria-label="Conversation actions"
          className={cn(
            "tap-target flex h-7 w-7 items-center justify-center rounded-full transition",
            menuOpen
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
          style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))", color: "hsl(var(--buttercupp-muted))" }}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>

        {menuOpen && (
          <div
            className="absolute right-0 top-8 z-50 w-40 overflow-hidden rounded-xl border shadow-xl"
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
  );
}
