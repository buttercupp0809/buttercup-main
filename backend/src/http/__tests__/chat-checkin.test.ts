// HTTP surface tests for POST /chat/checkin. jose is mocked so we do not
// need real JWT signing; maybeRunCheckin is mocked so we only exercise the
// route (auth + body validation + response shape).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

const jwtVerifyMock = vi.fn();
vi.mock("jose", () => ({
  jwtVerify: jwtVerifyMock,
}));

const maybeRunCheckinMock = vi.fn();
vi.mock("../../chat/checkin", () => ({
  maybeRunCheckin: maybeRunCheckinMock,
}));

const { handleChatCheckin } = await import("../chat-checkin");

// Minimal request/response fakes. The route reads req.method, req.url,
// req.headers.cookie, streams body via "data"/"end" events, and calls
// res.writeHead + res.end with a string.
interface FakeReqInit {
  method?: string;
  url?: string;
  cookie?: string;
  body?: string;
}

function makeReq(init: FakeReqInit): IncomingMessage {
  const emitter = new EventEmitter() as EventEmitter & Partial<IncomingMessage>;
  const req = emitter as unknown as IncomingMessage & { push: (b: string) => void };
  (req as unknown as { method: string }).method = init.method ?? "POST";
  (req as unknown as { url: string }).url = init.url ?? "/chat/checkin";
  (req as unknown as { headers: Record<string, string | undefined> }).headers = {
    cookie: init.cookie,
  };
  // Emit the body only once the route attaches its "data" listener, so
  // callers that do work (auth check) before reading the body still receive
  // the payload.
  emitter.on("newListener", (event) => {
    if (event !== "data") return;
    queueMicrotask(() => {
      if (init.body) emitter.emit("data", init.body);
      emitter.emit("end");
    });
  });
  return req;
}

interface CapturedRes {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function makeRes(): { res: ServerResponse; captured: CapturedRes; done: Promise<void> } {
  const captured: CapturedRes = { status: 0, headers: {}, body: "" };
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      captured.status = status;
      captured.headers = headers;
    },
    write() {
      // unused for this route
    },
    end(body?: string) {
      captured.body = body ?? "";
      resolveDone();
    },
  } as unknown as ServerResponse;
  return { res, captured, done };
}

beforeEach(() => {
  jwtVerifyMock.mockReset();
  maybeRunCheckinMock.mockReset();
  process.env.JWT_SECRET = "test-secret";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /chat/checkin", () => {
  it("returns 401 when no auth cookie is present", async () => {
    const req = makeReq({ body: JSON.stringify({ conversationId: "c1" }) });
    const { res, captured, done } = makeRes();
    const handled = await handleChatCheckin(req, res);
    await done;
    expect(handled).toBe(true);
    expect(captured.status).toBe(401);
    const body = JSON.parse(captured.body);
    expect(body.error).toBe("unauthorized");
    expect(maybeRunCheckinMock).not.toHaveBeenCalled();
  });

  it("returns 400 on an invalid body", async () => {
    jwtVerifyMock.mockResolvedValueOnce({ payload: { sub: "user-1" } });
    const req = makeReq({
      cookie: "buttercupp_auth=abc",
      body: JSON.stringify({ notConversationId: "x" }),
    });
    const { res, captured, done } = makeRes();
    await handleChatCheckin(req, res);
    await done;
    expect(captured.status).toBe(400);
    const body = JSON.parse(captured.body);
    expect(body.error).toBe("invalid_body");
    expect(maybeRunCheckinMock).not.toHaveBeenCalled();
  });

  it("returns 200 { created } on success", async () => {
    jwtVerifyMock.mockResolvedValueOnce({ payload: { sub: "user-1" } });
    maybeRunCheckinMock.mockResolvedValueOnce({
      created: true,
      message: { id: "msg-1", role: "assistant", content: "hi", createdAt: "2026-01-01T00:00:00.000Z" },
    });
    const req = makeReq({
      cookie: "buttercupp_auth=abc",
      body: JSON.stringify({ conversationId: "conv-1" }),
    });
    const { res, captured, done } = makeRes();
    await handleChatCheckin(req, res);
    await done;
    expect(captured.status).toBe(200);
    const body = JSON.parse(captured.body);
    expect(body.created).toBe(true);
    expect(body.message.id).toBe("msg-1");
    expect(maybeRunCheckinMock).toHaveBeenCalledWith({
      conversationId: "conv-1",
      userId: "user-1",
    });
  });

  it("skips non-matching routes", async () => {
    const req = makeReq({ method: "GET", url: "/other" });
    const { res } = makeRes();
    const handled = await handleChatCheckin(req, res);
    expect(handled).toBe(false);
  });
});
