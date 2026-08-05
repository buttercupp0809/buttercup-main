"use client";

import * as React from "react";
import { createChatTransport, type TransportEvent, type TransportPaywallPlan } from "@/lib/chat-transport";
import { AffectionMeter } from "@/components/relationship/AffectionMeter";
import { GestureText } from "@/components/chat/GestureText";
import { TypingDots } from "@/components/chat/TypingDots";
import { PaywallModal } from "@/components/chat/PaywallModal";

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
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
    <div className="relative flex h-[calc(100vh-8rem)] flex-col gap-3">
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
                "linear-gradient(180deg, hsl(var(--poppy-bg) / 0.6), hsl(var(--poppy-bg) / 0.9))",
            }}
          />
        </div>
      ) : null}

      <div
        className="flex items-center justify-between border-b pb-3"
        style={{ borderColor: "hsl(var(--poppy-border))" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 overflow-hidden rounded-full"
            style={{ backgroundColor: "hsl(var(--poppy-surface-2))" }}
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
        className="flex-1 space-y-3 overflow-y-auto rounded-md p-4"
        style={{ backgroundColor: "hsl(var(--poppy-surface) / 0.55)" }}
      >
        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}
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
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            paywall ? "Upgrade to keep chatting" : pending ? "Waiting..." : "Say something"
          }
          disabled={pending || paywall !== null}
          data-testid="chat-input"
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          style={{
            backgroundColor: "hsl(var(--poppy-surface-2))",
            borderColor: "hsl(var(--poppy-border))",
            color: "hsl(var(--poppy-fg))",
          }}
        />
        <button
          type="submit"
          disabled={pending || paywall !== null || !input.trim()}
          data-testid="chat-send"
          className="rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
          style={{
            background:
              "linear-gradient(90deg, hsl(var(--poppy-accent-rose)), hsl(var(--poppy-accent-violet)))",
          }}
        >
          Send
        </button>
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
                  "linear-gradient(90deg, hsl(var(--poppy-accent-rose)), hsl(var(--poppy-accent-violet)))",
              }
            : {
                backgroundColor: "hsl(var(--poppy-surface))",
                color: "hsl(var(--poppy-fg))",
                borderColor: "hsl(var(--poppy-border))",
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
