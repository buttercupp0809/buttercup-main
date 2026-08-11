// Client-side chat transport. Tries a WebSocket first; falls back to POST
// SSE at /api/chat/stream when the WS handshake fails or drops. Exposes a
// stable event surface so React components don't care which path is live.

export interface TransportPaywallPlan {
  plan: string;
  label: string;
  priceUsd: number;
  durationDays: number;
  chats: number;
  images: number;
  videos: number;
}

export type TransportEvent =
  | { type: "token"; conversationId: string; delta: string }
  | { type: "done"; conversationId: string; messageId: string; provider: string; model: string }
  | { type: "safety"; conversationId: string; message: string; resources: { label: string; url: string }[] }
  | {
      type: "paywall";
      conversationId: string;
      reason: string;
      scope: "free_trial" | "plan_quota";
      kind: "chat" | "image" | "video";
      used: number;
      limit: number;
      plans: TransportPaywallPlan[];
      upgradeUrl: string;
    }
  | { type: "image"; conversationId: string; url: string; mediaAssetId: string }
  | { type: "error"; message: string };

export interface ChatTransport {
  send(conversationId: string, text: string): void;
  cancel(conversationId: string): void;
  on(cb: (evt: TransportEvent) => void): () => void;
  close(): void;
}

export interface ChatTransportOptions {
  wsUrl?: string; // ws://localhost:4000/ws for local, wss://api.buttercupp.example/ws in prod
  onOpen?: () => void;
  onClose?: () => void;
}

export function createChatTransport(options: ChatTransportOptions = {}): ChatTransport {
  const listeners = new Set<(evt: TransportEvent) => void>();
  const emit = (evt: TransportEvent) => {
    for (const cb of listeners) cb(evt);
  };

  let ws: WebSocket | null = null;
  let wsBroken = false;
  let closed = false;

  function connectWs(): void {
    if (!options.wsUrl || wsBroken || closed) return;
    try {
      ws = new WebSocket(options.wsUrl);
    } catch {
      wsBroken = true;
      return;
    }
    ws.addEventListener("open", () => options.onOpen?.());
    ws.addEventListener("close", () => {
      options.onClose?.();
      if (!closed) setTimeout(connectWs, 1500);
    });
    ws.addEventListener("error", () => {
      wsBroken = true;
    });
    ws.addEventListener("message", (m) => {
      try {
        const data = JSON.parse(String(m.data));
        if (data.type === "chat.token") emit({ type: "token", conversationId: data.conversationId, delta: data.delta });
        else if (data.type === "chat.done") emit({ type: "done", conversationId: data.conversationId, messageId: data.messageId, provider: data.provider, model: data.model });
        else if (data.type === "safety.intervention") emit({ type: "safety", conversationId: data.conversationId, message: data.message, resources: data.resources });
        else if (data.type === "paywall")
          emit({
            type: "paywall",
            conversationId: data.conversationId,
            reason: data.reason,
            scope: data.scope,
            kind: data.kind,
            used: data.used,
            limit: data.limit,
            plans: data.plans,
            upgradeUrl: data.upgradeUrl,
          });
        else if (data.type === "media.ready") emit({ type: "image", conversationId: data.conversationId, url: data.url, mediaAssetId: data.mediaAssetId });
        else if (data.type === "error") emit({ type: "error", message: data.message });
      } catch {
        emit({ type: "error", message: "bad_frame" });
      }
    });
  }
  connectWs();

  async function sendSse(conversationId: string, text: string) {
    const res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, text }),
    });
    if (!res.body) {
      emit({ type: "error", message: "no_response_body" });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const frame of frames) {
        const lines = frame.split("\n");
        const eventLine = lines.find((l) => l.startsWith("event: "));
        const dataLine = lines.find((l) => l.startsWith("data: "));
        if (!eventLine || !dataLine) continue;
        const evt = eventLine.slice(7).trim();
        const data = JSON.parse(dataLine.slice(6));
        if (evt === "token") emit({ type: "token", conversationId, delta: data.delta });
        else if (evt === "done") emit({ type: "done", conversationId, messageId: data.messageId, provider: data.provider, model: data.model });
        else if (evt === "safety") emit({ type: "safety", conversationId, message: data.message, resources: data.resources });
        else if (evt === "paywall")
          emit({
            type: "paywall",
            conversationId: data.conversationId ?? conversationId,
            reason: data.reason,
            scope: data.scope,
            kind: data.kind,
            used: data.used,
            limit: data.limit,
            plans: data.plans,
            upgradeUrl: data.upgradeUrl,
          });
        else if (evt === "image") emit({ type: "image", conversationId, url: data.url, mediaAssetId: data.mediaAssetId });
        else if (evt === "error") emit({ type: "error", message: data.message });
      }
    }
  }

  return {
    send(conversationId, text) {
      if (ws && ws.readyState === WebSocket.OPEN && !wsBroken) {
        ws.send(JSON.stringify({ type: "chat.send", conversationId, text }));
      } else {
        void sendSse(conversationId, text);
      }
    },
    cancel(conversationId) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat.cancel", conversationId }));
      }
    },
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    close() {
      closed = true;
      ws?.close();
      listeners.clear();
    },
  };
}
