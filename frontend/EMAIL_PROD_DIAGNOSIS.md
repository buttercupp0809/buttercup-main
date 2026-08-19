# Prod transactional email: diagnosis

Transactional email (signup verification, password reset, verify-email resend)
goes through `frontend/lib/email.ts` -> Resend. When it fails in production it
fails silently to the user, so this doc explains how to tell which of the two
likely causes you are hitting and how to fix each.

## The two likely causes

1. **`RESEND_API_KEY` / `EMAIL_FROM` were NOT set in the Amplify console at the last BUILD**, so they baked as null into `.next/server-env.json` and the runtime falls into the no-key branch (in prod that now logs an error and sends nothing).
2. **They ARE set but the `EMAIL_FROM` domain is not verified in Resend**, so Resend rejects the send and the error is logged but the signup/reset route swallows it in a `catch {}`.

## Discriminator: hit the debug route

Open `https://<prod-domain>/api/debug` and read the `env` object:

- `env.RESEND_API_KEY` -> `"SET"` or `"MISSING"`
- `env.EMAIL_FROM` -> the actual configured value, or `"MISSING"` (EMAIL_FROM is not a secret, so its value is shown on purpose)

### If `RESEND_API_KEY` is `MISSING` -> Cause 1

The key never made it into the runtime bundle.

- Set BOTH `RESEND_API_KEY` and `EMAIL_FROM` in the Amplify console for the deployed branch.
- Then trigger a **REBUILD / redeploy**. Setting the console vars alone will NOT fix it: they are only read at BUILD time, when `amplify.yml` bakes chosen keys from `process.env` into `.next/server-env.json`, which `frontend/instrumentation.ts` `register()` loads back into `process.env` at runtime. No rebuild means no re-bake.
- Note: `frontend/.env` is NOT read in prod. Do not rely on it for production values.

### If `RESEND_API_KEY` is `SET` -> Cause 2

The key is present, so Resend is being called and rejecting the send.

- Check CloudWatch logs for the SSR compute for the line `"[email] resend send failed"` and read its `errMessage` (for example `"domain is not verified"` or `"from address invalid"`). That log line also carries `status`, `requestId`, `errName`, and `fromConfigured` (the exact `EMAIL_FROM` in use).
- Fix by verifying the `EMAIL_FROM` domain in the Resend dashboard: add the SPF / DKIM / return-path DNS records Resend provides for that domain. OR set `EMAIL_FROM` to an already-verified sender (for example `onboarding@resend.dev`) for a quick test, then rebuild.

## Why failures are invisible to users

All downstream callers swallow email errors by design, so a failed send never
blocks or notifies the user:

- `app/api/auth/signup/route.ts` (verification email) wraps the send in `try { ... } catch {}`.
- `app/api/auth/forgot-password/route.ts` returns the same generic response whether or not the send succeeds.
- `app/api/auth/verify-email/resend/route.ts` uses `.catch(() => null)`.

Because of this, **CloudWatch logs and the `/api/debug` route are the only
signals** that email is broken. (The email code now returns `{ ok: false }` and
logs `console.error` in production when the key is missing, so the failure is at
least loud in the logs even though callers still ignore the return value.)

## Note on actions

The coordinator will NOT deploy or change any console/env value. Setting Amplify
env vars, triggering the rebuild, and verifying the Resend domain are all
actions for a human to run.
