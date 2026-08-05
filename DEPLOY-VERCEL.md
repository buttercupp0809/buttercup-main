# Deploying the frontend to Vercel (interim)

This hosts the **Next.js frontend only**. The backend service (WS gateway on
:4000 + BullMQ media worker) stays wherever you run it (local for now). We move
everything to AWS later; `amplify.yml` and `Dockerfile` are left in place for
that and are not touched by this setup.

## What works on Vercel vs what needs the backend

| Surface | Works frontend-only? | Needs |
|---|---|---|
| Marketing site, footer, legal pages | Yes | nothing |
| Signup / login / logout, password reset | Yes | a reachable Postgres (`DATABASE_URL`) |
| Dashboard, Discover, Create wizard (UI) | Yes | Postgres |
| Billing page (plan tiles render; checkout) | Partial | backend `/billing/*` on `NEXT_PUBLIC_BACKEND_URL` |
| Live chat streaming, image/video, voice | No | backend service on :4000 (WS + SSE proxy) |

Notes:
- **Build is DB-free.** Prisma connects lazily, so `next build` succeeds with no
  database. Only rendering authenticated pages at runtime needs `DATABASE_URL`.
- The Prisma client already detects `process.env.VERCEL` and switches to the
  serverless pg-adapter path (single-connection pool). No code change needed.
- A **localhost backend is only reachable from your own machine's browser.** For
  chat to work on the deployed URL for other people, the backend must be
  publicly reachable (a tunnel like `cloudflared`, or the future AWS backend).

## One-time Vercel project setup

1. Import the repo in Vercel.
2. **Root Directory = `frontend`** (Project Settings > General). Vercel detects
   the npm workspace and `frontend/vercel.json` supplies the install/build
   commands (build `@buttercupp/shared` + `@buttercupp/database`, then `next build`).
3. Framework preset: **Next.js** (auto-detected).
4. Leave Build/Install command overrides blank in the dashboard; `vercel.json`
   wins.

## Environment variables (Vercel > Settings > Environment Variables)

Required for the app to render authed pages:

```
DATABASE_URL   = postgresql://USER:PASS@HOST/db?sslmode=require   # a CLOUD Postgres, not localhost
JWT_SECRET     = <same secret the backend uses to sign/verify cookies>
```

Point the browser at the backend (only reachable clients get live features):

```
NEXT_PUBLIC_APP_URL     = https://<your-vercel-domain>
NEXT_PUBLIC_BACKEND_URL = http://localhost:4000     # your local backend (works from your machine only)
NEXT_PUBLIC_WS_URL      = ws://localhost:4000        # or a cloudflared https/wss URL for public access
BACKEND_URL             = http://localhost:4000      # used by the SSE proxy route (server-side)
```

Optional (leave blank until wired): `GOOGLE_CLIENT_ID`, `RESEND_API_KEY`,
`EMAIL_FROM`, `CLOUDFRONT_URL`, `NEXT_PUBLIC_SENTRY_DSN`.

### About the database
Vercel serverless cannot reach a `localhost` Postgres. For the deployed site to
do auth/signup you need a cloud Postgres reachable from Vercel (Neon free tier
works well and is the least-effort option; a Neon MCP is already configured in
this workspace). Until then, only the fully-static marketing pages render for
external visitors. Run `npm run db:push` against that database once to create
the schema.

## Deploy

CLI:
```bash
npx vercel            # first run links the project; pick Root Directory = frontend
npx vercel --prod     # production deploy
```
Or push to the connected Git branch and Vercel builds automatically.

## When we move to AWS
Nothing here blocks that. Delete the Vercel project (or keep it as a preview),
set the same env vars in Amplify, and deploy via `amplify.yml` (frontend) plus
the ECS/Fargate backend. The app code is host-agnostic; only env values change.
