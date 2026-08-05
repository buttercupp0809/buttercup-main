# ButterCupp deploy runbook

> **STOP AND GET APPROVAL** is required before every step. This runbook is intentionally manual. Cursor does not execute any of these commands. A previous approval never carries to the next action.

The full deploy is: **migrate DB -> build + push image -> update ECS -> trigger Amplify build -> smoke check**. Each stage has its own approval banner.

---

## 0. Preflight (safe to run any time)

Local sanity, no non-local mutations:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run check:no-em-dash
docker build -t buttercupp:local .
docker compose up --build -d
curl -sf http://localhost:4000/healthz
```

All of the above must be green before proceeding.

---

## 1. Database migration

> **STOP AND GET APPROVAL.** Do not run this against RDS without a fresh, explicit human confirmation. Prior approval does not carry forward.

```bash
# Set the RDS pooled URL for the target environment.
export DATABASE_URL="postgresql://USER:PASS@RDS_HOST:5432/buttercupp?schema=public&pgbouncer=true&connect_timeout=15"
# Verify the target explicitly.
psql "$DATABASE_URL" -c 'SELECT current_database(), inet_server_addr();'
# Then apply.
cd packages/database
npx prisma migrate deploy
```

If a migration adds an HNSW/vector operation or a schema-altering change, a second human read of the SQL is required.

---

## 2. Build + push image to ECR

> **STOP AND GET APPROVAL** for both the build (safe) and the push (mutates the registry). Approval for the build does not authorize the push.

```bash
# Login (safe).
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ACCT_ID.dkr.ecr.$REGION.amazonaws.com"

# Build (safe).
docker build -t "buttercupp:$(git rev-parse --short HEAD)" .

# ---- STOP FOR SECOND APPROVAL BEFORE THE PUSH ----

docker tag  "buttercupp:$(git rev-parse --short HEAD)" "$ACCT_ID.dkr.ecr.$REGION.amazonaws.com/buttercupp:$(git rev-parse --short HEAD)"
docker push "$ACCT_ID.dkr.ecr.$REGION.amazonaws.com/buttercupp:$(git rev-parse --short HEAD)"
```

---

## 3. Update ECS services

> **STOP AND GET APPROVAL.** Rolling deploy against production. Confirm the image tag and the target cluster explicitly.

```bash
# Register updated task defs (both).
aws ecs register-task-definition --cli-input-json file://infra/ecs/task-api.json
aws ecs register-task-definition --cli-input-json file://infra/ecs/task-worker.json

# Roll the services.
aws ecs update-service --cluster buttercupp-prod --service buttercupp-api    --force-new-deployment
aws ecs update-service --cluster buttercupp-prod --service buttercupp-worker --force-new-deployment

# Watch the rollout; abort if circuit breaker trips.
aws ecs wait services-stable --cluster buttercupp-prod --services buttercupp-api buttercupp-worker
```

---

## 4. Trigger the Amplify build

> **STOP AND GET APPROVAL.** Frontend deploy runs SSR against the ECS backend. Roll backend first (step 3) so an old frontend against a new backend is impossible.

```bash
aws amplify start-job \
  --app-id "$AMPLIFY_APP_ID" \
  --branch-name "main" \
  --job-type RELEASE
```

Watch the job in the Amplify console; do not close the tab until it is green.

---

## 5. Smoke check

```bash
# Backend health.
curl -sf https://api.buttercupp.app/healthz | jq

# WebSocket handshake (needs wscat or a small script).
wscat -c "wss://api.buttercupp.app/ws" -H "Cookie: buttercupp_auth=$JWT"
# expect: connection stays open, ping/pong flows.

# Frontend.
curl -sfI https://buttercupp.app/ | grep -iE "strict-transport|content-security"
```

If any of these fail, halt and get a fresh approval before touching anything.

---

## Rollback

```bash
# Roll the ECS service back to the previous task-def revision.
aws ecs update-service --cluster buttercupp-prod --service buttercupp-api \
  --task-definition buttercupp-api:PREVIOUS_REVISION --force-new-deployment
aws ecs update-service --cluster buttercupp-prod --service buttercupp-worker \
  --task-definition buttercupp-worker:PREVIOUS_REVISION --force-new-deployment

# For Amplify, redeploy the last known-good commit.
aws amplify start-job --app-id "$AMPLIFY_APP_ID" --branch-name main \
  --job-type RELEASE --commit-id "$LAST_GOOD_SHA"
```

Migrations are forward-only; a rolled-back service against a migrated DB must still be schema-compatible. The Phase 05 migration (vector 384) and the Phase 10 migration (billing tables) are additive and safe under rollback.
