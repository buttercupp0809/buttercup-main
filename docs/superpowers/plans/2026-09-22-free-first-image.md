# Free First Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every new user sees their first in-chat generated image clearly (no blur); all subsequent images use the existing blur-plus-paywall teaser path.

**Architecture:** Add `"free_first_image"` to the `billing` discriminator on `MediaJobData`. Use a lifetime `UsageCounter` (`counterType="first_image_delivered"`, `period="lifetime"`) atomically incremented on image request - if count becomes 1 this is the first image. The chat-stream handler branches on that flag before entering the existing teaser path. The media worker delivers real URLs (not blurred) for `billing="free_first_image"` jobs, mirroring the paid path.

**Tech Stack:** TypeScript, Node.js backend, Prisma, `UsageCounter` table (no migration needed - table exists, just a new counterType string), Zod (shared media schema), BullMQ worker.

**Spec:** (inline - no separate spec doc for this bounded feature)

## Global Constraints

- No em dash character (U+2014) anywhere in code, comments, or strings.
- No `new PrismaClient()` - always import `prisma` from `@buttercupp/database`.
- Strict TypeScript - no `any` without an explanatory comment.
- No commit without explicit user approval.

---

### Task 1: Extend billing discriminator in shared schema

**Files:**
- Modify: `packages/shared/src/media.ts:34`

**Interfaces:**
- Produces: `MediaJobData.billing` now accepts `"free_teaser" | "free_first_image"`. All downstream callers (`chat-stream.ts`, `media-worker.ts`) use this new value.

- [ ] **Step 1: Open the file and locate the billing field**

Read `packages/shared/src/media.ts` line 34. Current value:
```typescript
billing: z.enum(["free_teaser"]).optional(),
```

- [ ] **Step 2: Extend the enum**

Change line 34 to:
```typescript
billing: z.enum(["free_teaser", "free_first_image"]).optional(),
```

- [ ] **Step 3: Verify TypeScript still compiles**

Run from the repo root:
```bash
cd packages/shared && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Verify the backend still compiles (it depends on shared)**

```bash
cd backend && npx tsc --noEmit
```
Expected: zero errors. If `media-worker.ts` has a type-narrowing switch on `billing`, it may need a case added - fix it now if the compiler flags it.

---

### Task 2: Add `consumeFirstFreeImage` to enforce.ts

**Files:**
- Modify: `backend/src/subscription/enforce.ts`

**Interfaces:**
- Consumes: `prisma.usageCounter.upsert` (already imported via `prisma` from `@buttercupp/database`). `CounterType` union (exported from same file).
- Produces: `consumeFirstFreeImage(userId: string): Promise<boolean>` - returns `true` exactly once per user lifetime (on first call the count goes from 0 to 1; all subsequent calls return `false`).

- [ ] **Step 1: Write the failing test**

Create `backend/src/subscription/__tests__/first-free-image.test.ts`:

```typescript
import { prisma } from "@buttercupp/database";
import { consumeFirstFreeImage } from "../enforce";

// Minimal test user seeded inline to avoid cross-test pollution.
const TEST_USER_ID = "test-first-img-user";

beforeEach(async () => {
  await prisma.usageCounter.deleteMany({
    where: { userId: TEST_USER_ID, counterType: "first_image_delivered" },
  });
});

afterAll(async () => {
  await prisma.usageCounter.deleteMany({
    where: { userId: TEST_USER_ID, counterType: "first_image_delivered" },
  });
  await prisma.$disconnect();
});

test("returns true on very first call", async () => {
  const result = await consumeFirstFreeImage(TEST_USER_ID);
  expect(result).toBe(true);
});

test("returns false on all subsequent calls", async () => {
  await consumeFirstFreeImage(TEST_USER_ID); // consumes slot
  expect(await consumeFirstFreeImage(TEST_USER_ID)).toBe(false);
  expect(await consumeFirstFreeImage(TEST_USER_ID)).toBe(false);
});
```

- [ ] **Step 2: Run to confirm the test fails (function missing)**

```bash
cd backend && npx jest --testPathPattern="first-free-image" --no-coverage 2>&1 | tail -20
```
Expected: FAIL with "consumeFirstFreeImage is not a function" or similar import error.

- [ ] **Step 3: Extend CounterType and add the function**

In `backend/src/subscription/enforce.ts`:

1. Find this line near the top:
```typescript
export type CounterType = "chat_daily" | "image_daily" | "voice_daily" | "free_teaser_image";
```
Change it to:
```typescript
export type CounterType = "chat_daily" | "image_daily" | "voice_daily" | "free_teaser_image" | "first_image_delivered";
```

2. Add this function after `assertCanTease` (around line 313):
```typescript
// Atomically claims the lifetime "first free image" slot for a user.
// Returns true exactly once, on the first call: the upsert returns count=1.
// All subsequent calls return false (count >= 2). The atomic increment
// means concurrent image requests cannot both receive true.
export async function consumeFirstFreeImage(userId: string): Promise<boolean> {
  const row = await prisma.usageCounter.upsert({
    where: {
      userId_counterType_period: {
        userId,
        counterType: "first_image_delivered",
        period: "lifetime",
      },
    },
    create: { userId, counterType: "first_image_delivered", period: "lifetime", count: 1 },
    update: { count: { increment: 1 } },
  });
  return row.count === 1;
}
```

- [ ] **Step 4: Run the test again to verify it passes**

```bash
cd backend && npx jest --testPathPattern="first-free-image" --no-coverage 2>&1 | tail -20
```
Expected: PASS (2 tests green).

- [ ] **Step 5: Compile check**

```bash
cd backend && npx tsc --noEmit
```
Expected: zero errors.

---

### Task 3: Branch the free-user path in chat-stream.ts

**Files:**
- Modify: `backend/src/http/chat-stream.ts` (around line 176-278)

**Interfaces:**
- Consumes: `consumeFirstFreeImage` (Task 2). `generateChatImage` (already imported). `assertCanTease` (already imported).
- Produces: When `isFirstImage === true`, the SSE event delivers `{ locked: false, provider: "free_first_image" }` with a real asset URL. The worker handles actual image delivery via WebSocket.

- [ ] **Step 1: Add the import**

At the top of `backend/src/http/chat-stream.ts`, find the import from `../subscription/enforce`:
```typescript
import {
  assertCanChat,
  assertCanImage,
  assertCanTease,
  recordChatConsumption,
  recordImageConsumption,
  PaywallError,
  type PaywallInfo,
} from "../subscription/enforce";
```
Add `consumeFirstFreeImage` to this import:
```typescript
import {
  assertCanChat,
  assertCanImage,
  assertCanTease,
  consumeFirstFreeImage,
  recordChatConsumption,
  recordImageConsumption,
  PaywallError,
  type PaywallInfo,
} from "../subscription/enforce";
```

- [ ] **Step 2: Insert the first-image branch inside the free-user block**

Find this block starting around line 176:
```typescript
if (isFreeUser) {
  // Free-teaser path: never throws PaywallError, so a blocked user still
  // sees a blur of an existing photo rather than an error.
  const convRowFree = await prisma.conversation.findUnique({
    where: { id: body.conversationId },
    select: { characterId: true, character: { select: { name: true } } },
  });
  const characterName = convRowFree?.character?.name ?? "companion";
  const characterId = convRowFree?.characterId ?? null;

  const teaserDecision = await assertCanTease(userId, characterId);
```

Replace with:
```typescript
if (isFreeUser) {
  const convRowFree = await prisma.conversation.findUnique({
    where: { id: body.conversationId },
    select: { characterId: true, character: { select: { name: true } } },
  });
  const characterName = convRowFree?.character?.name ?? "companion";
  const characterId = convRowFree?.characterId ?? null;

  // Lifetime free image: the very first image a user ever generates is
  // delivered without blur. consumeFirstFreeImage atomically increments
  // the "first_image_delivered" counter; it returns true exactly once.
  const isFirstImage = await consumeFirstFreeImage(userId);

  if (isFirstImage) {
    // Persist user message.
    await prisma.message.create({
      data: { conversationId: body.conversationId, role: "user", content: body.text },
    });
    // In-character acknowledgment, streamed and persisted.
    const teaser = await generateImageTeaser(characterName, body.text);
    sseWrite(res, "token", { delta: teaser });
    const teaserMsg = await prisma.message.create({
      data: { conversationId: body.conversationId, role: "assistant", content: teaser },
    });
    sseWrite(res, "done", {
      messageId: teaserMsg.id,
      provider: "stheno",
      model: "image-pending",
    });
    // Generate with free_first_image billing so the worker delivers real URL.
    const img = await generateChatImage(body.text, body.conversationId, userId, {
      billing: "free_first_image",
    });
    const id = img.mediaAssetId ?? `img-${Date.now()}`;
    if (img.mediaAssetId) {
      await prisma.message.create({
        data: {
          id: img.mediaAssetId,
          conversationId: body.conversationId,
          role: "assistant",
          content: "",
          mediaAssetId: img.mediaAssetId,
        },
      });
    } else {
      await prisma.message.create({
        data: {
          id,
          conversationId: body.conversationId,
          role: "assistant",
          content: img.url.startsWith("data:") ? "[shared a photo]" : img.url,
        },
      });
    }
    await prisma.conversation.update({
      where: { id: body.conversationId },
      data: { lastMessageAt: new Date() },
    });
    // Deliver - NOT locked, full URL.
    sseWrite(res, "image", {
      url: img.url,
      mediaAssetId: id,
      provider: "free_first_image",
    });
    res.end();
    return true;
  }

  // Existing teaser path (second image onwards).
  const teaserDecision = await assertCanTease(userId, characterId);
```

Note: the closing brace of the `if (isFreeUser)` block is unchanged - the new `if (isFirstImage)` block returns early so it never falls through.

- [ ] **Step 3: Check generateChatImage accepts a billing option**

Read `backend/src/chat/image-turn.ts` to see if `generateChatImage` accepts an options/billing parameter. If it only takes `(text, conversationId, userId)`, you need to add an optional `opts?: { billing?: "free_teaser" | "free_first_image" }` parameter and thread it into the enqueue call. Add the parameter and pass it to the BullMQ enqueue call inside `generateChatImage`.

Look for where `generateChatImage` calls `enqueueMediaJob` (or similar). Add `billing: opts?.billing` to that call.

- [ ] **Step 4: TypeScript compile check**

```bash
cd backend && npx tsc --noEmit
```
Fix any type errors before moving on.

- [ ] **Step 5: Integration smoke test**

Start the backend in dev mode, make a POST to `/chat/stream` with a free user's auth cookie and an image request. Verify:
- First request: SSE `image` event has `locked: false` and a `url` field.
- Second request: SSE `image` event has `locked: true` and a `blurUri` field.

---

### Task 4: Deliver real URL in media-worker for free_first_image jobs

**Files:**
- Modify: `backend/src/queue/media-worker.ts` (around lines 233-263)

**Interfaces:**
- Consumes: `data.billing === "free_first_image"` from `MediaJobData`.
- Produces: Worker sends real URL via `notifyMediaReady` (no blur) when billing is `"free_first_image"`, same as paid jobs. Quota consumption is still skipped (free user, no plan active).

- [ ] **Step 1: Locate the two billing-gated blocks**

In `media-worker.ts`:

Block A (quota consumption, around line 233):
```typescript
if ((data.kind === "image" || data.kind === "video") && data.billing !== "free_teaser") {
```

Block B (delivery, around line 255-263):
```typescript
const isFreeTeaser = data.billing === "free_teaser";
const blurUri = isFreeTeaser ? await blurredDataUriForKey(s3Key) : undefined;
await notifyMediaReady(data.userId, {
  mediaAssetId: data.mediaAssetId,
  url: isFreeTeaser ? "" : url,
  kind: data.kind,
  conversationId: data.conversationId,
  ...(isFreeTeaser ? { locked: true, blurUri } : {}),
});
```

- [ ] **Step 2: Update Block A to skip quota for free_first_image**

`free_first_image` jobs also get no quota deduction. Block A already excludes `"free_teaser"` - extend it to also exclude `"free_first_image"`:
```typescript
if (
  (data.kind === "image" || data.kind === "video") &&
  data.billing !== "free_teaser" &&
  data.billing !== "free_first_image"
) {
```

- [ ] **Step 3: Update Block B to deliver real URL for free_first_image**

Replace Block B with:
```typescript
const isFreeTeaser = data.billing === "free_teaser";
// free_first_image delivers a real URL (no blur), but consumes no tokens/quota.
const blurUri = isFreeTeaser ? await blurredDataUriForKey(s3Key) : undefined;
await notifyMediaReady(data.userId, {
  mediaAssetId: data.mediaAssetId,
  url: isFreeTeaser ? "" : url,
  kind: data.kind,
  conversationId: data.conversationId,
  ...(isFreeTeaser ? { locked: true, blurUri } : {}),
});
```

(Block B stays identical - the `isFreeTeaser` flag already handles this correctly since `"free_first_image" !== "free_teaser"`. Double-check: `isFreeTeaser` is false for `free_first_image`, so `url` is the real URL and no blur is added. This is correct.)

- [ ] **Step 4: Compile check**

```bash
cd backend && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: End-to-end sanity test**

With the worker running (`npm run dev` in backend), request an image as a free user via the frontend chat. Verify:
- The first image renders without blur in the chat bubble.
- The second image renders with blur and paywall CTA.
- Check `UsageCounter` in DB: `select * from "UsageCounter" where "counterType" = 'first_image_delivered';` - should have `count=1` for the test user after one request.

---

### Task 5: Frontend CTA copy update for second image onwards

**Files:**
- Modify: `backend/src/subscription/teaser-cta.ts` (or wherever `ctaLineFor` lives)

**Interfaces:**
- No interface change. This is a copy tweak only.
- Consumes: `ctaLineFor(mediaAssetId, characterName)` - already called in `chat-stream.ts`.
- Produces: The CTA text on the blur overlay now explicitly tells users they already received their one free image.

- [ ] **Step 1: Find the ctaLineFor function**

```bash
grep -n "ctaLineFor" backend/src/subscription/teaser-cta.ts
```

- [ ] **Step 2: Review current CTA lines**

Read the file. Find where character-voiced CTA strings are generated. Identify the function signature.

- [ ] **Step 3: Add a "you've used your free image" variant**

If `ctaLineFor` is deterministic per `(mediaAssetId, characterName)`, add a new export:

```typescript
// Used when the user has already received their one free image.
export function ctaLineUsedFreeSlot(characterName: string): string {
  const name = characterName;
  const lines = [
    `You already peeked at my free photo, ${name}. Ready to see more of me?`,
    `That was your one freebie from me, ${name}. Subscribe to keep going...`,
    `You've used your free look. Unlock everything with a subscription.`,
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
```

For now, the second-image teaser uses the existing `ctaLineFor`. This step is a preparatory hook - wire it in if the product team wants a different message on blur images for users who already had their free image. Skip if not needed immediately.

- [ ] **Step 4: Compile check**

```bash
cd backend && npx tsc --noEmit
```

---

### Sanity checklist (run after all tasks complete)

- [ ] `UsageCounter` row exists with `counterType='first_image_delivered'`, `period='lifetime'`, `count=1` for a fresh test user after one image request.
- [ ] Second image request for same user returns `locked: true` in the SSE event.
- [ ] `MediaJobData.billing` Zod parse succeeds for both `"free_teaser"` and `"free_first_image"`.
- [ ] Worker delivers real URL (`url !== ""`) for `billing="free_first_image"` jobs.
- [ ] No `any` types introduced. No em dashes in new code or comments.
- [ ] `npx tsc --noEmit` passes in `packages/shared/`, `backend/`, and `frontend/`.
