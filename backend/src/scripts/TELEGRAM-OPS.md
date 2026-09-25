# Telegram Bot Provisioning Ops Guide

## Section 1: Overview

The platform has 140+ AI companion characters, each requiring a dedicated Telegram bot. Key constraints and design decisions:

- BotFather rate-limits to approximately 20 bot creations per day per Telegram account.
- The process is split into two phases:
  - Phase 1: Create bots via BotFather automation (gramjs/MTProto). This is rate-limited and takes 7-8 days for 140+ bots with a single account, or fewer days with multiple accounts.
  - Phase 2: Provision all created bots via the Bot API (set webhooks, bot name, bio, profile photo, commands, write DB rows). Phase 2 is instant and fully automated, and safe to re-run at any time.

---

## Section 2: Prerequisites

You need Telegram API credentials (these are NOT bot tokens; they are your Telegram user account credentials for the MTProto layer).

**Getting API credentials:**
1. Go to https://my.telegram.org
2. Click "API development tools"
3. Create an app (name and description are for your reference only)
4. Note the `App api_id` (an integer) and `App api_hash` (a hex string)

**Add these to the root `.env` file:**

```
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890
TELEGRAM_PHONE=+1234567890
TELEGRAM_SESSION=  # leave empty for first run; script prints the session string to paste here
BACKEND_URL=https://api.buttercupp.fun
```

`TELEGRAM_SESSION` is a serialized MTProto session string that persists your login across runs so you are not prompted for an OTP every time. Leave it empty on the very first run.

---

## Section 3: Step-by-step Procedure

### Step 1: First-time Session Setup

```bash
cd backend
TELEGRAM_SESSION="" npm run telegram:create-bots -- --dry-run --limit 1
# On first run, the script will prompt: enter your phone OTP from Telegram.
# After auth, it prints: "Save this session string to TELEGRAM_SESSION: <string>"
# Copy that string and paste it into .env:
#   TELEGRAM_SESSION=<string>
# Subsequent runs skip the OTP prompt entirely.
```

### Step 2: Create Bots in Daily Batches (~20/day)

```bash
# Day 1 (creates bots for characters 1-20):
npm run telegram:create-bots -- --limit 20 --output bots-created.json

# Day 2 (appends to the same file, picks up characters 21-40):
npm run telegram:create-bots -- --limit 20 --output bots-created.json

# Continue until all characters have bots (~7-8 days for 140+).
# To go faster using multiple phone numbers, prefix the env vars:
#   TELEGRAM_PHONE=+1xxxxxxxxxx TELEGRAM_SESSION=xxx npm run telegram:create-bots ...
```

### Step 3: Check Progress

```bash
npm run telegram:status
```

This shows how many characters have bots created, how many are provisioned, and which are still pending.

### Step 4: Provision All Created Bots (idempotent, run anytime)

```bash
npm run telegram:provision -- --input bots-created.json
# Sets: webhook, bot name, bio, profile photo, commands, and DB rows.
# Safe to re-run. Already-configured items are skipped.
```

### Step 5: Register Webhooks After Any Backend URL Change

```bash
BACKEND_URL=https://api.buttercupp.fun npm run telegram:register-webhooks
```

---

## Section 4: Alternative: Manual Token Entry (No gramjs Required)

If you prefer not to set up gramjs/MTProto credentials, you can create bots manually in BotFather and import the tokens:

### Step A: Generate the template

```bash
cd backend
npm run telegram:generate-template -- --output tokens.json
# Creates tokens.json with all unconfigured characters + suggested bot usernames.
# Also prints the BotFather step-by-step guide.
```

### Step B: Fill in tokens

Open `tokens.json`. For each character:
1. Open @BotFather in Telegram, send `/newbot`
2. Enter the character name and one of the `suggestedUsernames`
3. Copy the token BotFather returns into `botToken`
4. Set `botUsername` to the accepted username

### Step C: Register all filled entries

```bash
npm run telegram:bulk-register -- --input tokens.json
# Validates tokens, upserts TelegramBotConfig in DB, registers webhooks,
# sets bot name, commands, short description, and profile photo.
# Entries with empty botToken are skipped automatically.
# Safe to re-run (skips already-configured bots unless --force).
```

### Step D: Check progress

```bash
npm run telegram:status
```

This flow and the gramjs flow (Section 3) are interchangeable - both produce the same DB state and Bot API configuration.

---

## Section 5: Accelerating Past the Rate Limit

The ~20/day cap is per Telegram account (phone number). Options to go faster:

**Option A: Multiple phone numbers**

Run from two or three separate accounts in parallel (different terminals or machines):

```bash
# On machine A (account with phone +1xxx):
TELEGRAM_PHONE=+1xxx TELEGRAM_SESSION=xxx npm run telegram:create-bots -- --limit 20 --output bots-a.json

# On machine B (account with phone +44xxx):
TELEGRAM_PHONE=+44xxx TELEGRAM_SESSION=yyy npm run telegram:create-bots -- --limit 20 --output bots-b.json
```

After both finish, merge the two output JSON files and run a single provision pass:

```bash
# Merge bots-a.json and bots-b.json into one file, then:
npm run telegram:provision -- --input bots-merged.json
```

**Option B: 2 accounts x 20/day = 40/day**, cutting the total time to 3-4 days for 140+ bots.

---

## Section 6: Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `FloodWait X seconds` | Hit BotFather rate limit for the day | Script stops gracefully; wait until tomorrow and re-run |
| `Sorry, this username is already taken` | Bot username conflict with an existing Telegram bot | Script auto-retries with a numeric suffix; if all variants fail, manually edit the character slug |
| `TELEGRAM_SESSION is invalid` | Session string expired or belongs to a different phone | Delete `TELEGRAM_SESSION` value from `.env` and re-authenticate (Step 1) |
| Bot photo not set | S3/CloudFront not accessible from local dev environment | Pass `--skip-photo` when running locally; photo can be set with a separate provision run from CI/prod |
| `BACKEND_URL not set` | Missing env var | Set in `.env` or prefix the command: `BACKEND_URL=https://... npm run telegram:provision` |
| OTP prompt on every run | `TELEGRAM_SESSION` is empty or missing | Complete Step 1 and save the session string to `.env` |

---

## Section 7: Production DB Migration

The three Telegram tables (`TelegramBot`, `TelegramWebhook`, `TelegramBotConfig` or equivalent) were added via a manual migration rather than `prisma migrate dev`. Before running `telegram:provision` against the production database for the first time, mark the migration as applied so Prisma's migration history stays consistent:

```bash
# Apply the migration on prod DB (only needed once, before first prod provision run):
DATABASE_URL=<prod_url> npx prisma migrate resolve --applied 20260921000000_add_telegram_tables
```

If the migration was already applied directly (via `psql` or `db push`), the command above marks it as resolved in Prisma's `_prisma_migrations` table without re-running the DDL.

After that, `telegram:provision` can write DB rows safely without migration conflicts.
