// HTTP surface tests for the admin LoRA train endpoints.
//   POST /admin/lora/train  -> creates CharacterLora row (pending) + enqueues
//   GET  /admin/lora/:characterId -> list CharacterLora rows for character
//
// Admin auth is a static shared secret in the x-admin-secret header (same
// pattern as the only existing admin surface: /api/admin/seed-personas, which
// gates on a body key). Here we use a request header instead since this is a
// backend JSON API, not a Next.js route.
//
// Prisma + enqueueTrainLoraJob are mocked so no DB or Redis is needed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

// --- mocks (must be before import of the module under test) -----------------

const prismaCreateMock = vi.fn();
const prismaFindManyMock = vi.fn();
const prismaCharacterFindUniqueMock = vi.fn();

vi.mock("@buttercupp/database", () => ({
  prisma: {
    characterLora: {
      create: (...args: unknown[]) => prismaCreateMock(...args),
      findMany: (...args: unknown[]) => prismaFindManyMock(...args),
    },
    character: {
      findUnique: (...args: unknown[]) => prismaCharacterFindUniqueMock(...args),
    },
  },
}));

const enqueueTrainLoraJobMock = vi.fn();
vi.mock("../../queue/lora-queue", () => ({
  enqueueTrainLoraJob: (...args: unknown[]) => enqueueTrainLoraJobMock(...args),
}));

const { handleLoraAdminRoute } = await import("../lora");

// --- test helpers ------------------------------------------------------------

interface FakeReqInit {
  method?: string;
  url?: string;
  adminSecret?: string;
  body?: string;
}

function makeReq(init: FakeReqInit): IncomingMessage {
  const emitter = new EventEmitter() as EventEmitter & Partial<IncomingMessage>;
  const req = emitter as unknown as IncomingMessage & { push: (b: string) => void };
  (req as unknown as { method: string }).method = init.method ?? "POST";
  (req as unknown as { url: string }).url = init.url ?? "/admin/lora/train";
  (req as unknown as { headers: Record<string, string | undefined> }).headers = {
    "x-admin-secret": init.adminSecret,
  };
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
    write() {},
    end(body?: string) {
      captured.body = body ?? "";
      resolveDone();
    },
  } as unknown as ServerResponse;
  return { res, captured, done };
}

// --- tests ------------------------------------------------------------------

const VALID_ADMIN_SECRET = "test-admin-secret";

const VALID_BODY = JSON.stringify({
  characterId: "char-1",
  characterVersionId: "ver-1",
});

const VALID_CHARACTER = {
  id: "char-1",
  currentVersionId: "ver-1",
};

beforeEach(() => {
  process.env.ADMIN_SECRET = VALID_ADMIN_SECRET;
  prismaCreateMock.mockReset();
  prismaFindManyMock.mockReset();
  prismaCharacterFindUniqueMock.mockReset();
  enqueueTrainLoraJobMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_SECRET;
});

// ----------------------------------------------------------------------------
// POST /admin/lora/train
// ----------------------------------------------------------------------------

describe("POST /admin/lora/train", () => {
  it("returns 403 when no x-admin-secret header is provided", async () => {
    const req = makeReq({ body: VALID_BODY });
    const { res, captured, done } = makeRes();
    const handled = await handleLoraAdminRoute(req, res);
    await done;
    expect(handled).toBe(true);
    expect(captured.status).toBe(403);
    const body = JSON.parse(captured.body);
    expect(body.error).toBe("forbidden");
    expect(prismaCreateMock).not.toHaveBeenCalled();
    expect(enqueueTrainLoraJobMock).not.toHaveBeenCalled();
  });

  it("returns 403 when x-admin-secret is wrong", async () => {
    const req = makeReq({ adminSecret: "wrong-secret", body: VALID_BODY });
    const { res, captured, done } = makeRes();
    const handled = await handleLoraAdminRoute(req, res);
    await done;
    expect(handled).toBe(true);
    expect(captured.status).toBe(403);
    const body = JSON.parse(captured.body);
    expect(body.error).toBe("forbidden");
  });

  it("returns 400 on an invalid body (missing characterId)", async () => {
    const req = makeReq({
      adminSecret: VALID_ADMIN_SECRET,
      body: JSON.stringify({ characterVersionId: "ver-1" }),
    });
    const { res, captured, done } = makeRes();
    await handleLoraAdminRoute(req, res);
    await done;
    expect(captured.status).toBe(400);
    const body = JSON.parse(captured.body);
    expect(body.error).toBe("invalid_body");
  });

  it("returns 404 when character does not exist", async () => {
    prismaCharacterFindUniqueMock.mockResolvedValueOnce(null);
    const req = makeReq({ adminSecret: VALID_ADMIN_SECRET, body: VALID_BODY });
    const { res, captured, done } = makeRes();
    await handleLoraAdminRoute(req, res);
    await done;
    expect(captured.status).toBe(404);
    const body = JSON.parse(captured.body);
    expect(body.error).toBe("character_not_found");
  });

  it("creates a CharacterLora row and enqueues a job, returns { loraId }", async () => {
    prismaCharacterFindUniqueMock.mockResolvedValueOnce(VALID_CHARACTER);
    prismaCreateMock.mockResolvedValueOnce({ id: "lora-1", status: "pending" });
    enqueueTrainLoraJobMock.mockResolvedValueOnce({ jobId: "job-1" });

    const req = makeReq({ adminSecret: VALID_ADMIN_SECRET, body: VALID_BODY });
    const { res, captured, done } = makeRes();
    const handled = await handleLoraAdminRoute(req, res);
    await done;

    expect(handled).toBe(true);
    expect(captured.status).toBe(202);
    const body = JSON.parse(captured.body);
    expect(body.loraId).toBe("lora-1");
    expect(body.jobId).toBe("job-1");
    expect(body.status).toBe("pending");

    // Prisma row was created with pending status
    expect(prismaCreateMock).toHaveBeenCalledOnce();
    const createCall = prismaCreateMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.characterId).toBe("char-1");
    expect(createCall.data.characterVersionId).toBe("ver-1");
    expect(createCall.data.status).toBe("pending");

    // enqueue was called with the correct payload
    expect(enqueueTrainLoraJobMock).toHaveBeenCalledOnce();
    const enqueueCall = enqueueTrainLoraJobMock.mock.calls[0][0] as Record<string, unknown>;
    expect(enqueueCall.source).toBe("train-lora");
    expect(enqueueCall.characterId).toBe("char-1");
    expect(enqueueCall.characterVersionId).toBe("ver-1");
    expect(enqueueCall.requestedBy).toBe("admin");
  });

  it("returns { loraId, enqueueError } when Redis is absent but row is still created", async () => {
    prismaCharacterFindUniqueMock.mockResolvedValueOnce(VALID_CHARACTER);
    prismaCreateMock.mockResolvedValueOnce({ id: "lora-2", status: "pending" });
    enqueueTrainLoraJobMock.mockRejectedValueOnce(new Error("REDIS_URL not configured"));

    const req = makeReq({ adminSecret: VALID_ADMIN_SECRET, body: VALID_BODY });
    const { res, captured, done } = makeRes();
    await handleLoraAdminRoute(req, res);
    await done;

    expect(captured.status).toBe(202);
    const body = JSON.parse(captured.body);
    expect(body.loraId).toBe("lora-2");
    expect(body.status).toBe("pending");
    expect(typeof body.enqueueError).toBe("string");
    expect(body.enqueueError).toContain("REDIS_URL");
  });
});

// ----------------------------------------------------------------------------
// GET /admin/lora/:characterId
// ----------------------------------------------------------------------------

describe("GET /admin/lora/:characterId", () => {
  it("returns 403 for non-admin request", async () => {
    const req = makeReq({ method: "GET", url: "/admin/lora/char-1" });
    const { res, captured, done } = makeRes();
    const handled = await handleLoraAdminRoute(req, res);
    await done;
    expect(handled).toBe(true);
    expect(captured.status).toBe(403);
  });

  it("returns LoRA rows for a character", async () => {
    const rows = [
      { id: "lora-1", characterId: "char-1", characterVersionId: "ver-1", status: "ready", createdAt: new Date() },
    ];
    prismaFindManyMock.mockResolvedValueOnce(rows);

    const req = makeReq({ method: "GET", url: "/admin/lora/char-1", adminSecret: VALID_ADMIN_SECRET });
    const { res, captured, done } = makeRes();
    const handled = await handleLoraAdminRoute(req, res);
    await done;

    expect(handled).toBe(true);
    expect(captured.status).toBe(200);
    const body = JSON.parse(captured.body);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows[0].id).toBe("lora-1");

    expect(prismaFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { characterId: "char-1" } }),
    );
  });
});

// ----------------------------------------------------------------------------
// Non-matching routes
// ----------------------------------------------------------------------------

describe("non-matching routes", () => {
  it("returns false for GET /other", async () => {
    const req = makeReq({ method: "GET", url: "/other" });
    const { res } = makeRes();
    const handled = await handleLoraAdminRoute(req, res);
    expect(handled).toBe(false);
  });
});
