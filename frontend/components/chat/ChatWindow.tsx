"use client";

import * as React from "react";
import { createChatTransport, type TransportEvent, type TransportPaywallPlan } from "@/lib/chat-transport";
import { Image as ImageIcon, Video, Send } from "lucide-react";
import { AffectionMeter } from "@/components/relationship/AffectionMeter";
import { GestureText } from "@/components/chat/GestureText";
import { TypingDots } from "@/components/chat/TypingDots";
import { PaywallModal } from "@/components/chat/PaywallModal";
import { ImageMessage } from "@/components/chat/ImageMessage";
import { LockedBadge } from "@/components/trust/LockedBadge";
import { BondPill } from "@/components/progress/BondMeter";
import type { BondProgress, Headroom } from "@/lib/bond";

interface PaywallState {
  scope: "free_trial" | "plan_quota";
  kind: "chat" | "image" | "video";
  used: number;
  limit: number;
  plans: TransportPaywallPlan[];
}

export interface RelationshipHeader {
  affectionLevel: number;
  mood: string | null;
  milestones: string[];
}

interface HistoryMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  // When set, this message renders as a generated image instead of text.
  imageUrl?: string;
}

export interface ChatWindowProps {
  conversationId: string;
  /**
   * The character this chat is with. Needed to request the on-entry check-in
   * stream, which mirrors the reply stream's identifying body fields.
   */
  characterId: string;
  initialMessages: HistoryMessage[];
  characterName: string;
  wsUrl?: string;
  avatarUrl?: string | null;
  relationship?: RelationshipHeader | null;
  /** Derived bond, shown in the header in place of the legacy affection meter. */
  bond?: BondProgress | null;
  /**
   * The character's authored opening line. Rendered as the empty state so a
   * fresh conversation opens with her talking instead of a blank pane.
   */
  greeting?: string | null;
  /** Remaining free messages, so the wall is visible before it is hit. */
  headroom?: Headroom | null;
  /**
   * Controls hosted inside the header below xl, where the side panels are
   * hidden and their triggers have nowhere else to live. Rendering them here
   * instead of in a second strip keeps mobile to a single chat bar.
   */
  mobileLeading?: React.ReactNode;
  mobileTrailing?: React.ReactNode;
}

export function ChatWindow({
  conversationId,
  characterId,
  initialMessages,
  characterName,
  wsUrl,
  avatarUrl,
  relationship,
  bond,
  greeting,
  headroom,
  mobileLeading,
  mobileTrailing,
}: ChatWindowProps) {
  const [messages, setMessages] = React.useState<HistoryMessage[]>(initialMessages);
  const [streaming, setStreaming] = React.useState("");
  const [safety, setSafety] = React.useState<{ message: string; resources: { label: string; url: string }[] } | null>(null);
  const [pending, setPending] = React.useState(false);
  // Gates the typing-dots vs streaming-bubble render: dots show while a turn
  // is pending AND no token has landed yet. Reset on submit + on any
  // terminal transport event so a subsequent turn re-shows dots.
  const [firstTokenSeen, setFirstTokenSeen] = React.useState(false);
  const [paywall, setPaywall] = React.useState<PaywallState | null>(null);
  const [imageGenerating, setImageGenerating] = React.useState(false);
  const [input, setInput] = React.useState("");
  // Last failed turn. Held so the user gets an explanation plus a one-tap retry
  // instead of a message that silently goes nowhere.
  const [failed, setFailed] = React.useState<string | null>(null);
  const scrollAreaRef = React.useRef<HTMLDivElement | null>(null);
  const transportRef = React.useRef<ReturnType<typeof createChatTransport> | null>(null);
  const streamedRef = React.useRef("");
  const lastSentRef = React.useRef<string | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  // Guards the on-mount check-in stream so React strict-mode's double invoke
  // (and any re-render) cannot fire it more than once per mount.
  const checkinStartedRef = React.useRef(false);

  // Composer auto-grow. The textarea starts one line tall, grows to fit its
  // content up to a cap (~6 lines), then scrolls internally. Kept in a helper
  // so both onInput and the post-send reset share the same clamp.
  const MAX_INPUT_HEIGHT = 160;
  const resizeInput = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT ? "auto" : "hidden";
  }, []);
  const resetInputHeight = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.overflowY = "hidden";
  }, []);

  React.useEffect(() => {
    const t = createChatTransport({ wsUrl });
    transportRef.current = t;
    const off = t.on((evt: TransportEvent) => {
      if (evt.type === "token") {
        streamedRef.current += evt.delta;
        setStreaming(streamedRef.current);
        setFirstTokenSeen(true);
      } else if (evt.type === "done") {
        const text = streamedRef.current;
        streamedRef.current = "";
        setStreaming("");
        if (text.length > 0) {
          setMessages((ms) =>
            ms.some((m) => m.id === evt.messageId)
              ? ms
              : [...ms, { id: evt.messageId, role: "assistant", content: text, createdAt: new Date().toISOString() }],
          );
        }
        setPending(false);
        setFirstTokenSeen(false);
      } else if (evt.type === "safety") {
        setSafety({ message: evt.message, resources: evt.resources });
        setPending(false);
        streamedRef.current = "";
        setStreaming("");
        setFirstTokenSeen(false);
      } else if (evt.type === "paywall") {
        // Server refused to generate. Show the blocking modal; input stays
        // disabled until the modal's poll sees `active=true`.
        setPaywall({
          scope: evt.scope,
          kind: evt.kind,
          used: evt.used,
          limit: evt.limit,
          plans: evt.plans,
        });
        setPending(false);
        streamedRef.current = "";
        setStreaming("");
        setFirstTokenSeen(false);
      } else if (evt.type === "image_generating") {
        // Teaser is complete. Finalize it as a real message, clear streaming
        // state, then show the loading skeleton while the image generates.
        const text = streamedRef.current;
        streamedRef.current = "";
        setStreaming("");
        setFirstTokenSeen(false);
        if (text.length > 0) {
          setMessages((ms) =>
            ms.some((m) => m.id === evt.messageId)
              ? ms
              : [...ms, { id: evt.messageId, role: "assistant", content: text, createdAt: new Date().toISOString() }],
          );
        }
        // Keep pending=true: block input while image is in flight.
        setImageGenerating(true);
      } else if (evt.type === "image") {
        setImageGenerating(false);
        setPending(false);
        setFirstTokenSeen(false);
        setMessages((ms) =>
          ms.some((m) => m.id === evt.mediaAssetId)
            ? ms
            : [
                ...ms,
                {
                  id: evt.mediaAssetId,
                  role: "assistant",
                  content: "",
                  imageUrl: evt.url,
                  createdAt: new Date().toISOString(),
                },
              ],
        );
      } else if (evt.type === "skip") {
        // Check-in stream: conversation not eligible. Clear any transient
        // streaming state and leave the chat exactly as it was (no bubble).
        streamedRef.current = "";
        setStreaming("");
        setFirstTokenSeen(false);
      } else if (evt.type === "error") {
        setPending(false);
        setImageGenerating(false);
        // Any partial text is discarded, but remember the prompt that failed so
        // the user can resend it without retyping.
        streamedRef.current = "";
        setStreaming("");
        setFirstTokenSeen(false);
        setFailed(lastSentRef.current);
      }
    });
    return () => {
      off();
      t.close();
    };
  }, [wsUrl]);

  React.useEffect(() => {
    const el = scrollAreaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming, pending]);

  // Auto-focus the composer on chat load and whenever it becomes enabled
  // again (e.g. after the on-mount check-in stream finishes). Gated to
  // pointer-capable / desktop widths so mobile does not force the on-screen
  // keyboard open on entry; also skipped while paywalled or disabled so we
  // never call .focus() on a disabled textarea (some browsers throw). See
  // Plans/cursor-prompt/35-major-fixes-batch.md #F.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (pending || paywall !== null) return;
    // matchMedia may be missing in exotic test environments; guard it.
    const canHover =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
        : false;
    if (!canHover) return;
    const el = inputRef.current;
    if (!el || el.disabled) return;
    // Defer to the next frame so mount-time layout thrash cannot fight this.
    const raf = window.requestAnimationFrame(() => {
      // Refetch: the ref may have unmounted between rAF frames on a fast nav.
      const current = inputRef.current;
      if (current && !current.disabled) current.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [pending, paywall]);

  // Live check-in on entry. Fires once per mount (checkinStartedRef guards
  // React strict-mode's double invoke) and streams through the SAME transport
  // SSE path as a normal reply, so the streaming bubble renders identically.
  // The backend decides eligibility and answers with a `skip` frame when there
  // is nothing to say; on `done` the finalized message lands in `messages` via
  // the shared listener above. It never blocks initial render, and if the user
  // starts typing immediately the two share the dedupe-by-messageId `done`
  // path, so nothing duplicates or crashes.
  React.useEffect(() => {
    if (checkinStartedRef.current) return;
    checkinStartedRef.current = true;
    const t = transportRef.current;
    if (!t) return;
    // Let the backend be the sole authority on eligibility: it streams a
    // greeting for a fresh conversation (first_open) or a reopen after a long
    // idle gap, and answers with a `skip` frame otherwise. A user send resets
    // the shared streaming buffer (see `send`), so an early send cannot
    // interleave with an in-flight check-in stream.
    t.checkin(conversationId, characterId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = React.useCallback(
    (text: string, { echo = true }: { echo?: boolean } = {}) => {
      if (!transportRef.current) return;
      lastSentRef.current = text;
      // Discard any in-flight check-in stream so its partial tokens cannot
      // interleave with this reply in the shared streaming buffer.
      streamedRef.current = "";
      setStreaming("");
      if (echo) {
        setMessages((ms) => [
          ...ms,
          {
            id: `local-${Date.now()}`,
            role: "user",
            content: text,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
      setPending(true);
      setFirstTokenSeen(false);
      setSafety(null);
      setFailed(null);
      transportRef.current.send(conversationId, text);
    },
    [conversationId],
  );

  // Core submit path shared by the form onSubmit and the textarea Enter key.
  function submitMessage() {
    if (!input.trim() || pending || paywall || !transportRef.current) return;
    const text = input.trim();
    setInput("");
    // Collapse the composer back to a single line now that it is empty.
    resetInputHeight();
    send(text);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    submitMessage();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter submits; Shift+Enter inserts a newline (default textarea behavior).
    // isComposing guards IME candidate selection so Enter does not send
    // mid-composition for CJK input.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitMessage();
    }
  }

  // Retry resends the failed prompt without echoing a duplicate user bubble:
  // the original message is still on screen.
  function retry() {
    const text = lastSentRef.current;
    if (!text || pending) return;
    send(text, { echo: false });
  }

  return (
    // Full-height flex column driven by the parent chat page's height chain
    // (see app/(protected)/chat/[characterId]/page.tsx: the page wrapper is
    // `h-full` inside `<main>`). A previous `h-dvh md:h-full` forced the pane
    // to viewport height on mobile, which pushed the composer below the
    // parent's overflow-hidden clip and made recent messages appear to sit
    // under it. `h-full min-h-0` keeps the pane bounded by its actual parent
    // so the flex-1 message list and shrink-0 composer lay out without any
    // sticky/absolute overlap.
    <div className="relative flex h-full min-h-0 flex-col gap-3 p-4">
      {/*
        Immersive backdrop (PRD §1): a subtle blurred character image behind
        the message list. `pointer-events-none` so it never intercepts
        clicks, and a heavy dark scrim guarantees message legibility on the
        dark theme.
      */}
      {avatarUrl ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-2xl"
        >
          <img
            src={avatarUrl}
            alt=""
            className="h-full w-full object-cover opacity-30 blur-2xl saturate-125"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, hsl(var(--buttercupp-bg) / 0.6), hsl(var(--buttercupp-bg) / 0.9))",
            }}
          />
        </div>
      ) : null}

      {/*
        One bar, not three. Below xl the page used to stack its own control strip
        (back + panel triggers + name) above this header, on top of the app shell
        header, which consumed roughly half a phone screen before a single
        message. Those controls are now passed in and rendered inline here.
      */}
      <div
        className="flex items-center gap-2 border-b pb-2 sm:pb-3"
        style={{ borderColor: "hsl(var(--buttercupp-border))" }}
      >
        {mobileLeading ? (
          <div className="flex shrink-0 items-center xl:hidden">{mobileLeading}</div>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 overflow-hidden rounded-full"
            style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={characterName} className="h-full w-full object-cover object-top" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold">
                {characterName[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-display text-lg leading-tight">{characterName}</span>
              {/* Trust chip in the chat header: reassures users mid-session
                  that the conversation is private and links to the full
                  privacy promise for anyone who wants the details.
                  Hidden on phones: sharing the row with the panel triggers it
                  wrapped to two lines and truncated her name to four letters.
                  The same promise is one tap away in the persona sheet. */}
              <span className="hidden sm:inline-flex">
                <LockedBadge size="sm" />
              </span>
            </div>
            {/*
              The bond pill replaces the old AffectionMeter here. The meter read
              RelationshipState.affectionLevel, which nothing in the product ever
              writes, so it rendered either nothing or a permanent zero; the bond
              is derived from the conversation itself and is always truthful.
            */}
            {bond ? (
              <div className="mt-1">
                <BondPill bond={bond} />
              </div>
            ) : relationship ? (
              <AffectionMeter
                size="sm"
                affectionLevel={relationship.affectionLevel}
                mood={relationship.mood}
                milestones={relationship.milestones}
              />
            ) : null}
          </div>
        </div>
        {mobileTrailing ? (
          <div className="flex shrink-0 items-center gap-1 xl:hidden">{mobileTrailing}</div>
        ) : null}
      </div>

      <div
        ref={scrollAreaRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-md p-4"
        style={{ backgroundColor: "hsl(var(--buttercupp-surface) / 0.55)" }}
      >
        {/*
          Empty state. The character's authored greeting already exists on
          CharacterVersion and was previously shown on the public detail page but
          never in the chat, so a brand-new conversation opened as a blank pane
          and left the user to break the silence. Rendering it as her bubble means
          she always speaks first.
        */}
        {messages.length === 0 && !pending && !streaming ? (
          <div className="space-y-3">
            <MessageBubble
              role="assistant"
              content={greeting?.trim() || `Hi. I'm ${characterName}. Tell me something about you.`}
            />
            <p className="px-1 text-xs text-[hsl(var(--bc-subtle))]">
              She remembers what you tell her. Start anywhere.
            </p>
          </div>
        ) : null}

        {messages.map((m) => {
          // Belt-and-braces: if a legacy row stored a raw data: URL in
          // `content` and the loader missed the promotion above (defensive
          // against future refactors), still render it as an image, never as
          // multi-MB text that would blow up the DOM and stall layout. See
          // Plans/cursor-prompt/35-major-fixes-batch.md #E.
          const inlineDataImage =
            !m.imageUrl && typeof m.content === "string" && m.content.startsWith("data:image/");
          if (m.imageUrl || inlineDataImage) {
            return (
              <div key={m.id} className="flex justify-start" data-testid="bubble-image">
                <ImageMessage mediaAssetId={m.id} url={m.imageUrl ?? m.content} />
              </div>
            );
          }
          return <MessageBubble key={m.id} role={m.role} content={m.content} />;
        })}
        {streaming ? <MessageBubble role="assistant" content={streaming} streaming /> : null}
        {/* Hide the typing dots while the image skeleton is up: the skeleton is
            the loading indicator in that phase, so the pill would be redundant. */}
        {pending && !firstTokenSeen && !imageGenerating ? <TypingDots /> : null}
        {imageGenerating ? <GeneratingImageSkeleton /> : null}
        {failed && !pending ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--bc-radius-sm)] border border-[hsl(var(--bc-danger)/0.32)] bg-[hsl(var(--bc-danger)/0.09)] px-3.5 py-3 text-sm"
          >
            <span className="text-[hsl(var(--bc-fg))]">She did not get that one.</span>
            <button
              type="button"
              onClick={retry}
              className="bc-press rounded-full border border-[hsl(var(--bc-danger)/0.4)] px-3 py-1 text-xs font-semibold text-[hsl(2_84%_78%)] transition-colors duration-200 hover:bg-[hsl(var(--bc-danger)/0.16)]"
            >
              Send again
            </button>
          </div>
        ) : null}
        {safety ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <p className="mb-2">{safety.message}</p>
            <ul className="list-disc space-y-1 pl-5">
              {safety.resources.map((r) => (
                <li key={r.url}>
                  <a href={r.url} target="_blank" rel="noreferrer" className="underline">
                    {r.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div />
      </div>

      <form
        onSubmit={submit}
        // shrink-0 so the composer keeps its intrinsic height and never
        // overlaps the flex-1 message list above. Sticky positioning was
        // removed: it created ambiguous overlap on mobile because the
        // nearest scrolling ancestor was the outer <main>, not the message
        // list, so the composer could sit on top of trailing messages when
        // the viewport was smaller than the pane.
        className="shrink-0 rounded-2xl border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        style={{
          backgroundColor: "hsl(var(--buttercupp-surface-2))",
          borderColor: "hsl(var(--buttercupp-border))",
        }}
      >
        {/*
          Input and send share one row. Previously the input took a full row of
          its own and the scene chips wrapped below it, which stacked the
          composer four rows deep on a phone and pushed the conversation off
          screen. Send sits inline; the shortcuts get one quiet row beneath.
        */}
        <div className="bc-composer-field flex items-end gap-2 px-1">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={resizeInput}
            onKeyDown={onInputKeyDown}
            placeholder={
              paywall ? "Upgrade to keep chatting" : pending ? "Waiting..." : "Write a message..."
            }
            disabled={pending || paywall !== null}
            data-testid="chat-input"
            className="bc-chat-input min-w-0 flex-1 resize-none overflow-y-hidden bg-transparent px-1 py-2 text-[0.9375rem] leading-relaxed focus:outline-none"
            style={{ color: "hsl(var(--buttercupp-fg))", maxHeight: "160px" }}
          />
          {/*
            Free-trial headroom. The transport only reveals the limit at the
            moment it blocks you, which makes the wall feel like a trap. Showing
            the count once it gets close turns it into a decision.
          */}
          {headroom?.warn ? (
            <span
              className={`tabular shrink-0 text-xs font-medium ${
                headroom.left <= 1 ? "text-[hsl(var(--bc-amber))]" : "text-[hsl(var(--bc-muted))]"
              }`}
            >
              {headroom.left} left
            </span>
          ) : null}
          <button
            type="submit"
            disabled={pending || paywall !== null || !input.trim()}
            data-testid="chat-send"
            aria-label="Send"
            className="bc-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[hsl(28_45%_9%)] transition-[transform,box-shadow,opacity] duration-200 ease-[var(--ease-out)] disabled:opacity-45"
            style={{
              backgroundImage: "var(--bc-gradient-brand-h)",
              boxShadow: "0 6px 18px -8px hsl(var(--bc-amber) / 0.55)",
            }}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          <span
            className="hidden text-xs sm:inline"
            style={{ color: "hsl(var(--buttercupp-muted))" }}
          >
            Show me the scene:
          </span>
          <SceneButton
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            label="Photo"
            onClick={() => setInput("Send me a photo of you right now")}
            disabled={pending || paywall !== null}
          />
          <SceneButton
            icon={<Video className="h-3.5 w-3.5" />}
            label="Video"
            onClick={() => setInput("Send me a short video of you right now")}
            disabled={pending || paywall !== null}
          />
        </div>
      </form>

      {paywall ? (
        <PaywallModal
          scope={paywall.scope}
          kind={paywall.kind}
          used={paywall.used}
          limit={paywall.limit}
          plans={paywall.plans}
          onResumed={() => setPaywall(null)}
        />
      ) : null}
    </div>
  );
}

function SceneButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium disabled:opacity-50"
      style={{ borderColor: "hsl(var(--buttercupp-border))", color: "hsl(var(--buttercupp-fg))" }}
    >
      {icon}
      {label}
    </button>
  );
}

function MessageBubble({
  role,
  content,
  streaming,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
}) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid={`bubble-${role}`}>
      {/*
        Both sides use the shared bc-bubble material (see globals.css): a tinted
        glass surface with a tail on the sender's corner. Her turns were pure
        #ffffff on #111111 before, which is the one place in the product that
        still looked like a default chat widget bolted onto a warm dark theme,
        and at night on a phone it was the brightest thing on the screen.
      */}
      <div
        className={`bc-bubble max-w-[85%] px-4 py-2.5 text-[0.9375rem] sm:max-w-[75%] ${
          mine
            ? "bc-bubble-me font-medium text-[hsl(var(--bc-honey))]"
            : "bc-bubble-her leading-relaxed text-[hsl(var(--bc-cream))]"
        }`}
      >
        {/*
          User messages render plain to prevent any content the user typed
          from being reinterpreted (asterisks stay literal). Assistant + system
          messages get the gesture parser so `*smiles softly*` renders italic.
        */}
        {mine ? (
          <span className="whitespace-pre-wrap">{content}</span>
        ) : (
          <GestureText content={content} />
        )}
        {streaming ? <span className="ml-1 inline-block animate-pulse">|</span> : null}
      </div>
    </div>
  );
}

function GeneratingImageSkeleton() {
  return (
    <div className="flex justify-start" data-testid="image-generating-skeleton">
      <div
        className="flex flex-col gap-2 overflow-hidden rounded-2xl"
        style={{
          width: "200px",
          aspectRatio: "9 / 16",
          background: "linear-gradient(135deg, hsl(var(--buttercupp-surface-2)), hsl(var(--buttercupp-surface)))",
          border: "1px solid hsl(var(--buttercupp-border))",
        }}
      >
        {/* Shimmer overlay */}
        <div
          className="absolute inset-0 animate-pulse"
          style={{
            background: "linear-gradient(90deg, transparent 0%, hsl(var(--buttercupp-accent-rose) / 0.08) 50%, transparent 100%)",
          }}
        />
        <div className="relative flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          {/* Pulsing camera icon */}
          <div
            className="flex h-12 w-12 animate-pulse items-center justify-center rounded-2xl"
            style={{
              background: "linear-gradient(135deg, hsl(var(--buttercupp-accent-rose) / 0.25), hsl(var(--buttercupp-accent-violet) / 0.25))",
            }}
          >
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--buttercupp-accent-rose))" strokeWidth="1.8">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: "hsl(var(--buttercupp-fg))" }}>
              Generating your photo
            </p>
            <p className="mt-1 text-[10px]" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              This may take a moment...
            </p>
          </div>
          {/* Animated progress dots */}
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-1.5 w-1.5 animate-bounce rounded-full"
                style={{
                  backgroundColor: "hsl(var(--buttercupp-accent-rose))",
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
