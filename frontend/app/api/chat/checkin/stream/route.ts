// SSE proxy for the live-streamed check-in on chat entry. Mirrors
// app/api/chat/stream/route.ts exactly: forwards the auth cookie to the
// backend so it authenticates the same way as the normal reply stream, and
// pipes the backend's text/event-stream body straight through to the client.
// The frontend reuses the same SSE parser it uses for chat replies; the only
// extra frame is `event: skip` for conversations with no eligible check-in.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  const jar = await cookies();
  const auth = jar.get(AUTH_COOKIE)?.value;
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl}/chat/checkin/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${AUTH_COOKIE}=${encodeURIComponent(auth)}`,
      },
      body: await req.text(),
    });
  } catch {
    // Backend not reachable. The check-in is best-effort, so a clean 502 lets
    // the client silently skip it (see ChatWindow: any error leaves the chat
    // as-is with no bubble).
    return NextResponse.json(
      { error: "backend_unreachable", hint: "Start the backend: npm run dev:backend" },
      { status: 502 },
    );
  }

  if (!upstream.body) {
    return NextResponse.json({ error: "no_upstream" }, { status: 502 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
