// Unit tests for the free-tier photo paywall frontend logic.
//
// Tests:
//   1. /api/media route (FAIL CLOSED): for a generated chat-image key, full-res
//      is served ONLY to an authenticated + paid requester; a free user OR an
//      unauthenticated (null-auth) requester gets blurred bytes. Non-generated
//      keys (public art / avatars) resolve normally.

import { describe, expect, it, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Mock heavy deps so the tests run without DB / S3 / sharp in the test runner.
// ---------------------------------------------------------------------------

vi.mock("@buttercupp/database", () => ({
  prisma: {
    subscription: {
      findUnique: vi.fn(),
    },
    mediaAsset: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@/lib/media-blur", () => ({
  blurredDataUri: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      _json: body,
      status: init?.status ?? 200,
    }),
    redirect: (url: string, init?: { status?: number }) => ({
      _redirect: url,
      status: init?.status ?? 302,
    }),
  },
}));

// S3 SDK mocks (the route handler imports these).
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  GetObjectCommand: vi.fn().mockImplementation((params: unknown) => params),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://s3.example.com/signed?token=abc"),
}));

import { prisma } from "@buttercupp/database";
import { getAuthUserId } from "@/lib/auth";
import { blurredDataUri } from "@/lib/media-blur";

// ---------------------------------------------------------------------------
// Import the route handler AFTER mocks are set up.
// ---------------------------------------------------------------------------
const { GET } = await import("../app/api/media/route");

// Helper to build a Request with a given s3Key query param.
function req(key: string | null): Request {
  const url = key
    ? `http://localhost/api/media?k=${encodeURIComponent(key)}`
    : "http://localhost/api/media";
  return new Request(url);
}

describe("/api/media: free-user paywall (unit, mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: unauthenticated (no userId), so the free-user branch is skipped.
    vi.mocked(getAuthUserId).mockResolvedValue(null);
    // Default S3 config (buckets are non-empty).
    process.env.POPPY_S3_BUCKET_GENERATED = "gen-bucket";
    process.env.S3_BUCKET = "media-bucket";
    process.env.AWS_REGION = "eu-north-1";
    // Remove endpoint so the S3 client does not use MinIO.
    delete process.env.S3_ENDPOINT;
  });

  it("returns 400 when the s3Key is missing", async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(400);
  });

  it("I-4: free user requesting a ready image asset gets the actual blurred bytes", async () => {
    const userId = `user-${crypto.randomUUID()}`;
    const s3Key = `images/some/fake-key.png`;

    // Mock: authenticated as a free user.
    vi.mocked(getAuthUserId).mockResolvedValue(userId);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null); // no subscription = free

    // Mock: a ready image MediaAsset exists for this key.
    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValue({ id: "asset-123" } as never);

    // Mock: blur returns a proper webp data URI with known bytes.
    const knownBytes = Buffer.from("blurred-webp-bytes");
    const fakeDataUri = `data:image/webp;base64,${knownBytes.toString("base64")}`;
    vi.mocked(blurredDataUri).mockResolvedValue(fakeDataUri);

    const res = await GET(req(s3Key));

    // Must NOT be a redirect.
    expect((res as { _redirect?: string })._redirect).toBeUndefined();
    expect(blurredDataUri).toHaveBeenCalledWith(s3Key);
    expect(res.status).toBe(200);

    // Content-Type must be an image/* (decoded from the data URI).
    const contentType = (res as Response).headers.get("Content-Type");
    expect(contentType).toMatch(/^image\//);

    // The response body must equal the decoded blurred bytes, NOT the full-res.
    const bodyBuf = Buffer.from(await (res as Response).arrayBuffer());
    expect(bodyBuf.equals(knownBytes)).toBe(true);
  });

  it("C-2: free user requesting an image asset owned by ANOTHER user still gets blurred bytes", async () => {
    const requesterId = `user-${crypto.randomUUID()}`;
    const s3Key = "images/other-owner/private-teaser.png";

    vi.mocked(getAuthUserId).mockResolvedValue(requesterId);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null); // requester is free

    // The asset exists but is owned by a DIFFERENT user. The route query must
    // find it by (s3Key, kind:image, status:ready) WITHOUT a userId filter.
    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValue({ id: "asset-other" } as never);
    const fakeDataUri = "data:image/webp;base64,QUJD";
    vi.mocked(blurredDataUri).mockResolvedValue(fakeDataUri);

    const res = await GET(req(s3Key));

    // Assert the DB lookup did NOT scope by userId (C-2 ruling): the where
    // clause must not contain a userId key.
    const whereArg = vi.mocked(prisma.mediaAsset.findFirst).mock.calls[0]![0]!.where;
    expect(whereArg).not.toHaveProperty("userId");
    expect(whereArg).toMatchObject({ s3Key, kind: "image", status: "ready" });

    // Blurred bytes served, not a redirect.
    expect((res as { _redirect?: string })._redirect).toBeUndefined();
    expect(res.status).toBe(200);
  });

  it("free user requesting a key that is NOT a generated image MediaAsset gets a redirect", async () => {
    const userId = `user-${crypto.randomUUID()}`;
    const s3Key = "personas/public-art.webp";

    vi.mocked(getAuthUserId).mockResolvedValue(userId);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
    // No kind:image MediaAsset row for this key (public art / avatar).
    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValue(null);

    const res = await GET(req(s3Key));

    // Public art must still resolve normally (redirect to presigned URL).
    expect(blurredDataUri).not.toHaveBeenCalled();
    expect((res as { _redirect?: string })._redirect).toBeDefined();
  });

  it("paid user gets full-res redirect even for a generated-image key (never blurred)", async () => {
    const userId = `user-${crypto.randomUUID()}`;
    const s3Key = "images/some/paid-key.png";

    vi.mocked(getAuthUserId).mockResolvedValue(userId);
    // The key IS a generated chat-image MediaAsset.
    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValue({ id: "asset-paid" } as never);
    // Paid active subscription -> full-res allowed.
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      plan: "daily",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    } as never);

    const res = await GET(req(s3Key));

    expect(blurredDataUri).not.toHaveBeenCalled();
    expect((res as { _redirect?: string })._redirect).toBeDefined();
  });

  it("I-1 (fail closed): UNAUTHENTICATED request for a generated-image key gets blurred bytes, NOT full-res", async () => {
    const s3Key = "images/some/anon-key.png";
    // No cookie / cross-subdomain: getAuthUserId returns null.
    vi.mocked(getAuthUserId).mockResolvedValue(null);
    // The key resolves to a generated chat-image MediaAsset.
    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValue({ id: "asset-anon" } as never);
    const knownBytes = Buffer.from("anon-blurred-bytes");
    vi.mocked(blurredDataUri).mockResolvedValue(
      `data:image/webp;base64,${knownBytes.toString("base64")}`,
    );

    const res = await GET(req(s3Key));

    // Must serve blurred bytes, never a presigned redirect.
    expect((res as { _redirect?: string })._redirect).toBeUndefined();
    expect(res.status).toBe(200);
    expect(blurredDataUri).toHaveBeenCalledWith(s3Key);
    const bodyBuf = Buffer.from(await (res as Response).arrayBuffer());
    expect(bodyBuf.equals(knownBytes)).toBe(true);
    // The subscription lookup is never reached for a null-auth requester (no
    // userId to check); the blur decision is driven by the asset alone.
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it("unauthenticated request for a NON-generated-image key still redirects (no over-blur)", async () => {
    const s3Key = "personas/public-art.webp";
    vi.mocked(getAuthUserId).mockResolvedValue(null);
    // No generated-image MediaAsset for this key.
    vi.mocked(prisma.mediaAsset.findFirst).mockResolvedValue(null);

    const res = await GET(req(s3Key));

    expect(blurredDataUri).not.toHaveBeenCalled();
    expect((res as { _redirect?: string })._redirect).toBeDefined();
  });
});
