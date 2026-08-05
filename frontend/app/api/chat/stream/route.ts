// SSE fallback for chat streaming. Proxies to the backend HTTP endpoint at
// $BACKEND_URL/chat/stream, forwarding the auth cookie so the backend can
// authenticate the same way as the WS gateway. Response body is a byte
// stream (text/event-stream) piped directly to the client.

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
    upstream = await fetch(`${backendUrl}/chat/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${AUTH_COOKIE}=${encodeURIComponent(auth)}`,
      },
      body: await req.text(),
      // Node fetch supports duplex streaming here; upstream body will be piped
      // through as SSE bytes.
    });
  } catch {
    // Backend not reachable (ECONNREFUSED etc). Return a clean 502 instead of
    // letting the fetch rejection surface as an unhandled 500. Most common
    // cause in local dev: the backend server on :4000 is not running.
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
