# UX and Monetization Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix image teaser anti-refusal, remove video button with in-character redirect, wire PaywallModal character image, pre-check quota on character mount, add persistent gallery image unlock, and instrument all CTA buttons for analytics.

**Architecture:** Backend-first for new routes (gallery unlock, analytics CTA); DB migration gates Tasks 5-6; Tasks 1-4 and 7 are independent and can execute after Tasks 2-3 unblock them. Frontend changes are isolated to their own components. All new server endpoints follow the existing `handleXxxRoute` pattern in `backend/src/index.ts`.

**Tech Stack:** TypeScript strict, Prisma 6 + Postgres, Next.js 16 App Router, React 19, Zod, BullMQ, existing `track()` analytics utility

**Spec:** `docs/superpowers/specs/2026-08-27-ux-monetization-improvements-design.md`

## Global Constraints

- No em dashes anywhere (code, comments, docs, commit messages) -- enforced by ESLint
- TypeScript strict mode; `any` requires a comment explaining why
- Zod validates every route handler body (`req.body` shape never trusted from types alone)
- `import { prisma } from "@buttercupp/database"` -- never `new PrismaClient()` outside `packages/database/src/client.ts`
- No git commit, push, or deploy without explicit human approval
- `POPPY_DEV_BYPASS_PAYWALL=true` in `backend/.env` -- local dev only, never prod
- Every new Prisma model or enum change requires `npx prisma migrate dev --name <name>` in `packages/database/`
- `AnalyticsEventName` union lives in `packages/shared/src/analytics.ts` -- add names there, never inline strings
- Run `npm run typecheck` from repo root before committing any TypeScript change

---

### Task 1: Anti-Refusal Hardening for Image Teaser

**Files:**
- Modify: `backend/src/chat/image-turn.ts` (function `generateImageTeaser`, lines ~292-320)
- Test: `backend/src/chat/__tests__/image-turn.test.ts` (create if not exists)

**Interfaces:**
- Produces: `generateImageTeaser(characterName, userPrompt): Promise<string>` -- same signature, never returns a refusal phrase

- [ ] **Step 1: Locate the test file or create it**

```bash
ls backend/src/chat/__tests__/ 2>/dev/null || mkdir -p backend/src/chat/__tests__
```

- [ ] **Step 2: Write the failing test**

Create/append `backend/src/chat/__tests__/image-turn.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock callLLM so tests never hit the network.
vi.mock("../../llm/provider", () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from "../../llm/provider";
import { generateImageTeaser } from "../image-turn";

const mockCallLLM = vi.mocked(callLLM);

describe("generateImageTeaser anti-refusal scanner", () => {
  beforeEach(() => { mockCallLLM.mockReset(); });

  it("returns fallback when LLM emits a refusal phrase", async () => {
    mockCallLLM.mockResolvedValue({ text: "I cannot send you an image, sorry.", provider: "openrouter" });
    const result = await generateImageTeaser("Luna", "send me a pic");
    expect(result).toBe("Give me just a moment to get that perfect shot ready for you...");
  });

  it("returns fallback when LLM emits 'unable to'", async () => {
    mockCallLLM.mockResolvedValue({ text: "I'm unable to provide that.", provider: "openrouter" });
    const result = await generateImageTeaser("Luna", "send me a pic");
    expect(result).toBe("Give me just a moment to get that perfect shot ready for you...");
  });

  it("passes through a clean in-character response", async () => {
    mockCallLLM.mockResolvedValue({ text: "Give me one second, cutie!", provider: "openrouter" });
    const result = await generateImageTeaser("Luna", "send me a pic");
    expect(result).toBe("Give me one second, cutie!");
  });

  it("hardcoded provider result falls back to fallback", async () => {
    mockCallLLM.mockResolvedValue({ text: "some text", provider: "hardcoded" });
    const result = await generateImageTeaser("Luna", "any");
    expect(result).toBe("Give me just a moment to get that perfect shot ready for you...");
  });
});
```

- [ ] **Step 3: Run to confirm it fails**

```bash
cd backend && npx vitest run src/chat/__tests__/image-turn.test.ts 2>&1 | tail -20
```

Expected: FAIL (scanner function does not exist yet)

- [ ] **Step 4: Implement the refusal scanner and system prompt hardening**

In `backend/src/chat/image-turn.ts`, find `generateImageTeaser` and make these two changes:

**a) Refusal scanner constant** (add near top of file, after imports):

```typescript
const REFUSAL_PATTERNS = [
  /\bcannot\b/i,
  /\bcan'?t\b/i,
  /\bunable\s+to\b/i,
  /\bdon'?t\s+have\s+the\s+ability\b/i,
  /\bnot\s+able\s+to\b/i,
  /\bwon'?t\s+be\s+able\b/i,
  /\bi'?m\s+an\s+ai\b/i,
  /\bi\s+am\s+an\s+ai\b/i,
];

function containsRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((re) => re.test(text));
}
```

**b) Updated `generateImageTeaser`** -- change `systemPrompt` and add scanner:

Replace the current `systemPrompt` string (the one that starts `"You are ${characterName}. The user has requested..."`) with:

```typescript
systemPrompt: `You are ${characterName}. The user has requested a photo of you. Write a short, playful, in-character response (1-2 sentences) to let them know their photo is on its way. Be flirtatious and stay fully in character. No hashtags, no emojis, no stage directions. CRITICAL: Never say you cannot, will not, or are unable to provide, send, or show an image. You ARE sending one right now. Any refusal breaks the experience.`,
```

Then in the post-LLM result handling, replace:
```typescript
if (!text || result.provider === "hardcoded") return fallback;
return text;
```

with:

```typescript
if (!text || result.provider === "hardcoded") return fallback;
if (containsRefusal(text)) return fallback;
return text;
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
cd backend && npx vitest run src/chat/__tests__/image-turn.test.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 6: Run full typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add backend/src/chat/image-turn.ts backend/src/chat/__tests__/image-turn.test.ts
git commit -m "fix: harden image teaser against LLM refusal slip-through"
```

---

### Task 2: Video Intent Detection and In-Character Redirect

**Files:**
- Modify: `backend/src/chat/intent.ts`
- Modify: `backend/src/http/chat-stream.ts`
- Modify: `frontend/components/chat/ChatWindow.tsx`
- Test: `backend/src/chat/__tests__/intent.test.ts` (extend or create)

**Interfaces:**
- Consumes: `callLLM` from `../../llm/provider`
- Produces: `MessageIntent` extended to `"image" | "text" | "video_request"`; `matchVideoKeyword(text: string): boolean` exported from `intent.ts`

- [ ] **Step 1: Write failing tests for video intent**

Append to `backend/src/chat/__tests__/intent.test.ts` (or create it):

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../../llm/provider", () => ({
  callLLM: vi.fn().mockResolvedValue({ text: '{"intent":"text"}', provider: "openrouter" }),
}));

import { matchVideoKeyword, classifyMessageIntent } from "../intent";

describe("matchVideoKeyword", () => {
  it("matches 'send me a video'", () => expect(matchVideoKeyword("send me a video")).toBe(true));
  it("matches 'give me a clip'", () => expect(matchVideoKeyword("give me a clip")).toBe(true));
  it("matches 'can you film me'", () => expect(matchVideoKeyword("can you film me")).toBe(true));
  it("does not match 'send me a photo'", () => expect(matchVideoKeyword("send me a photo")).toBe(false));
  it("does not match casual text", () => expect(matchVideoKeyword("how are you")).toBe(false));
});

describe("classifyMessageIntent returns video_request", () => {
  it("short circuits to video_request on video keyword", async () => {
    const intent = await classifyMessageIntent("send me a short video of you right now");
    expect(intent).toBe("video_request");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd backend && npx vitest run src/chat/__tests__/intent.test.ts 2>&1 | tail -10
```

Expected: FAIL (`matchVideoKeyword` not exported, `video_request` not a valid return value)

- [ ] **Step 3: Extend `MessageIntent` and add video keyword patterns in `intent.ts`**

In `backend/src/chat/intent.ts`:

**a)** Change the type:
```typescript
export type MessageIntent = "image" | "text" | "video_request";
```

**b)** Add the video patterns array BEFORE `IMAGE_KEYWORD_PATTERNS`:
```typescript
const VIDEO_KEYWORD_PATTERNS: RegExp[] = [
  /\b(send|show|share|give|drop|make|shoot|take|record)\s+(me\s+)?(a\s+|an\s+|the\s+|another\s+|one\s+more\s+)?(video|clip|vid|film|movie|short\s+film)\b/i,
  /\b(can|could)\s+you\s+(film|video|record)\s+(me|yourself|us)\b/i,
  /^(video|clip|vid)\s*(please|pls)?\s*[!.?]?$/i,
  /\bfilm\s+me\b/i,
];
```

**c)** Add and export `matchVideoKeyword`:
```typescript
export function matchVideoKeyword(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return VIDEO_KEYWORD_PATTERNS.some((re) => re.test(t));
}
```

**d)** In `classifyMessageIntent`, add the video check as the FIRST check (before the image keyword floor):
```typescript
export async function classifyMessageIntent(text: string): Promise<MessageIntent> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "text";

  // Video check fires first: video requests must NOT fall into image generation.
  if (matchVideoKeyword(trimmed)) return "video_request";

  // Deterministic image floor (existing logic follows unchanged).
  if (matchImageKeyword(trimmed)) return "image";
  // ... rest of function unchanged
```

- [ ] **Step 4: Handle `video_request` in `chat-stream.ts`**

In `backend/src/http/chat-stream.ts`, find the line:
```typescript
if ((await classifyMessageIntent(body.text)) === "image") {
```

Replace it with:

```typescript
const messageIntent = await classifyMessageIntent(body.text);

if (messageIntent === "video_request") {
  // Persist user message then return a gentle in-character redirect.
  await prisma.message.create({
    data: { conversationId: body.conversationId, role: "user", content: body.text },
  });
  const convRowV = await prisma.conversation.findUnique({
    where: { id: body.conversationId },
    select: { character: { select: { name: true } } },
  });
  const charNameV = convRowV?.character?.name ?? "companion";
  const videoFallback = `Videos aren't my thing just yet, but I'd love to send you a photo instead -- just ask!`;
  let redirectText = videoFallback;
  try {
    const vResult = await callLLM({
      purpose: "chat",
      systemPrompt: `You are ${charNameV}. The user asked for a video. Warmly and charmingly let them know you can't do videos right now, but you'd love to send them photos and keep chatting. 1-2 sentences, flirtatious and in-character. No hashtags, no emojis, no stage directions.`,
      messages: [{ role: "user", content: body.text }],
      maxTokens: 70,
      temperature: 0.9,
      contentRating: "mature",
    });
    if (vResult.text?.trim() && vResult.provider !== "hardcoded") {
      redirectText = vResult.text.trim();
    }
  } catch {
    // use fallback
  }
  sseWrite(res, "token", { delta: redirectText });
  const redirectMsg = await prisma.message.create({
    data: { conversationId: body.conversationId, role: "assistant", content: redirectText },
  });
  sseWrite(res, "done", { messageId: redirectMsg.id, provider: "stheno", model: "text" });
  res.end();
  return true;
}

if (messageIntent === "image") {
```

Also add the import for `callLLM` at the top of `chat-stream.ts` if not already present:
```typescript
import { callLLM } from "../llm/provider";
```

- [ ] **Step 5: Remove Video SceneButton from `ChatWindow.tsx`**

In `frontend/components/chat/ChatWindow.tsx`, delete these lines (the Video SceneButton block):
```tsx
<SceneButton
  icon={<Video className="h-3.5 w-3.5" />}
  label="Video"
  onClick={() => setInput("Send me a short video of you right now")}
  disabled={pending || paywall !== null}
/>
```

Also remove the `Video` import from lucide-react at the top if it is no longer used elsewhere in the file:
```typescript
// Find: import { ..., Video, ... } from "lucide-react";
// Remove Video from the destructured list.
```

- [ ] **Step 6: Run intent tests**

```bash
cd backend && npx vitest run src/chat/__tests__/intent.test.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add backend/src/chat/intent.ts backend/src/http/chat-stream.ts frontend/components/chat/ChatWindow.tsx backend/src/chat/__tests__/intent.test.ts
git commit -m "feat: detect video intent and return in-character redirect; remove video quick-action button"
```

---

### Task 3: PaywallModal Character Image + Global Quota Mount Check

**Files:**
- Modify: `frontend/components/chat/ChatWindow.tsx`

**Interfaces:**
- Consumes: `GET /api/billing/status` (existing Next.js route at `frontend/app/api/billing/status/route.ts`) -- returns `{ entitlements: { chats: QuotaBucket, images: QuotaBucket }, active: boolean, plan: string }`
- Produces: No new exports; `ChatWindow` shows paywall on mount if quota exhausted AND shows character image in `PaywallModal`

- [ ] **Step 1: Pass avatarUrl and characterName to PaywallModal**

In `frontend/components/chat/ChatWindow.tsx`, find the `<PaywallModal ...>` render block (around line 745):

```tsx
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
```

Replace with:

```tsx
{paywall ? (
  <PaywallModal
    scope={paywall.scope}
    kind={paywall.kind}
    used={paywall.used}
    limit={paywall.limit}
    plans={paywall.plans}
    avatarUrl={avatarUrl}
    characterName={characterName}
    onResumed={() => setPaywall(null)}
  />
) : null}
```

Both `avatarUrl` and `characterName` are already destructured from `ChatWindowProps` at the top of the component function. This is a two-prop change.

- [ ] **Step 2: Add global quota pre-check on mount**

Find where the existing `useEffect` hooks are defined in `ChatWindow` (around line 133). Add a NEW `useEffect` at the start of the hook section:

```typescript
// Pre-check quota on mount so users who already hit their limit see the
// paywall immediately on switching characters, without needing to attempt a send.
React.useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const r = await fetch("/api/billing/status", { credentials: "include" });
      if (!r.ok || cancelled) return;
      const data = (await r.json()) as {
        entitlements: { chats: { remaining: number; used: number; limit: number }; images: { remaining: number; used: number; limit: number } };
        active: boolean;
      };
      if (cancelled) return;
      const { chats } = data.entitlements;
      if (chats.remaining === 0) {
        setPaywall({
          scope: data.active ? "plan_quota" : "free_trial",
          kind: "chat",
          used: chats.used,
          limit: chats.limit,
          plans: [],
        });
      }
    } catch {
      // Non-fatal: if the check fails, the user gets the 402 on their first send attempt.
    }
  })();
  return () => { cancelled = true; };
}, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional mount-only check
```

Note: `PaywallState` in `ChatWindow` already has `{ scope, kind, used, limit, plans }` -- verify the local type before implementing and adjust field names if needed. The `PaywallModal` fetches live plans on its own mount so passing `plans: []` is fine.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add frontend/components/chat/ChatWindow.tsx
git commit -m "feat: pass character image to PaywallModal; pre-check quota on character mount"
```

---

### Task 4: DB Migration for Gallery Image Unlock

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Creates migration: `packages/database/prisma/migrations/<timestamp>_gallery_unlock/`

**Interfaces:**
- Produces: `prisma.userUnlockedMedia` model available in all workspaces; `gallery_unlock` value in `TokenReason` enum

- [ ] **Step 1: Add `UserUnlockedMedia` model and `gallery_unlock` enum value to schema**

Open `packages/database/prisma/schema.prisma`.

**a)** In the `TokenReason` enum (search for `enum TokenReason`), add `gallery_unlock`:
```prisma
enum TokenReason {
  purchase
  image_gen
  voice_gen
  premium_msg
  grant
  gallery_unlock
}
```

**b)** Add the new model after the `AuditLog` model (search for the `// Safety, audit, analytics, flags` section or after `model AuditLog`):
```prisma
model UserUnlockedMedia {
  id               String   @id @default(uuid())
  userId           String
  characterMediaId String
  unlockedAt       DateTime @default(now())

  @@unique([userId, characterMediaId])
  @@index([userId])
}
```

- [ ] **Step 2: Run migration**

```bash
cd packages/database && npx prisma migrate dev --name gallery_unlock 2>&1 | tail -20
```

Expected: Migration created and applied. Prisma client regenerated.

- [ ] **Step 3: Verify the new model is accessible**

```bash
cd packages/database && npx prisma studio 2>&1 | grep -i "UserUnlockedMedia\|Error" | head -5
```

Or simply:
```bash
cd packages/database && npx prisma validate 2>&1 | tail -5
```

Expected: Schema is valid.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: 0 errors (Prisma client regenerated with new model).

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/
git commit -m "feat: add UserUnlockedMedia model and gallery_unlock token reason"
```

---

### Task 5: Gallery Unlock Backend Route

**Files:**
- Create: `backend/src/http/gallery.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/http/__tests__/gallery.test.ts`

**Interfaces:**
- Consumes: `assertCanImage`, `recordImageConsumption` from `../subscription/enforce`; `prisma` from `@buttercupp/database`
- Produces: `handleGalleryRoute(req, res): Promise<boolean>` -- returns true if it handled the request, false otherwise; registered in `index.ts`

- [ ] **Step 1: Write failing test**

Create `backend/src/http/__tests__/gallery.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@buttercupp/database", () => ({
  prisma: {
    userUnlockedMedia: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    session: { findUnique: vi.fn() },
  },
}));
vi.mock("../../subscription/enforce", () => ({
  assertCanImage: vi.fn(),
  recordImageConsumption: vi.fn(),
}));

import { handleGalleryRoute } from "../gallery";
import { assertCanImage, recordImageConsumption } from "../../subscription/enforce";
import { prisma } from "@buttercupp/database";

const mockAssertCanImage = vi.mocked(assertCanImage);
const mockRecordConsumption = vi.mocked(recordImageConsumption);
const mockUpsert = vi.mocked(prisma.userUnlockedMedia.upsert);

function makeReqRes(body: unknown, sessionUserId = "user-1") {
  const chunks: string[] = [];
  const res = {
    writeHead: vi.fn(),
    end: vi.fn((b: string) => { chunks.push(b); }),
    statusCode: 200,
  } as unknown as import("http").ServerResponse;
  const req = {
    method: "POST",
    url: "/gallery/unlock",
    headers: { "content-type": "application/json" },
    sessionUserId,
    body: JSON.stringify(body),
  } as unknown as import("http").IncomingMessage & { sessionUserId?: string };
  return { req, res, chunks };
}

describe("POST /gallery/unlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertCanImage.mockResolvedValue(undefined);
    // upsert returns { created: true } on first unlock, { created: false } on repeat
    mockUpsert.mockResolvedValue({ created: true } as unknown as Awaited<ReturnType<typeof prisma.userUnlockedMedia.upsert>>);
    mockRecordConsumption.mockResolvedValue(undefined);
  });

  it("returns 400 when characterMediaId missing", async () => {
    const { req, res } = makeReqRes({});
    await handleGalleryRoute(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything());
  });

  it("calls assertCanImage and records consumption on new unlock", async () => {
    const { req, res } = makeReqRes({ characterMediaId: "media-1" });
    await handleGalleryRoute(req, res);
    expect(mockAssertCanImage).toHaveBeenCalledWith("user-1");
    expect(mockRecordConsumption).toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything());
  });

  it("skips token deduction on duplicate unlock (upsert found existing)", async () => {
    // Simulate already unlocked: upsert returns row with unlockedAt in the past (created field false)
    mockUpsert.mockResolvedValue({ created: false } as unknown as Awaited<ReturnType<typeof prisma.userUnlockedMedia.upsert>>);
    const { req, res } = makeReqRes({ characterMediaId: "media-1" });
    await handleGalleryRoute(req, res);
    expect(mockAssertCanImage).not.toHaveBeenCalled();
    expect(mockRecordConsumption).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything());
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd backend && npx vitest run src/http/__tests__/gallery.test.ts 2>&1 | tail -10
```

Expected: FAIL (module not found)

- [ ] **Step 3: Create `backend/src/http/gallery.ts`**

```typescript
import type http from "node:http";
import { z } from "zod";
import { prisma } from "@buttercupp/database";
import { assertCanImage, recordImageConsumption } from "../subscription/enforce";

const unlockBodySchema = z.object({
  characterMediaId: z.string().min(1),
});

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

export async function handleGalleryRoute(
  req: http.IncomingMessage & { sessionUserId?: string },
  res: http.ServerResponse,
): Promise<boolean> {
  if (req.method === "POST" && req.url === "/gallery/unlock") {
    const userId = req.sessionUserId;
    if (!userId) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }

    let rawBody = "";
    for await (const chunk of req) rawBody += chunk;
    const parsed = unlockBodySchema.safeParse(JSON.parse(rawBody || "{}"));
    if (!parsed.success) {
      json(res, 400, { error: "invalid_body", issues: parsed.error.issues });
      return true;
    }

    const { characterMediaId } = parsed.data;

    // Check if already unlocked (idempotent path -- no token deduction).
    const existing = await prisma.userUnlockedMedia.findUnique({
      where: { userId_characterMediaId: { userId, characterMediaId } },
    });
    if (existing) {
      json(res, 200, { success: true });
      return true;
    }

    // Gate: active plan + image quota.
    await assertCanImage(userId);

    // Record unlock and deduct token.
    await prisma.userUnlockedMedia.create({ data: { userId, characterMediaId } });
    await recordImageConsumption(userId);

    json(res, 200, { success: true });
    return true;
  }
  return false;
}
```

Note: the idempotency check and test use `findUnique` + `create` instead of `upsert` -- this is cleaner for the test setup. Adjust the test mock if needed to match.

- [ ] **Step 4: Register route in `backend/src/index.ts`**

Add import at top:
```typescript
import { handleGalleryRoute } from "./http/gallery";
```

In the request handler block (around line 68-72), add:
```typescript
if (await handleGalleryRoute(req, res)) return;
```

Add it BEFORE `handleBillingRoute` so it runs first.

- [ ] **Step 5: Run tests and typecheck**

```bash
cd backend && npx vitest run src/http/__tests__/gallery.test.ts 2>&1 | tail -10
npm run typecheck 2>&1 | tail -10
```

Expected: tests PASS, typecheck 0 errors

- [ ] **Step 6: Commit**

```bash
git add backend/src/http/gallery.ts backend/src/http/__tests__/gallery.test.ts backend/src/index.ts
git commit -m "feat: add POST /gallery/unlock route with idempotent token deduction"
```

---

### Task 6: Gallery Unlock Frontend

**Files:**
- Modify: `frontend/app/(protected)/private-content/[characterId]/page.tsx`
- Modify: `frontend/components/gallery/PrivateContentGallery.tsx`
- Modify: `frontend/app/(protected)/chat/[characterId]/page.tsx`
- Modify: `frontend/components/gallery/GalleryPaywall.tsx`

**Interfaces:**
- Consumes: `POST /gallery/unlock` from Task 5; `requireAuth()` from `@/lib/auth`; `UserUnlockedMedia` prisma model from Task 4
- Produces: No new exports; both gallery surfaces support inline image unlock for subscribed users

**Note on subscription check:** Query `prisma.subscription.findUnique({ where: { userId: user.id }, select: { status: true, currentPeriodEnd: true } })` in server components. A plan is active when `status === "active"` and `currentPeriodEnd == null || currentPeriodEnd > new Date()`.

**Note on `BACKEND_URL`:** In client components, use the existing pattern from `ChatWindow.tsx`: `const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";`. Verify the correct env var name by checking `frontend/components/chat/ChatWindow.tsx` imports.

- [ ] **Step 1: Update `private-content/[characterId]/page.tsx`**

After fetching the character and its media, add:
1. Subscription check:
```typescript
const sub = await prisma.subscription.findUnique({
  where: { userId: user.id },
  select: { status: true, currentPeriodEnd: true },
});
const hasActivePlan =
  sub?.status === "active" &&
  (sub.currentPeriodEnd == null || sub.currentPeriodEnd.getTime() > Date.now());
```

2. Query unlocked media IDs:
```typescript
const unlockedRows = await prisma.userUnlockedMedia.findMany({
  where: { userId: user.id, characterMediaId: { in: lockedMedia.map((m) => m.id) } },
  select: { characterMediaId: true },
});
const unlockedSet = new Set(unlockedRows.map((r) => r.characterMediaId));
```

3. Sign URLs for already-unlocked images (so they render immediately):
```typescript
const unlockedTiles: { id: string; url: string }[] = lockedMedia
  .filter((m) => unlockedSet.has(m.id))
  .map((m) => ({
    id: m.id,
    url: m.url.startsWith("/") || m.url.startsWith("http") ? m.url : signAssetUrl(m.url),
  }));
const stillLockedTiles: PrivateLockedTile[] = lockedMedia
  .filter((m) => !unlockedSet.has(m.id))
  .map((m, i) => ({ id: m.id, kind: m.kind === "video" ? "video" : "image" as const, blur: lockedBlurs[lockedMedia.findIndex(x => x.id === m.id)] ?? "" }));
```

4. Pass new props to `PrivateContentGallery`:
```tsx
<PrivateContentGallery
  characterName={character.name}
  freeImageUrl={freeImageUrl}
  lockedTiles={stillLockedTiles}
  unlockedTiles={unlockedTiles}
  hasActivePlan={hasActivePlan}
  characterId={characterId}
/>
```

- [ ] **Step 2: Update `PrivateContentGallery.tsx` -- add client-side unlock UX**

Add `"use client";` directive at the top.

Update `PrivateLockedTile` interface (keep existing fields, no change needed).

Add new props to the `Props` interface:
```typescript
interface Props {
  characterName: string;
  freeImageUrl: string | null;
  lockedTiles: PrivateLockedTile[];
  unlockedTiles: { id: string; url: string }[];   // already unlocked -- show directly
  hasActivePlan: boolean;
  characterId: string;
}
```

Add imports at top:
```typescript
"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
```

Inside the component:
```typescript
const router = useRouter();
const [unlocking, setUnlocking] = React.useState<string | null>(null); // mediaId being unlocked

async function handleUnlock(mediaId: string) {
  if (unlocking) return;
  setUnlocking(mediaId);
  try {
    const r = await fetch(`${BACKEND_URL}/gallery/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ characterMediaId: mediaId }),
    });
    if (r.ok) {
      router.refresh(); // server re-signs URL and passes it as unlockedTile
    }
  } finally {
    setUnlocking(null);
  }
}
```

Render already-unlocked tiles (add after free tile, before locked tiles):
```tsx
{unlockedTiles.map((tile) => (
  <div key={tile.id} data-testid="private-content-tile-unlocked" data-locked="false"
    className="relative overflow-hidden rounded-2xl"
    style={{ aspectRatio: "9 / 16", border: TILE_BORDER }}
  >
    <img src={tile.url} alt={`${characterName} photo`}
      className="absolute inset-0 h-full w-full object-cover object-top" />
  </div>
))}
```

For locked tiles, update the render to split subscribed vs free:
```tsx
{lockedTiles.map((tile) => (
  <div key={tile.id} data-testid="private-content-tile-locked" data-locked="true"
    className="relative overflow-hidden rounded-2xl"
    style={{ aspectRatio: "9 / 16", border: TILE_BORDER }}
  >
    <img src={tile.blur} alt="" aria-hidden draggable={false}
      className="absolute inset-0 h-full w-full scale-110 object-cover object-top" />
    <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
    {hasActivePlan ? (
      <button type="button" onClick={() => handleUnlock(tile.id)}
        disabled={unlocking === tile.id}
        aria-label="Unlock with 1 token"
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 disabled:opacity-60"
      >
        <div className="relative flex h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <Lock className="h-4 w-4 text-white" />
        </div>
        <span className="relative rounded-full px-3 py-1 text-[10px] font-semibold text-white"
          style={{ background: "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))" }}>
          {unlocking === tile.id ? "Unlocking..." : "1 token"}
        </span>
      </button>
    ) : (
      <Link href="/billing" className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <Lock className="h-4 w-4 text-white" />
        </div>
        <span className="relative rounded-full px-3 py-1 text-[10px] font-semibold text-white"
          style={{ background: "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))" }}>
          Premium
        </span>
      </Link>
    )}
  </div>
))}
```

- [ ] **Step 3: Update `GalleryPaywall.tsx` for chat sidebar unlock**

Update `Props` interface:
```typescript
interface Props {
  images: string[];
  blurs: string[];
  characterName: string;
  mediaIds?: string[];          // parallel to images; required for unlock
  unlockedMediaIds?: string[];  // media IDs the user has already unlocked
  hasActivePlan?: boolean;
}
```

Add imports:
```typescript
"use client" stays at top (already client component)
import * as React from "react";
// Add BACKEND_URL constant
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
```

Add state and unlock handler inside the component:
```typescript
const [locallyUnlocked, setLocallyUnlocked] = React.useState<Set<string>>(new Set());
const [unlocking, setUnlocking] = React.useState<string | null>(null);

async function handleUnlock(mediaId: string, imageUrl: string) {
  if (unlocking || !mediaId) return;
  setUnlocking(mediaId);
  try {
    const r = await fetch(`${BACKEND_URL}/gallery/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ characterMediaId: mediaId }),
    });
    if (r.ok) setLocallyUnlocked((prev) => new Set([...prev, mediaId]));
  } finally {
    setUnlocking(null);
  }
}
```

In the locked tile render (the `isFree ? ... : ...` branch), update the locked branch:
```tsx
{/* Determine unlock state */}
{(() => {
  const mediaId = mediaIds?.[i];
  const alreadyUnlocked = mediaId && (unlockedMediaIds?.includes(mediaId) || locallyUnlocked.has(mediaId));

  if (alreadyUnlocked) {
    return (
      <>
        <img src={src} alt={`${characterName} photo ${i + 1}`}
          className="absolute inset-0 h-full w-full object-cover object-top" />
        <div role="button" tabIndex={0}
          onClick={() => setLightboxSrc(src)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setLightboxSrc(src); }}
          aria-label="View photo" className="absolute inset-0 cursor-pointer" />
      </>
    );
  }

  if (hasActivePlan && mediaId) {
    return (
      <button type="button"
        onClick={() => handleUnlock(mediaId, src)}
        disabled={unlocking === mediaId}
        aria-label="Unlock with 1 token"
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 disabled:opacity-60"
      >
        <img src={blurs[i] ?? ""} alt="" aria-hidden draggable={false}
          className="absolute inset-0 h-full w-full scale-110 object-cover object-top" />
        <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
        <div className="relative flex h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <Lock className="h-4 w-4 text-white" />
        </div>
        <span className="relative rounded-full px-3 py-1 text-[10px] font-semibold text-white"
          style={{ background: "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))" }}>
          {unlocking === mediaId ? "Unlocking..." : "1 token"}
        </span>
      </button>
    );
  }

  // Free user: existing lock overlay
  return (
    <button type="button" onClick={() => setUpgradeOpen(true)}
      aria-label="Unlock premium photo"
      className="absolute inset-0 flex flex-col items-center justify-center gap-2"
    >
      <img src={blurs[i] ?? ""} alt="" aria-hidden draggable={false}
        className="absolute inset-0 h-full w-full scale-110 object-cover object-top" />
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
      <div className="relative flex h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
        <Lock className="h-4 w-4 text-white" />
      </div>
      <span className="relative rounded-full px-3 py-1 text-[10px] font-semibold text-white"
        style={{ background: "linear-gradient(90deg, hsl(var(--buttercupp-accent-rose)), hsl(var(--buttercupp-accent-violet)))" }}>
        Premium
      </span>
    </button>
  );
})()}
```

- [ ] **Step 4: Update chat page to pass new props to GalleryPaywall**

In `frontend/app/(protected)/chat/[characterId]/page.tsx`:

After `const user = await requireAuth();`, add:
```typescript
const [sub, unlockedRows] = await Promise.all([
  prisma.subscription.findUnique({
    where: { userId: user.id },
    select: { status: true, currentPeriodEnd: true },
  }),
  prisma.userUnlockedMedia.findMany({
    where: { userId: user.id, characterMediaId: { in: character.media.map((m) => m.id) } },
    select: { characterMediaId: true },
  }),
]);
const hasActivePlan =
  sub?.status === "active" &&
  (sub.currentPeriodEnd == null || sub.currentPeriodEnd.getTime() > Date.now());
const unlockedMediaIds = unlockedRows.map((r) => r.characterMediaId);
```

Also build `mediaIds` in parallel with `images`:
```typescript
// Build images and parallel mediaIds arrays together.
const imageMedia = character.media.filter((m) => m.kind === "image");
const images = imageMedia.map((m) => {
  if (m.url.startsWith("/") || m.url.startsWith("http")) return m.url;
  return signAssetUrl(m.url);
});
const mediaIds = imageMedia.map((m) => m.id);
```

Then pass to `GalleryPaywall` (find its usage in the JSX):
```tsx
<GalleryPaywall
  images={carouselImages}
  blurs={[]}
  characterName={character.name}
  mediaIds={mediaIds}
  unlockedMediaIds={unlockedMediaIds}
  hasActivePlan={hasActivePlan}
/>
```

Note: `carouselImages` is derived from `images` via dedup/exclude logic. The `mediaIds` must be aligned the same way. Verify that `dedupeByIdentity` and `excludeHeroIdentity` don't reorder; if they do, build `mediaIds` in the same order. The simplest approach: after building `dedupedImages`, also build `dedupedMediaIds` in the same pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add frontend/app/\(protected\)/private-content/\[characterId\]/page.tsx \
  frontend/components/gallery/PrivateContentGallery.tsx \
  frontend/app/\(protected\)/chat/\[characterId\]/page.tsx \
  frontend/components/gallery/GalleryPaywall.tsx
git commit -m "feat: gallery image unlock for subscribed users -- 1 token per image, persistent"
```

---

### Task 7: CTA Click Tracking Backend

**Files:**
- Modify: `packages/shared/src/analytics.ts`
- Create: `backend/src/http/analytics.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/http/__tests__/analytics.test.ts`

**Interfaces:**
- Consumes: existing `track()` from `backend/src/analytics/tracker.ts`
- Produces: `handleAnalyticsRoute(req, res): Promise<boolean>`; `"cta_click"` available in `AnalyticsEventName`

- [ ] **Step 1: Add `cta_click` to AnalyticsEventName**

In `packages/shared/src/analytics.ts`, append `| "cta_click"` to the `AnalyticsEventName` union:

```typescript
export type AnalyticsEventName =
  | "signup"
  // ... (existing values unchanged)
  | "user_rule_created"
  | "cta_click";   // payment/upgrade button click tracking
```

- [ ] **Step 2: Write failing test**

Create `backend/src/http/__tests__/analytics.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../analytics/tracker", () => ({
  track: vi.fn(),
}));

import { handleAnalyticsRoute } from "../analytics";
import { track } from "../../analytics/tracker";

const mockTrack = vi.mocked(track);

function makeReq(body: unknown, method = "POST", url = "/analytics/cta", userId = "u-1") {
  const req = {
    method, url,
    sessionUserId: userId,
    headers: { "content-type": "application/json" },
    [Symbol.asyncIterator]: async function* () { yield JSON.stringify(body); },
  } as unknown as import("http").IncomingMessage & { sessionUserId?: string };
  const res = { writeHead: vi.fn(), end: vi.fn() } as unknown as import("http").ServerResponse;
  return { req, res };
}

describe("POST /analytics/cta", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns false for unrelated routes", async () => {
    const { req, res } = makeReq({}, "GET", "/other");
    expect(await handleAnalyticsRoute(req, res)).toBe(false);
  });

  it("returns 401 without session", async () => {
    const { req, res } = makeReq({ buttonId: "x", area: "y", path: "/" }, "POST", "/analytics/cta", undefined as unknown as string);
    (req as { sessionUserId?: string }).sessionUserId = undefined;
    await handleAnalyticsRoute(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.anything());
  });

  it("calls track and returns 204 for valid body", async () => {
    const { req, res } = makeReq({ buttonId: "paywall_daily_pass", area: "paywall_modal", path: "/chat/abc" });
    await handleAnalyticsRoute(req, res);
    expect(mockTrack).toHaveBeenCalledWith("cta_click", { buttonId: "paywall_daily_pass", area: "paywall_modal", path: "/chat/abc" }, "u-1");
    expect(res.writeHead).toHaveBeenCalledWith(204, expect.anything());
  });

  it("returns 400 for missing buttonId", async () => {
    const { req, res } = makeReq({ area: "x", path: "/" });
    await handleAnalyticsRoute(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything());
  });
});
```

- [ ] **Step 3: Run to confirm it fails**

```bash
cd backend && npx vitest run src/http/__tests__/analytics.test.ts 2>&1 | tail -10
```

- [ ] **Step 4: Create `backend/src/http/analytics.ts`**

```typescript
import type http from "node:http";
import { z } from "zod";
import { track } from "../analytics/tracker";

const ctaBodySchema = z.object({
  buttonId: z.string().min(1),
  area: z.string().min(1),
  path: z.string().min(1),
});

export async function handleAnalyticsRoute(
  req: http.IncomingMessage & { sessionUserId?: string },
  res: http.ServerResponse,
): Promise<boolean> {
  if (req.method === "POST" && req.url === "/analytics/cta") {
    const userId = req.sessionUserId;
    if (!userId) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return true;
    }

    let rawBody = "";
    for await (const chunk of req) rawBody += chunk;
    const parsed = ctaBodySchema.safeParse(JSON.parse(rawBody || "{}"));
    if (!parsed.success) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_body" }));
      return true;
    }

    const { buttonId, area, path } = parsed.data;
    track("cta_click", { buttonId, area, path }, userId);

    res.writeHead(204, {});
    res.end();
    return true;
  }
  return false;
}
```

- [ ] **Step 5: Register in `backend/src/index.ts`**

Add import:
```typescript
import { handleAnalyticsRoute } from "./http/analytics";
```

Add to the handler chain (before billing):
```typescript
if (await handleAnalyticsRoute(req, res)) return;
```

- [ ] **Step 6: Run tests and typecheck**

```bash
cd backend && npx vitest run src/http/__tests__/analytics.test.ts 2>&1 | tail -10
npm run typecheck 2>&1 | tail -10
```

Expected: tests PASS, typecheck 0 errors

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/analytics.ts backend/src/http/analytics.ts backend/src/http/__tests__/analytics.test.ts backend/src/index.ts
git commit -m "feat: add cta_click analytics event and POST /analytics/cta route"
```

---

### Task 8: CTA Tracking Frontend Instrumentation

**Files:**
- Create: `frontend/lib/track-cta.ts`
- Modify: `frontend/components/chat/PaywallModal.tsx`
- Modify: `frontend/components/gallery/GalleryPaywall.tsx`
- Modify: `frontend/components/gallery/PrivateContentGallery.tsx`
- Modify: `frontend/app/(protected)/billing/BillingClient.tsx`
- Modify: `frontend/components/ui/UpgradeModal.tsx`

**Interfaces:**
- Consumes: `POST /analytics/cta` from Task 7
- Produces: `trackCta(buttonId: string, area: string): void` exported from `frontend/lib/track-cta.ts`

- [ ] **Step 1: Create `frontend/lib/track-cta.ts`**

```typescript
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export function trackCta(buttonId: string, area: string): void {
  if (typeof window === "undefined") return; // SSR guard
  void fetch(`${BACKEND_URL}/analytics/cta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ buttonId, area, path: window.location.pathname }),
  }).catch(() => {}); // fire-and-forget, never throws
}
```

- [ ] **Step 2: Instrument `PaywallModal.tsx`**

Add import at top:
```typescript
import { trackCta } from "@/lib/track-cta";
```

Find each plan checkout button in the component. They trigger a fetch to `/billing/subscribe`. Wrap each button's `onClick` to call `trackCta` before the existing logic:

For daily pass button: add `trackCta("paywall_daily_pass", "paywall_modal");` at the start of its click handler.
For weekly pass button: `trackCta("paywall_weekly_pass", "paywall_modal");`
For monthly pass button: `trackCta("paywall_monthly_pass", "paywall_modal");`
For "Buy tokens" link/button: `trackCta("paywall_buy_tokens", "paywall_modal");`

Find the exact buttons by searching for `billing/subscribe` or `token-store` in the component and wrapping them.

- [ ] **Step 3: Instrument `GalleryPaywall.tsx`**

Add import: `import { trackCta } from "@/lib/track-cta";`

In the free-user lock button (the one that calls `setUpgradeOpen(true)`):
```tsx
onClick={() => { trackCta("gallery_upgrade", "gallery_sidebar"); setUpgradeOpen(true); }}
```

In the subscribed-user unlock button (added in Task 6) that calls `handleUnlock`:
```tsx
onClick={() => { trackCta("gallery_unlock_image", "gallery_sidebar"); handleUnlock(mediaId, src); }}
```

- [ ] **Step 4: Instrument `PrivateContentGallery.tsx`**

Add import: `import { trackCta } from "@/lib/track-cta";`

In the subscribed-user unlock button's `onClick`:
```tsx
onClick={() => { trackCta("gallery_unlock_image", "private_gallery"); handleUnlock(tile.id); }}
```

In the free-user `<Link href="/billing">`:
Wrap it in a `<div onClick={() => trackCta("gallery_upgrade", "private_gallery")}>` or convert to a button that navigates. The simplest approach: add an `onClick` to the Link:
```tsx
<Link href="/billing" onClick={() => trackCta("gallery_upgrade", "private_gallery")} ...>
```

- [ ] **Step 5: Instrument `BillingClient.tsx`**

Add import: `import { trackCta } from "@/lib/track-cta";`

Find each subscription and token purchase button. They call the billing subscribe endpoint or navigate to checkout. Add `trackCta` calls:
- Monthly subscription button: `trackCta("billing_sub_monthly", "billing_page")`
- Yearly subscription button: `trackCta("billing_sub_yearly", "billing_page")`
- Token pack 100 button: `trackCta("billing_pack_100", "billing_page")`
- Token pack 500 button: `trackCta("billing_pack_500", "billing_page")`
- Token pack 2000 button: `trackCta("billing_pack_2000", "billing_page")`

Add `trackCta(...)` at the START of each button's click handler (before the async checkout flow).

- [ ] **Step 6: Instrument `UpgradeModal.tsx`**

Add import: `import { trackCta } from "@/lib/track-cta";`

Find the subscribe/upgrade button and add:
```typescript
trackCta("upgrade_modal_subscribe", "upgrade_modal");
```
at the start of its click handler.

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/track-cta.ts \
  frontend/components/chat/PaywallModal.tsx \
  frontend/components/gallery/GalleryPaywall.tsx \
  frontend/components/gallery/PrivateContentGallery.tsx \
  "frontend/app/(protected)/billing/BillingClient.tsx" \
  frontend/components/ui/UpgradeModal.tsx
git commit -m "feat: instrument all CTA buttons with cta_click analytics tracking"
```

---

## Self-Review

**Spec coverage check:**
- Item 1 (anti-refusal): Task 1 covers it. Scanner + prompt hardening. 
- Item 2 (video redirect): Task 2 covers it. Backend intent + frontend button removal. 
- Item 3 (PaywallModal character image): Task 3 covers it (two-prop change). 
- Item 4 (global quota mount check): Task 3 covers it (same file). 
- Item 5 (gallery unlock): Tasks 4 (DB), 5 (API), 6 (frontend). 
- Item 6 (CTA tracking): Tasks 7 (backend), 8 (frontend). 

**Type consistency check:**
- `handleGalleryRoute` signature used in both Task 5 impl and Task 5 index.ts registration. 
- `handleAnalyticsRoute` same pattern. 
- `PrivateLockedTile` interface unchanged in Task 6. 
- `MediaIds` parallel array and `unlockedMediaIds` are `string[]` in both page.tsx and GalleryPaywall props. 
- `trackCta(buttonId: string, area: string): void` used consistently in Task 8. 

**Placeholder scan:** None found.

**Dependency order:**
- Task 4 (DB) must complete before Task 5 (backend uses `prisma.userUnlockedMedia`)
- Task 5 must complete before Task 6 (frontend calls `/gallery/unlock`)
- Task 7 (analytics backend) must complete before Task 8 (frontend calls `/analytics/cta`)
- Tasks 1, 2, 3, 4, 7 have NO interdependencies and can run in any order
