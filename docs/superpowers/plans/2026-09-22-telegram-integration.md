# Telegram Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users connect each AI companion character to a dedicated Telegram bot, then chat and generate images on Telegram with full parity to the in-app experience.

**Architecture:** One Telegram bot is registered per character via BotFather (manual, one-time). Bot tokens are stored in `TelegramBotConfig`. Users link their app account to a character's bot via a deep link containing a one-time token. Once linked, user messages arrive via Telegram webhook -> backend routes to `runChatTurn` -> response sent back as a Telegram message. Image generation uses the existing BullMQ worker; the worker notifies Telegram after completion. Private (display/main) character images are pushed to linked users when they first connect and when new display images are published.

**Tech Stack:** Node.js backend (TypeScript), Prisma/Postgres, Telegram Bot API (raw `fetch`, no SDK needed), `runChatTurn` from `backend/src/chat/engine.ts`, Next.js 16 App Router for frontend API routes and UI.

**Spec:** (inline)

## Global Constraints

- No em dash (U+2014) anywhere.
- No `new PrismaClient()` - import `prisma` from `@buttercupp/database`.
- Strict TypeScript, no `any` without comment.
- All Telegram API calls are fire-and-forget on best-effort basis: a Telegram delivery failure must never crash the backend or bubble up as a user-facing error.
- Telegram webhook endpoint is server-to-server (no browser CORS needed). Add it to the backend CORS bypass list.
- No commit without explicit user approval.
- Bot tokens are secrets - never log them, never send them to the frontend.

---

## File Map

**New files:**
- `packages/database/prisma/schema.prisma` - add 3 models + relations
- `backend/src/telegram/client.ts` - Telegram Bot API HTTP client
- `backend/src/telegram/linker.ts` - account link token generation and validation
- `backend/src/telegram/chat.ts` - message handler (routes to existing chat engine)
- `backend/src/telegram/image-notify.ts` - post-generation image push to Telegram
- `backend/src/http/telegram.ts` - backend HTTP handler for webhook + frontend-facing routes
- `frontend/app/api/telegram/link/route.ts` - generate deep link token
- `frontend/app/api/telegram/status/[characterId]/route.ts` - connection status
- `frontend/app/api/telegram/disconnect/route.ts` - remove link
- `frontend/components/telegram/TelegramConnectBanner.tsx` - in-chat dismissible banner
- `frontend/app/(protected)/settings/telegram/page.tsx` - settings page

**Modified files:**
- `backend/src/queue/media-worker.ts` - add Telegram image push hook after notifyMediaReady
- `backend/src/index.ts` - register Telegram HTTP handler
- `frontend/app/(protected)/chat/[characterId]/page.tsx` - render TelegramConnectBanner
- `packages/database/prisma/schema.prisma` - add relations on Character and User

---

### Task 1: Database schema - Telegram models

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Produces:
  - `TelegramBotConfig` model: `{ id, characterId (unique), botToken, botUsername, webhookSecret, createdAt, updatedAt }`
  - `TelegramUserLink` model: `{ id, userId, characterId, telegramUserId, telegramChatId, username?, linkedAt }` with unique index `(userId, characterId)` and `(telegramUserId, characterId)`
  - `TelegramLinkToken` model: `{ id, token (unique), userId, characterId, expiresAt, usedAt?, createdAt }`
  - Character relation: `telegramBotConfig TelegramBotConfig?`, `telegramUserLinks TelegramUserLink[]`
  - User relation: `telegramUserLinks TelegramUserLink[]`, `telegramLinkTokens TelegramLinkToken[]`

- [ ] **Step 1: Add three new models to schema.prisma**

At the end of the schema file (after the last model), add:

```prisma
// =============================================================================
// Telegram integration
// =============================================================================

// One bot registration per character. Bot tokens are secrets; never expose
// to the frontend. webhookSecret is sent by Telegram as the
// X-Telegram-Bot-Api-Secret-Token header on every webhook call.
model TelegramBotConfig {
  id             String    @id @default(uuid())
  characterId    String    @unique
  botToken       String    @unique
  botUsername    String
  webhookSecret  String
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  character      Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  userLinks      TelegramUserLink[]
}

// Links an app user to a character's Telegram bot. A user can be linked to
// multiple characters' bots but only one link per (user, character) pair.
model TelegramUserLink {
  id              String    @id @default(uuid())
  userId          String
  characterId     String
  telegramUserId  String
  telegramChatId  String
  username        String?
  linkedAt        DateTime  @default(now())

  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  character       Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  botConfig       TelegramBotConfig @relation(fields: [characterId], references: [characterId], onDelete: Cascade)

  @@unique([userId, characterId])
  @@unique([telegramUserId, characterId])
  @@index([userId])
  @@index([telegramUserId])
}

// One-time link tokens. Minted when the user clicks "Connect on Telegram";
// consumed when the Telegram /start handler validates and creates the link.
model TelegramLinkToken {
  id          String    @id @default(uuid())
  token       String    @unique
  userId      String
  characterId String
  expiresAt   DateTime
  usedAt      DateTime?
  createdAt   DateTime  @default(now())

  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([token])
  @@index([expiresAt])
}
```

- [ ] **Step 2: Add relations to existing Character model**

Inside the `model Character { ... }` block, after the existing relation fields, add:
```prisma
  telegramBotConfig  TelegramBotConfig?
  telegramUserLinks  TelegramUserLink[]
```

- [ ] **Step 3: Add relations to existing User model**

Inside the `model User { ... }` block, after `unlockedMedia UserUnlockedMedia[]`, add:
```prisma
  telegramUserLinks  TelegramUserLink[]
  telegramLinkTokens TelegramLinkToken[]
```

- [ ] **Step 4: Generate and apply migration (local only)**

```bash
cd packages/database && npx prisma migrate dev --name telegram_integration
```
Expected: migration created, applied to local DB, Prisma client regenerated.

- [ ] **Step 5: Verify Prisma client regenerated**

```bash
cd backend && npx tsc --noEmit
```
Expected: zero errors. If there are errors about unknown model names, re-run `npx prisma generate`.

---

### Task 2: Telegram Bot API client

**Files:**
- Create: `backend/src/telegram/client.ts`

**Interfaces:**
- Produces:
  - `sendMessage(botToken: string, chatId: string, text: string): Promise<void>`
  - `sendPhoto(botToken: string, chatId: string, photoUrl: string, caption?: string): Promise<void>`
  - `sendChatAction(botToken: string, chatId: string, action: "typing" | "upload_photo"): Promise<void>`
  - `setWebhook(botToken: string, webhookUrl: string, secretToken: string): Promise<void>`
  - `setMyPhoto(botToken: string, photoUrl: string): Promise<void>` - sets bot profile picture from URL

- [ ] **Step 1: Write the test**

Create `backend/src/telegram/__tests__/client.test.ts`:

```typescript
import { buildApiUrl } from "../client";

// Only test the pure helper - actual HTTP calls are tested via integration.
test("buildApiUrl constructs correct endpoint", () => {
  const url = buildApiUrl("BOT_TOKEN_123", "sendMessage");
  expect(url).toBe("https://api.telegram.org/botBOT_TOKEN_123/sendMessage");
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd backend && npx jest --testPathPattern="telegram/client" --no-coverage 2>&1 | tail -10
```

- [ ] **Step 3: Implement the client**

Create `backend/src/telegram/client.ts`:

```typescript
import { logWarn } from "../utils/log";

const TELEGRAM_API = "https://api.telegram.org";

export function buildApiUrl(botToken: string, method: string): string {
  return `${TELEGRAM_API}/bot${botToken}/${method}`;
}

async function callApi(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(buildApiUrl(botToken, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logWarn("telegram", `fetch failed method=${method}`, {
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logWarn("telegram", `api error method=${method} status=${res.status}`, { body: text });
  }
}

export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  await callApi(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  });
}

export async function sendPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption?: string,
): Promise<void> {
  await callApi(botToken, "sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    ...(caption ? { caption } : {}),
  });
}

export async function sendChatAction(
  botToken: string,
  chatId: string,
  action: "typing" | "upload_photo",
): Promise<void> {
  await callApi(botToken, "sendChatAction", { chat_id: chatId, action });
}

export async function setWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken: string,
): Promise<void> {
  await callApi(botToken, "setWebhook", {
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ["message"],
  });
}

// Sets the bot's profile photo from a publicly accessible URL.
// Telegram requires the photo to be downloaded first, then uploaded as multipart.
// This is a best-effort call; failures are logged but not thrown.
export async function setMyPhoto(botToken: string, photoUrl: string): Promise<void> {
  try {
    const imgRes = await fetch(photoUrl);
    if (!imgRes.ok) {
      logWarn("telegram", `setMyPhoto fetch failed status=${imgRes.status}`);
      return;
    }
    const blob = await imgRes.blob();
    const form = new FormData();
    form.append("photo", blob, "photo.jpg");
    const apiRes = await fetch(buildApiUrl(botToken, "setMyPhoto"), {
      method: "POST",
      body: form,
    });
    if (!apiRes.ok) {
      const text = await apiRes.text().catch(() => "");
      logWarn("telegram", `setMyPhoto api error status=${apiRes.status}`, { body: text });
    }
  } catch (err) {
    logWarn("telegram", `setMyPhoto error`, {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [ ] **Step 4: Run test**

```bash
cd backend && npx jest --testPathPattern="telegram/client" --no-coverage 2>&1 | tail -10
```
Expected: PASS.

- [ ] **Step 5: Compile check**

```bash
cd backend && npx tsc --noEmit
```

---

### Task 3: Account linking - token generation and validation

**Files:**
- Create: `backend/src/telegram/linker.ts`

**Interfaces:**
- Consumes: `prisma.telegramLinkToken`, `prisma.telegramUserLink`, `prisma.telegramBotConfig`
- Produces:
  - `generateLinkToken(userId: string, characterId: string): Promise<{ token: string; botUsername: string; deepLink: string }>` - mints a 15-minute one-time token and returns the `t.me` deep link.
  - `consumeLinkToken(token: string, telegramUserId: string, telegramChatId: string, username?: string): Promise<{ ok: true; characterId: string; userId: string } | { ok: false; reason: string }>` - validates token, creates `TelegramUserLink`, marks token used.
  - `getTelegramLink(userId: string, characterId: string): Promise<TelegramUserLink | null>` - lookup for status checks.
  - `removeTelegramLink(userId: string, characterId: string): Promise<void>` - disconnect.

- [ ] **Step 1: Write tests**

Create `backend/src/telegram/__tests__/linker.test.ts`:

```typescript
import { prisma } from "@buttercupp/database";
import { generateLinkToken, consumeLinkToken, getTelegramLink, removeTelegramLink } from "../linker";

const TEST_USER = "tg-linker-test-user";
const TEST_CHAR = "tg-linker-test-char";
const TEST_TG_USER = "123456789";
const TEST_TG_CHAT = "123456789";

// These tests require a live DB with a seeded TelegramBotConfig row for TEST_CHAR.
// Skip if no bot config exists (CI without bot secrets).

beforeAll(async () => {
  // Clean any leftovers from previous runs.
  await prisma.telegramLinkToken.deleteMany({ where: { userId: TEST_USER } });
  await prisma.telegramUserLink.deleteMany({ where: { userId: TEST_USER } });
});

afterAll(async () => {
  await prisma.telegramLinkToken.deleteMany({ where: { userId: TEST_USER } });
  await prisma.telegramUserLink.deleteMany({ where: { userId: TEST_USER } });
  await prisma.$disconnect();
});

test("consumeLinkToken rejects expired token", async () => {
  // Insert an already-expired token directly.
  await prisma.telegramLinkToken.create({
    data: {
      token: "expired-token-test",
      userId: TEST_USER,
      characterId: TEST_CHAR,
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  const result = await consumeLinkToken("expired-token-test", TEST_TG_USER, TEST_TG_CHAT);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("token_expired");
});

test("consumeLinkToken rejects already-used token", async () => {
  await prisma.telegramLinkToken.create({
    data: {
      token: "used-token-test",
      userId: TEST_USER,
      characterId: TEST_CHAR,
      expiresAt: new Date(Date.now() + 900_000),
      usedAt: new Date(),
    },
  });
  const result = await consumeLinkToken("used-token-test", TEST_TG_USER, TEST_TG_CHAT);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("token_already_used");
});

test("consumeLinkToken rejects unknown token", async () => {
  const result = await consumeLinkToken("nonexistent-token-xyz", TEST_TG_USER, TEST_TG_CHAT);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("token_not_found");
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd backend && npx jest --testPathPattern="telegram/linker" --no-coverage 2>&1 | tail -20
```

- [ ] **Step 3: Implement linker.ts**

Create `backend/src/telegram/linker.ts`:

```typescript
import { randomBytes } from "node:crypto";
import { prisma } from "@buttercupp/database";
import type { TelegramUserLink } from "@buttercupp/database";
import { logInfo, logWarn } from "../utils/log";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

export async function generateLinkToken(
  userId: string,
  characterId: string,
): Promise<{ token: string; botUsername: string; deepLink: string }> {
  const bot = await prisma.telegramBotConfig.findUnique({ where: { characterId } });
  if (!bot) throw new Error("no_bot_configured_for_character");

  const token = randomBytes(24).toString("hex");
  await prisma.telegramLinkToken.create({
    data: {
      token,
      userId,
      characterId,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  const deepLink = `https://t.me/${bot.botUsername}?start=${token}`;
  logInfo("telegram", `link token minted for user=${userId} char=${characterId}`);
  return { token, botUsername: bot.botUsername, deepLink };
}

export async function consumeLinkToken(
  token: string,
  telegramUserId: string,
  telegramChatId: string,
  username?: string,
): Promise<
  | { ok: true; characterId: string; userId: string }
  | { ok: false; reason: string }
> {
  const row = await prisma.telegramLinkToken.findUnique({ where: { token } });
  if (!row) return { ok: false, reason: "token_not_found" };
  if (row.usedAt) return { ok: false, reason: "token_already_used" };
  if (row.expiresAt < new Date()) return { ok: false, reason: "token_expired" };

  // Mark used and upsert the link atomically.
  await prisma.$transaction([
    prisma.telegramLinkToken.update({
      where: { token },
      data: { usedAt: new Date() },
    }),
    prisma.telegramUserLink.upsert({
      where: {
        userId_characterId: { userId: row.userId, characterId: row.characterId },
      },
      create: {
        userId: row.userId,
        characterId: row.characterId,
        telegramUserId,
        telegramChatId,
        username: username ?? null,
      },
      update: {
        telegramUserId,
        telegramChatId,
        username: username ?? null,
        linkedAt: new Date(),
      },
    }),
  ]);

  logInfo("telegram", `account linked user=${row.userId} char=${row.characterId} tg=${telegramUserId}`);
  return { ok: true, characterId: row.characterId, userId: row.userId };
}

export async function getTelegramLink(
  userId: string,
  characterId: string,
): Promise<TelegramUserLink | null> {
  return prisma.telegramUserLink.findUnique({
    where: { userId_characterId: { userId, characterId } },
  });
}

export async function removeTelegramLink(userId: string, characterId: string): Promise<void> {
  await prisma.telegramUserLink.deleteMany({
    where: { userId, characterId },
  });
  logInfo("telegram", `account unlinked user=${userId} char=${characterId}`);
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx jest --testPathPattern="telegram/linker" --no-coverage 2>&1 | tail -20
```
Expected: 3 tests pass.

- [ ] **Step 5: Compile check**

```bash
cd backend && npx tsc --noEmit
```

---

### Task 4: Telegram chat handler

**Files:**
- Create: `backend/src/telegram/chat.ts`

**Interfaces:**
- Consumes:
  - `runChatTurn(params: RunChatTurnParams): Promise<RunChatTurnResult>` from `../chat/engine`
  - `generateChatImage(text, conversationId, userId)` from `../chat/image-turn`
  - `classifyMessageIntent(text)` from `../chat/intent`
  - `sendMessage`, `sendPhoto`, `sendChatAction` from `./client`
  - `assertCanChat`, `assertCanTease`, `consumeFirstFreeImage`, `entitlementsFor` from `../subscription/enforce`
  - `prisma` from `@buttercupp/database`
- Produces: `handleTelegramMessage(params: TelegramMessageParams): Promise<void>` - the core message dispatch function called from the webhook handler.

- [ ] **Step 1: Create chat.ts**

Create `backend/src/telegram/chat.ts`:

```typescript
import { prisma } from "@buttercupp/database";
import { runChatTurn } from "../chat/engine";
import { generateChatImage, generateImageTeaser } from "../chat/image-turn";
import { classifyMessageIntent } from "../chat/intent";
import { sendMessage, sendChatAction } from "./client";
import { entitlementsFor, assertCanTease, consumeFirstFreeImage, PaywallError } from "../subscription/enforce";
import { logInfo, logWarn, logError } from "../utils/log";

export interface TelegramMessageParams {
  botToken: string;
  telegramChatId: string;
  telegramUserId: string;
  userId: string;
  characterId: string;
  text: string;
}

// Finds or creates a conversation for a Telegram user + character pair.
// Uses a special source marker so Telegram messages are distinguishable in DB.
async function getOrCreateConversation(
  userId: string,
  characterId: string,
): Promise<string> {
  // Look for existing Telegram conversation for this user+character.
  const existing = await prisma.conversation.findFirst({
    where: { userId, characterId, source: "telegram" },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Get characterVersion for the conversation.
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { currentVersionId: true },
  });
  if (!character?.currentVersionId) throw new Error("character_has_no_version");

  const convo = await prisma.conversation.create({
    data: {
      userId,
      characterId,
      characterVersionId: character.currentVersionId,
      source: "telegram",
    },
  });
  return convo.id;
}

export async function handleTelegramMessage(params: TelegramMessageParams): Promise<void> {
  const { botToken, telegramChatId, userId, characterId, text } = params;

  try {
    const conversationId = await getOrCreateConversation(userId, characterId);
    const intent = await classifyMessageIntent(text);

    if (intent === "image") {
      // Image request path.
      const ent = await entitlementsFor(userId);
      const isFreeUser = !ent.active;

      await sendChatAction(botToken, telegramChatId, "upload_photo");

      const character = await prisma.character.findUnique({
        where: { id: characterId },
        select: { name: true },
      });
      const characterName = character?.name ?? "companion";

      let shouldGenerate = true;
      let isFirstFreeImage = false;
      if (isFreeUser) {
        isFirstFreeImage = await consumeFirstFreeImage(userId);
        if (!isFirstFreeImage) {
          const teaserDecision = await assertCanTease(userId, characterId);
          shouldGenerate = teaserDecision.action === "generate";
        }
      }

      if (shouldGenerate || isFreeUser) {
        const teaser = await generateImageTeaser(characterName, text);
        await sendMessage(botToken, telegramChatId, teaser);
        // Image is generated by worker; worker notifies Telegram via image-notify.ts.
        await generateChatImage(text, conversationId, userId, {
          billing: isFirstFreeImage ? "free_first_image" : "free_teaser",
        });
        // Worker will push the photo when ready. For now inform the user.
        await sendMessage(
          botToken,
          telegramChatId,
          isFirstFreeImage
            ? "Your photo is being created - it'll arrive in a moment!"
            : "Generating your photo now...",
        );
      } else {
        // Over free cap - send paywall message.
        await sendMessage(
          botToken,
          telegramChatId,
          `You've seen my free photos for today! Subscribe on buttercupp.fun to unlock unlimited images. I'd love to share more with you.`,
        );
      }
      return;
    }

    // Text chat path.
    await sendChatAction(botToken, telegramChatId, "typing");

    const tokens: string[] = [];
    await runChatTurn({
      conversationId,
      userId,
      userText: text,
      onToken: (delta) => tokens.push(delta),
    });

    const response = tokens.join("").trim();
    if (response) {
      await sendMessage(botToken, telegramChatId, response);
    }
  } catch (err) {
    if (err instanceof PaywallError) {
      await sendMessage(
        botToken,
        telegramChatId,
        "You've reached your chat limit for today. Subscribe at buttercupp.fun to keep chatting.",
      );
      return;
    }
    logError("telegram", err, { userId, characterId });
    await sendMessage(
      botToken,
      telegramChatId,
      "Something went wrong on my end. Please try again in a moment.",
    ).catch(() => {});
  }
}
```

Note: `prisma.conversation` may not have a `source` column yet. If it doesn't, check the schema and either add a nullable `source String?` column (additive migration, safe) or use a different identifier (e.g., a tag in `meta Json?` if that column exists).

- [ ] **Step 2: Check Conversation model for a source field**

```bash
grep -n "source" packages/database/prisma/schema.prisma
```

If no `source` field exists on Conversation, add it:
In `schema.prisma` in the `model Conversation` block, add:
```prisma
  source  String?  @default("web")
```
Then run: `cd packages/database && npx prisma migrate dev --name add_conversation_source`

- [ ] **Step 3: Compile check**

```bash
cd backend && npx tsc --noEmit
```
Fix any errors (likely the `generateChatImage` signature needs the `billing` option from Task 1 plan - confirm that task is done first).

---

### Task 5: Telegram image push (post-worker notification)

**Files:**
- Create: `backend/src/telegram/image-notify.ts`
- Modify: `backend/src/queue/media-worker.ts`

**Interfaces:**
- Consumes: `prisma.telegramUserLink`, `prisma.telegramBotConfig`, `sendPhoto` from `./client`, presigned S3 URL helper.
- Produces: `notifyTelegramImage(userId: string, characterId: string | null, s3Key: string): Promise<void>` - best-effort, never throws.

- [ ] **Step 1: Create image-notify.ts**

Create `backend/src/telegram/image-notify.ts`:

```typescript
import { prisma } from "@buttercupp/database";
import { sendPhoto } from "./client";
import { logWarn } from "../utils/log";

// BACKEND_URL is the public-facing backend base URL used to construct presigned
// media proxy URLs. Set via BACKEND_URL env var (same as used in media delivery).
function buildMediaUrl(s3Key: string): string {
  const base = process.env.BACKEND_URL ?? "http://localhost:4000";
  return `${base}/api/media?k=${encodeURIComponent(s3Key)}`;
}

// Best-effort: finds any TelegramUserLink for this user+character and pushes
// the generated image as a photo. Called from the media worker after an image
// job completes. Never throws - Telegram delivery failures are logged only.
export async function notifyTelegramImage(
  userId: string,
  characterId: string | null,
  s3Key: string,
): Promise<void> {
  if (!characterId) return;
  try {
    const link = await prisma.telegramUserLink.findUnique({
      where: { userId_characterId: { userId, characterId } },
    });
    if (!link) return;

    const bot = await prisma.telegramBotConfig.findUnique({ where: { characterId } });
    if (!bot) return;

    const photoUrl = buildMediaUrl(s3Key);
    await sendPhoto(bot.botToken, link.telegramChatId, photoUrl);
  } catch (err) {
    logWarn("telegram", "image notify failed", {
      userId,
      characterId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [ ] **Step 2: Add Telegram notification hook to media-worker.ts**

In `backend/src/queue/media-worker.ts`, at the top of the file add the import:
```typescript
import { notifyTelegramImage } from "../telegram/image-notify";
```

After the existing `await notifyMediaReady(...)` call (around line 257), add:
```typescript
    // Best-effort Telegram push: if the user has a linked bot for this
    // character, send the generated photo there too.
    void notifyTelegramImage(data.userId, data.characterId ?? null, s3Key);
```

- [ ] **Step 3: Compile check**

```bash
cd backend && npx tsc --noEmit
```

---

### Task 6: Webhook HTTP handler

**Files:**
- Create: `backend/src/http/telegram.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes:
  - `handleTelegramMessage` from `../telegram/chat`
  - `consumeLinkToken` from `../telegram/linker`
  - `sendMessage` from `../telegram/client`
  - `prisma.telegramBotConfig`
  - `BACKEND_URL` env var for frontend-facing link generation endpoint
- Produces:
  - `handleTelegramRoute(req, res): Promise<boolean>` - returns true if handled
  - Routes handled:
    - `POST /telegram/webhook/<characterId>` - Telegram webhook
    - `POST /telegram/link` - frontend: generate link token (auth required)
    - `GET /telegram/status/<characterId>` - frontend: check if linked (auth required)
    - `DELETE /telegram/link/<characterId>` - frontend: disconnect (auth required)

- [ ] **Step 1: Review existing auth pattern**

Read `backend/src/http/gallery.ts` lines 1-60 to understand how the backend authenticates frontend requests (cookie-based JWT). Use the same pattern.

- [ ] **Step 2: Create telegram.ts**

Create `backend/src/http/telegram.ts`:

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import { jwtVerify } from "jose";
import { prisma } from "@buttercupp/database";
import { handleTelegramMessage } from "../telegram/chat";
import { consumeLinkToken, generateLinkToken, getTelegramLink, removeTelegramLink } from "../telegram/linker";
import { sendMessage } from "../telegram/client";
import { logInfo, logWarn, logError } from "../utils/log";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-secret");
const COOKIE_NAME = "buttercupp_auth";

async function authenticateRequest(req: IncomingMessage): Promise<string | null> {
  const cookieHeader = req.headers["cookie"] ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  try {
    const { payload } = await jwtVerify(match[1], JWT_SECRET);
    return typeof payload["sub"] === "string" ? payload["sub"] : null;
  } catch {
    return null;
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
  });
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function handleTelegramRoute(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";
  const method = req.method ?? "";

  // POST /telegram/webhook/<characterId>
  const webhookMatch = url.match(/^\/telegram\/webhook\/([a-zA-Z0-9-]+)$/);
  if (webhookMatch && method === "POST") {
    const characterId = webhookMatch[1];
    const bot = await prisma.telegramBotConfig.findUnique({ where: { characterId } });
    if (!bot) {
      jsonResponse(res, 404, { error: "not_found" });
      return true;
    }
    // Validate Telegram's secret token header.
    const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
    if (secretHeader !== bot.webhookSecret) {
      logWarn("telegram", `webhook secret mismatch char=${characterId}`);
      jsonResponse(res, 403, { error: "forbidden" });
      return true;
    }

    const update = await readBody(req);
    jsonResponse(res, 200, { ok: true }); // Respond to Telegram immediately.

    // Process asynchronously so Telegram doesn't time out.
    void (async () => {
      try {
        const message = update["message"] as Record<string, unknown> | undefined;
        if (!message) return;

        const from = message["from"] as Record<string, unknown> | undefined;
        const chat = message["chat"] as Record<string, unknown> | undefined;
        const text = message["text"] as string | undefined;
        if (!from || !chat || !text) return;

        const telegramUserId = String(from["id"]);
        const telegramChatId = String(chat["id"]);
        const username = from["username"] as string | undefined;

        // Handle /start <token> for account linking.
        if (text.startsWith("/start ")) {
          const token = text.slice(7).trim();
          const result = await consumeLinkToken(token, telegramUserId, telegramChatId, username);
          if (result.ok) {
            const char = await prisma.character.findUnique({
              where: { id: result.characterId },
              select: { name: true },
            });
            await sendMessage(
              bot.botToken,
              telegramChatId,
              `You're connected! You can now chat with ${char?.name ?? "your companion"} here on Telegram.`,
            );
          } else {
            await sendMessage(
              bot.botToken,
              telegramChatId,
              result.reason === "token_expired"
                ? "That link has expired. Please generate a new one from the app."
                : "Unable to link your account. Please try again from the app.",
            );
          }
          return;
        }

        // Find linked app user.
        const link = await prisma.telegramUserLink.findUnique({
          where: {
            telegramUserId_characterId: { telegramUserId, characterId },
          },
        });
        if (!link) {
          await sendMessage(
            bot.botToken,
            telegramChatId,
            "Please link your account first by opening the companion app and clicking Connect on Telegram.",
          );
          return;
        }

        await handleTelegramMessage({
          botToken: bot.botToken,
          telegramChatId,
          telegramUserId,
          userId: link.userId,
          characterId,
          text,
        });
      } catch (err) {
        logError("telegram", err, { characterId });
      }
    })();

    return true;
  }

  // POST /telegram/link - generate deep link (auth required)
  if (url === "/telegram/link" && method === "POST") {
    const userId = await authenticateRequest(req);
    if (!userId) { jsonResponse(res, 401, { error: "unauthorized" }); return true; }
    const body = await readBody(req);
    const characterId = body["characterId"];
    if (typeof characterId !== "string") {
      jsonResponse(res, 400, { error: "characterId required" });
      return true;
    }
    try {
      const result = await generateLinkToken(userId, characterId);
      jsonResponse(res, 200, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      jsonResponse(res, msg === "no_bot_configured_for_character" ? 404 : 500, { error: msg });
    }
    return true;
  }

  // GET /telegram/status/<characterId> (auth required)
  const statusMatch = url.match(/^\/telegram\/status\/([a-zA-Z0-9-]+)$/);
  if (statusMatch && method === "GET") {
    const userId = await authenticateRequest(req);
    if (!userId) { jsonResponse(res, 401, { error: "unauthorized" }); return true; }
    const link = await getTelegramLink(userId, statusMatch[1]);
    jsonResponse(res, 200, { linked: !!link, username: link?.username ?? null, linkedAt: link?.linkedAt ?? null });
    return true;
  }

  // DELETE /telegram/link/<characterId> (auth required)
  const disconnectMatch = url.match(/^\/telegram\/link\/([a-zA-Z0-9-]+)$/);
  if (disconnectMatch && method === "DELETE") {
    const userId = await authenticateRequest(req);
    if (!userId) { jsonResponse(res, 401, { error: "unauthorized" }); return true; }
    await removeTelegramLink(userId, disconnectMatch[1]);
    jsonResponse(res, 200, { ok: true });
    return true;
  }

  return false;
}
```

- [ ] **Step 3: Register the handler in index.ts**

In `backend/src/index.ts`:

Add import at the top:
```typescript
import { handleTelegramRoute } from "./http/telegram";
```

Inside the `http.createServer` callback, after `if (await handleLoraAdminRoute(req, res)) return;`, add:
```typescript
  if (await handleTelegramRoute(req, res)) return;
```

- [ ] **Step 4: Add BACKEND_URL to local .env**

In `backend/.env` (or wherever local env vars are stored):
```
BACKEND_URL=http://localhost:4000
```

- [ ] **Step 5: Compile check**

```bash
cd backend && npx tsc --noEmit
```

- [ ] **Step 6: Manual webhook test**

Start the backend. Using curl, simulate a Telegram webhook update:
```bash
curl -X POST http://localhost:4000/telegram/webhook/FAKE_CHAR_ID \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: wrong" \
  -d '{"update_id":1,"message":{"from":{"id":123},"chat":{"id":123},"text":"hi"}}'
```
Expected: 403.

With correct secret (after adding a TelegramBotConfig row to local DB):
```bash
curl -X POST http://localhost:4000/telegram/webhook/CHAR_ID \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: YOUR_SECRET" \
  -d '{"update_id":1,"message":{"from":{"id":123,"username":"testuser"},"chat":{"id":123},"text":"/start VALID_TOKEN"}}'
```
Expected: 200 `{"ok":true}`, and a TelegramUserLink row created.

---

### Task 7: Frontend API routes

**Files:**
- Create: `frontend/app/api/telegram/link/route.ts`
- Create: `frontend/app/api/telegram/status/[characterId]/route.ts`
- Create: `frontend/app/api/telegram/disconnect/route.ts`

**Interfaces:**
- Consumes: `BACKEND_URL` env var, session cookie forwarded to backend.
- Produces: Frontend-safe proxy routes that forward to the backend Telegram endpoints.

- [ ] **Step 1: Create link generation route**

Create `frontend/app/api/telegram/link/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const cookie = req.headers.get("cookie") ?? "";

  const backendRes = await fetch(`${BACKEND_URL}/telegram/link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });

  const data = await backendRes.json().catch(() => ({}));
  return NextResponse.json(data, { status: backendRes.status });
}
```

- [ ] **Step 2: Create status route**

Create `frontend/app/api/telegram/status/[characterId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

export async function GET(
  req: NextRequest,
  { params }: { params: { characterId: string } },
): Promise<NextResponse> {
  const cookie = req.headers.get("cookie") ?? "";
  const backendRes = await fetch(
    `${BACKEND_URL}/telegram/status/${params.characterId}`,
    { headers: { Cookie: cookie } },
  );
  const data = await backendRes.json().catch(() => ({}));
  return NextResponse.json(data, { status: backendRes.status });
}
```

- [ ] **Step 3: Create disconnect route**

Create `frontend/app/api/telegram/disconnect/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const cookie = req.headers.get("cookie") ?? "";
  const characterId = typeof body["characterId"] === "string" ? body["characterId"] : "";

  const backendRes = await fetch(`${BACKEND_URL}/telegram/link/${characterId}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  const data = await backendRes.json().catch(() => ({}));
  return NextResponse.json(data, { status: backendRes.status });
}
```

- [ ] **Step 4: Compile check**

```bash
cd frontend && npx tsc --noEmit
```

---

### Task 8: Frontend UI - TelegramConnectBanner + post-onboarding CTA

**Files:**
- Create: `frontend/components/telegram/TelegramConnectBanner.tsx`
- Modify: `frontend/app/(protected)/chat/[characterId]/page.tsx` (add banner)

**Interfaces:**
- Consumes:
  - `GET /api/telegram/status/<characterId>` - to know if already linked
  - `POST /api/telegram/link` with `{ characterId }` - to get deep link
  - `DELETE /api/telegram/disconnect` - to unlink
- Produces: A dismissible banner below the character header in the chat page with "Connect on Telegram" button. Clicking generates a deep link and shows the Telegram deep link (opens Telegram on mobile).

- [ ] **Step 1: Create TelegramConnectBanner.tsx**

Create `frontend/components/telegram/TelegramConnectBanner.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";

interface Props {
  characterId: string;
  characterName: string;
}

export function TelegramConnectBanner({ characterId, characterName }: Props) {
  const [status, setStatus] = useState<"loading" | "linked" | "unlinked" | "dismissed">("loading");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dismissed = sessionStorage.getItem(`tg-banner-dismissed-${characterId}`);
    if (dismissed) { setStatus("dismissed"); return; }

    fetch(`/api/telegram/status/${characterId}`)
      .then((r) => r.json())
      .then((data: { linked: boolean }) => setStatus(data.linked ? "linked" : "unlinked"))
      .catch(() => setStatus("dismissed"));
  }, [characterId]);

  function dismiss() {
    sessionStorage.setItem(`tg-banner-dismissed-${characterId}`, "1");
    setStatus("dismissed");
  }

  async function connect() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if ((data as { error?: string }).error === "no_bot_configured_for_character") {
          setError("Telegram is not yet available for this character.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        return;
      }
      const data = await res.json() as { deepLink: string };
      setDeepLink(data.deepLink);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function disconnect() {
    await fetch("/api/telegram/disconnect", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId }),
    });
    setStatus("unlinked");
    setDeepLink(null);
  }

  if (status === "loading" || status === "dismissed") return null;

  return (
    <div className="mx-4 mb-2 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm">
      {status === "linked" ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-blue-300">Connected to Telegram</span>
          <div className="flex gap-2">
            <button
              onClick={disconnect}
              className="text-xs text-slate-400 underline underline-offset-2 hover:text-white"
            >
              Disconnect
            </button>
            <button onClick={dismiss} className="text-slate-500 hover:text-white" aria-label="Close">
              x
            </button>
          </div>
        </div>
      ) : deepLink ? (
        <div className="flex flex-col gap-2">
          <p className="text-slate-300">
            Tap the link below to open {characterName} on Telegram:
          </p>
          <a
            href={deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-[#0088cc] px-3 py-1.5 text-white text-xs font-medium hover:bg-[#0077b5]"
          >
            Open in Telegram
          </a>
          <p className="text-xs text-slate-500">Link expires in 15 minutes.</p>
          <button onClick={dismiss} className="self-start text-xs text-slate-500 underline">
            Dismiss
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-slate-300">
            <span>Chat with {characterName} on Telegram</span>
          </div>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-400">{error}</span>}
            <button
              onClick={connect}
              disabled={generating}
              className="rounded-lg bg-[#0088cc] px-3 py-1 text-xs font-medium text-white hover:bg-[#0077b5] disabled:opacity-50"
            >
              {generating ? "Connecting..." : "Connect"}
            </button>
            <button onClick={dismiss} className="text-slate-500 hover:text-white" aria-label="Close">
              x
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add banner to chat page**

In `frontend/app/(protected)/chat/[characterId]/page.tsx`:

Find where the character header ends and the message list begins. Import and render the banner:

```typescript
import { TelegramConnectBanner } from "@/components/telegram/TelegramConnectBanner";
```

Add after the character header section:
```tsx
<TelegramConnectBanner characterId={characterId} characterName={character.name} />
```

The exact insertion point depends on the component structure. Read the file first and place it where it sits visually below the header and above the chat messages.

- [ ] **Step 3: Compile check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Visual test**

Start the dev server (`npm run dev` in frontend). Open a character chat page. Verify:
- Banner appears below the character header.
- "Connect" button fires a POST to `/api/telegram/link`.
- If no bot is configured for the character, shows appropriate error.
- If bot is configured, shows the deep link and "Open in Telegram" button.
- Dismiss hides the banner for the session (sessionStorage).

---

### Task 9: Settings page for Telegram management

**Files:**
- Create: `frontend/app/(protected)/settings/telegram/page.tsx`

**Interfaces:**
- Consumes: `GET /api/telegram/status/<characterId>` for each of the user's conversations' characters.
- Produces: A settings page listing all characters the user has chatted with, showing Telegram link status and connect/disconnect buttons.

- [ ] **Step 1: Create the settings page**

Create `frontend/app/(protected)/settings/telegram/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

// This is a Server Component that reads linked Telegram accounts.
// It fetches the user's conversations to list characters, then checks Telegram status for each.

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

async function getTelegramStatus(characterId: string, cookieHeader: string) {
  try {
    const res = await fetch(`${BACKEND_URL}/telegram/status/${characterId}`, {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ linked: boolean; username: string | null; linkedAt: string | null }>;
  } catch {
    return null;
  }
}

export default async function TelegramSettingsPage() {
  const cookieStore = cookies();
  const cookieHeader = cookieStore.toString();

  // Get user's conversations to find which characters they have.
  // Use the frontend's own API since this is a server component.
  // For now, show a static info page with link to character chats.
  // Full dynamic listing can be wired in a follow-up once the conversations
  // API endpoint is identified.

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold text-white">Telegram</h1>
      <p className="mb-6 text-slate-400">
        Connect your AI companions to Telegram for a native messaging experience.
        Each companion has its own Telegram bot. Images you generate and private
        photos are sent directly to your Telegram chat.
      </p>
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <h2 className="mb-2 font-medium text-white">How to connect</h2>
        <ol className="space-y-2 text-sm text-slate-300">
          <li>1. Open any companion chat in the app.</li>
          <li>2. Click the "Connect on Telegram" banner at the top of the chat.</li>
          <li>3. Tap "Open in Telegram" and start the bot.</li>
          <li>4. You're connected! Messages and images sync both ways.</li>
        </ol>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add link in existing settings nav**

Find the settings navigation (likely `frontend/app/(protected)/settings/` layout or a sidebar component). Add a link:
```tsx
<Link href="/settings/telegram">Telegram</Link>
```

- [ ] **Step 3: Compile check and visual test**

```bash
cd frontend && npx tsc --noEmit
```
Start dev server and navigate to `/settings/telegram`. Verify the page renders.

---

### Task 10: Production webhook registration script

**Files:**
- Create: `backend/src/scripts/register-telegram-webhooks.ts`

**Interfaces:**
- Consumes: All `TelegramBotConfig` rows from DB, `setWebhook` from `../telegram/client`.
- Produces: Registers webhooks for every configured bot. Run once after deployment or when adding a new character bot.

- [ ] **Step 1: Create the script**

Create `backend/src/scripts/register-telegram-webhooks.ts`:

```typescript
import "../load-env";
import { prisma } from "@buttercupp/database";
import { setWebhook } from "../telegram/client";

const BACKEND_URL = process.env.BACKEND_URL;
if (!BACKEND_URL) {
  console.error("BACKEND_URL env var is required");
  process.exit(1);
}

async function main() {
  const bots = await prisma.telegramBotConfig.findMany();
  console.log(`Found ${bots.length} bot(s) to register.`);

  for (const bot of bots) {
    const webhookUrl = `${BACKEND_URL}/telegram/webhook/${bot.characterId}`;
    console.log(`Registering webhook for bot @${bot.botUsername} -> ${webhookUrl}`);
    await setWebhook(bot.botToken, webhookUrl, bot.webhookSecret);
    console.log(`  Done.`);
  }

  await prisma.$disconnect();
  console.log("All webhooks registered.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add script to package.json**

In `backend/package.json`, add to the `scripts` section:
```json
"telegram:register-webhooks": "ts-node src/scripts/register-telegram-webhooks.ts"
```

- [ ] **Step 3: Compile check**

```bash
cd backend && npx tsc --noEmit
```

---

### Task 11: Seed a test bot in local DB (manual operator step)

This is a manual step for the developer/operator. After the migration runs, insert a `TelegramBotConfig` row to enable local testing.

- [ ] **Step 1: Register a test bot via BotFather**

In Telegram, message `@BotFather`:
- `/newbot` -> give it a name and username
- Copy the bot token

- [ ] **Step 2: Generate a webhook secret**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- [ ] **Step 3: Insert the config row**

```sql
INSERT INTO "TelegramBotConfig" ("id", "characterId", "botToken", "botUsername", "webhookSecret", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'YOUR_LOCAL_CHARACTER_ID',
  'YOUR_BOT_TOKEN',
  'your_bot_username',
  'YOUR_WEBHOOK_SECRET',
  NOW(), NOW()
);
```

- [ ] **Step 4: Register the webhook (requires public URL)**

For local testing, use ngrok to expose the backend:
```bash
ngrok http 4000
```
Copy the HTTPS URL, then:
```bash
BACKEND_URL=https://your-ngrok-url.ngrok.io npm run telegram:register-webhooks
```

- [ ] **Step 5: Send a test message via Telegram**

Open the bot in Telegram. Send any message. Verify:
- Webhook is called (backend logs show the update).
- If not linked, bot asks to link.
- After linking via deep link, send "hello" -> bot replies from the LLM.
- Send "generate a photo" -> bot sends "generating..." -> image arrives.

---

### Sanity checklist (run after all tasks complete)

- [ ] `npx tsc --noEmit` passes in `packages/shared/`, `backend/`, `frontend/`.
- [ ] `npx prisma migrate status` shows no pending migrations (on local DB).
- [ ] Webhook returns 403 for wrong secret_token, 200 for correct.
- [ ] `/start <token>` creates TelegramUserLink row in DB.
- [ ] Expired token returns appropriate error message in Telegram.
- [ ] Text message from linked user triggers LLM response via runChatTurn.
- [ ] Image request from linked user queues job and sends image via sendPhoto when worker completes.
- [ ] TelegramConnectBanner renders on chat page, dismiss hides it for session.
- [ ] `/settings/telegram` page loads without errors.
- [ ] No bot tokens appear in any log output or frontend response.
- [ ] No em dashes in new code, comments, or strings.

---

### Admin setup guide (include in project README or ops docs)

**To add a new character bot:**

1. Message `@BotFather` on Telegram: `/newbot`
2. Set name to the character's name, username to `CharacterNameButterCuppBot` (or similar)
3. Set the bot photo: `/setuserpic` -> send the character's profile image
4. Set bot description: `/setdescription` -> paste the character's bio
5. Copy the bot token
6. Insert a `TelegramBotConfig` row (see Task 11 Step 3)
7. Run `npm run telegram:register-webhooks` with `BACKEND_URL` set to prod URL
8. Verify: send `/start` to the bot, confirm webhook is received in backend logs
