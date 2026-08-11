"use client";

import * as React from "react";
import { createChatTransport, type TransportEvent, type TransportPaywallPlan } from "@/lib/chat-transport";
import { Image as ImageIcon, Video, Send, Settings } from "lucide-react";
import { AffectionMeter } from "@/components/relationship/AffectionMeter";
import { GestureText } from "@/components/chat/GestureText";
import { TypingDots } from "@/components/chat/TypingDots";
import { PaywallModal } from "@/components/chat/PaywallModal";
import { ImageMessage } from "@/components/chat/ImageMessage";

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
  initialMessages: HistoryMessage[];
  characterName: string;
  wsUrl?: string;
  avatarUrl?: string | null;
  relationship?: RelationshipHeader | null;
}

export function ChatWindow({
  conversationId,
  initialMessages,
  characterName,
  wsUrl,
  avatarUrl,
  relationship,
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
  const [input, setInput] = React.useState("");
  const scrollAreaRef = React.useRef<HTMLDivElement | null>(null);
  const transportRef = React.useRef<ReturnType<typeof createChatTransport> | null>(null);
  const streamedRef = React.useRef("");

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
      } else if (evt.type === "image") {
        // Generated image arrives as a data URL; render it as an assistant bubble.
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
      } else if (evt.type === "error") {
        setPending(false);
        streamedRef.current = "";
        setStreaming("");
        setFirstTokenSeen(false);
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || pending || paywall || !transportRef.current) return;
    const text = input.trim();
    setMessages((ms) => [
      ...ms,
      { id: `local-${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() },
    ]);
    setInput("");
    setPending(true);
    setFirstTokenSeen(false);
    setSafety(null);
    transportRef.current.send(conversationId, text);
  }

  return (
    <div className="relative flex h-full flex-col gap-3 p-4">
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

      <div
        className="flex items-center justify-between border-b pb-3"
        style={{ borderColor: "hsl(var(--buttercupp-border))" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 overflow-hidden rounded-full"
            style={{ backgroundColor: "hsl(var(--buttercupp-surface-2))" }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={characterName} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold">
                {characterName[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-display text-lg leading-tight">{characterName}</span>
            {relationship ? (
              <AffectionMeter
                size="sm"
                affectionLevel={relationship.affectionLevel}
                mood={relationship.mood}
                milestones={relationship.milestones}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div
        ref={scrollAreaRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-md p-4"
        style={{ backgroundColor: "hsl(var(--buttercupp-surface) / 0.55)" }}
      >
        {messages.map((m) =>
          m.imageUrl ? (
            <div key={m.id} className="flex justify-start" data-testid="bubble-image">
              <ImageMessage mediaAssetId={m.id} url={m.imageUrl} />
            </div>
          ) : (
            <MessageBubble key={m.id} role={m.role} content={m.content} />
          ),
        )}
        {streaming ? <MessageBubble role="assistant" content={streaming} streaming /> : null}
        {pending && !firstTokenSeen ? <TypingDots /> : null}
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
        className="rounded-2xl border p-3"
        style={{
          backgroundColor: "hsl(var(--buttercupp-surface-2))",
          borderColor: "hsl(var(--buttercupp-border))",
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            paywall ? "Upgrade to keep chatting" : pending ? "Waiting..." : "Write a message..."
          }
          disabled={pending || paywall !== null}
          data-testid="chat-input"
          className="w-full bg-transparent px-1 py-1 text-sm focus:outline-none"
          style={{ color: "hsl(var(--buttercupp-fg))" }}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "hsl(var(--buttercupp-muted))" }}>
              Show me the scene:
            </span>
            <SceneButton
              icon={<ImageIcon className="h-3.5 w-3.5" />}
              label="Image"
              onClick={() => setInput("Send me a photo of you right now")}
              disabled={pending || paywall !== null}
            />
            <SceneButton
              icon={<Video className="h-3.5 w-3.5" />}
              label="Video"
              onClick={() => setInput("Send me a short video of you right now")}
              disabled={pending || paywall !== null}
            />
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full border"
              style={{ borderColor: "hsl(var(--buttercupp-border))", color: "hsl(var(--buttercupp-muted))" }}
              aria-hidden
            >
              <Settings className="h-3.5 w-3.5" />
            </span>
          </div>
          <button
            type="submit"
            disabled={pending || paywall !== null || !input.trim()}
            data-testid="chat-send"
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm disabled:opacity-50"
            style={{
              background:
                "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
            }}
          >
            <Send className="h-4 w-4" />
          </button>
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
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
          mine ? "text-white" : "ring-1"
        }`}
        style={
          mine
            ? {
                background:
                  "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))",
              }
            : {
                backgroundColor: "hsl(var(--buttercupp-surface))",
                color: "hsl(var(--buttercupp-fg))",
                borderColor: "hsl(var(--buttercupp-border))",
              }
        }
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
