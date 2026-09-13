# Email nurture pipeline (Brevo, poppy-admin, cron)

Date: 2026-09-10
Status: Approved design, pending implementation plan.

## Goal

A database-driven lifecycle email system that nudges users through four states
toward onboarding, first chat, re-engagement, and continued engagement after
payment. Each email uses the existing character-photo-with-gradient-overlay
template. Sending moves off Resend (100/day ceiling too low) to Brevo
(300/day free). Runs from the poppy-admin repo on a daily cron.

## Decisions (locked with product owner)

1. Provider = Brevo (Sendinblue). 300 emails/day free, API-key drop-in.
2. Home = poppy-admin, reusing the existing nudge-email scripts, templates,
   S3 image resolution, and `CRON_SECRET`.
3. Add a real unsubscribe path plus suppression (CAN-SPAM / GDPR).
4. Segment 1 cadence = 5 emails total, one every ~2 days (a ~10-day drip).
5. Segment 3 lapsed threshold = `lastMessageAt` older than 2 days (tunable).
6. Provider split: Brevo carries nurture/bulk; Resend stays for existing
   low-volume transactional (signup verify). Blast radius minimized.

## Current-state facts this design depends on

- Lifecycle state in `packages/database/prisma/schema.prisma`:
  - `User.completedOnboardingAt` (null = onboarding not finished).
  - `Conversation.messageCount` and `Conversation.lastMessageAt` per
    (userId, characterId). "Has chatted" = any conversation with
    `messageCount > 0`. "Last activity" = `MAX(lastMessageAt)`.
  - Paid = `User.subscriptionTier != free` (and/or active `Subscription`).
  - `User.email`, `User.emailVerifiedAt`, `User.createdAt`.
  - No unsubscribe field today; no email-send log today.
- Proven overlay template + throttle live in
  `poppy-admin/scripts/nudge-email.ts` and `nudge-email-onboarding.ts`
  (CSS background-image + gradient overlay, presigned S3 char image, CID logo,
  1.1s spacing between sends, Resend campaign tags).
- Email sender wrappers: `poppy-admin/lib/email.ts` (Resend + `emailShell`).
- `poppy-admin` has a `CRON_SECRET` pattern for protected scheduled endpoints.

## Architecture

A single daily orchestrator run. Per segment it: queries eligible users,
applies suppression and cadence caps, renders the overlay email, sends via
Brevo, and writes an `EmailSendLog` row. A global daily ceiling protects the
Brevo quota and domain reputation.

## Segments (mutually exclusive, evaluated in order)

| # | Audience | Message | Cadence / suppression |
|---|----------|---------|-----------------------|
| 1 | `completedOnboardingAt IS NULL` | Finish onboarding; photo + overlay | Up to 5 emails, one every ~2 days, then stop |
| 2 | onboarded, no `Conversation` with `messageCount > 0` | Short 1-2 line nudge to start chatting | Every ~2 days, cap 5 |
| 3 | has chatted, `MAX(lastMessageAt)` older than 2 days | Crisp win-back + payment nudge | Daily; suppress if chatted in last 24h |
| 4 | paid / active subscription | Warm "I am here, we can talk all day and night" (never the word "unlimited") | 24h check; suppress if chatted in last 24h |

Cross-cutting exclusions for every segment:

- `unsubscribedAt IS NOT NULL` excluded.
- Missing or unverified email excluded.
- Segments 1-3 exclude paid users (they belong to segment 4).

## Data model (new)

- `EmailSendLog`:
  `{ id, userId, segment, campaign, provider, providerMessageId, sentAt,
     status }`
  with an index supporting per-(userId, segment, day) idempotency lookups and
  cadence math. Powers: no double-send per day, the "5 max & every-2-days"
  cadence for segments 1-2, the 24h/N-day suppression joins, and basic
  analytics.
- `User.unsubscribedAt DateTime?` plus `User.unsubscribeToken String?`
  (signed, per-user, minted lazily) for one-click unsubscribe.

## Components (poppy-admin)

- `lib/brevo.ts`: Brevo transactional-email client. `sendEmail({ to, subject,
  html, text, headers })` shape mirroring the Resend wrapper so callers are
  provider-agnostic. Reads `BREVO_API_KEY`, `EMAIL_FROM`.
- `lib/nurture/segments.ts`: the four segment queries as pure, testable
  functions returning eligible `{ userId, email, characterId? }` batches.
- `lib/nurture/copy.ts`: four copy sets (short and crisp per spec) with
  character-voice interpolation; the overlay HTML is extracted from the
  existing scripts into a shared `renderOverlayEmail()`.
- `lib/nurture/orchestrator.ts`: runs all segments, applies caps/suppression
  via `EmailSendLog`, batches under the daily ceiling (<= 250/day, 1.1s
  spacing reusing the existing throttle), writes logs, returns a summary.
- `app/api/cron/nurture/route.ts`: `CRON_SECRET`-guarded endpoint that invokes
  the orchestrator. Supports `?dryRun=1` (log intended recipients, send
  nothing) and `?segment=N` (run one segment) for safe rollout.
- `app/api/unsubscribe/route.ts`: verifies token, sets `unsubscribedAt`,
  renders a friendly confirmation. Nurture sends include a `List-Unsubscribe`
  header and a visible unsubscribe link.

## Scheduling

The cron endpoint is scheduler-agnostic. The live daily trigger is a
deploy-time choice: AWS EventBridge Scheduler hitting the HTTPS endpoint
(recommended, matches the AWS stack) or a scheduled GitHub Action that curls
the endpoint with `CRON_SECRET`. The code ships dormant; wiring the live
schedule is a separate, explicitly-approved deploy step.

## Idempotency and safety

- Every send guarded by an `EmailSendLog` check on (segment, userId, day) so a
  double cron-fire cannot double-send.
- `dryRun` mode logs intended recipients without sending.
- Global daily ceiling caps total sends to protect the Brevo quota and domain
  reputation.
- Per-segment caps enforced from `EmailSendLog` history (5 max for segments
  1-2; every-2-days spacing).

## Env / secrets

- New: `BREVO_API_KEY` in poppy-admin env. `EMAIL_FROM` reused.
- `CRON_SECRET` reused for the cron endpoint.
- Secrets are set at deploy time by the owner, not committed.

## Testing

- Unit (seeded DB): each segment query returns the right cohort for
  not-onboarded, onboarded-no-chat, lapsed (>2d), paid-active, and
  chatted-in-24h (suppressed); cadence caps (5 max, every-2-days); unsubscribe
  suppression; paid excluded from segments 1-3.
- Integration: orchestrator `dryRun` emits the correct recipients per segment,
  respects caps and the daily ceiling, and writes `EmailSendLog` rows.
- Brevo client test with the HTTP call mocked (correct payload, auth header,
  error handling).

## Files touched / added

- `packages/database/prisma/schema.prisma` (EmailSendLog, User.unsubscribedAt,
  User.unsubscribeToken) + migration against a LOCAL db only.
- `poppy-admin/lib/brevo.ts` (new)
- `poppy-admin/lib/nurture/segments.ts` (new)
- `poppy-admin/lib/nurture/copy.ts` (new)
- `poppy-admin/lib/nurture/orchestrator.ts` (new)
- `poppy-admin/app/api/cron/nurture/route.ts` (new)
- `poppy-admin/app/api/unsubscribe/route.ts` (new)
- shared `renderOverlayEmail()` extracted from the existing nudge scripts.

## Out of scope

- Moving existing transactional email off Resend.
- An admin analytics dashboard for campaigns (logs suffice for v1).
- Live scheduler wiring (separate approved deploy step).
