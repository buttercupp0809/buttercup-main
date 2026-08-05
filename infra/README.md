# Poppy AWS infrastructure notes

This directory documents the target AWS shape. **No resource is provisioned by Cursor.** Every subsection ends with the same reminder: provisioning is a human-approved step.

## Topology

```
        Route 53
           |
       CloudFront ------------- S3 (media, private)
           |
           ALB (HTTPS + WSS, stickiness on, idle 300s)
           |
           ECS Fargate cluster: poppy-prod
             - service: poppy-api      (>=2 tasks, PROCESS_ROLE=api)
             - service: poppy-worker   (>=1 task, PROCESS_ROLE=worker)
           |
           +-- RDS Postgres 16 + pgvector
           +-- ElastiCache Redis (queue + presence + pub/sub)
```

Frontend (Next.js 16 SSR) is served from **AWS Amplify** at the apex domain. Backend + WS gateway live on ECS behind the ALB at a subdomain (e.g. `api.poppy.app`) that Amplify's SSR functions and the browser both call.

## Components

### RDS Postgres + pgvector
- Instance class small to start (`db.t4g.small`), Multi-AZ off in dev, Multi-AZ on in prod.
- Parameter group must enable the `vector` extension (`shared_preload_libraries` includes it, then `CREATE EXTENSION vector`).
- Connection string carries `?pgbouncer=true&connect_timeout=15` so Prisma routes through the RDS Proxy / pgbouncer sidecar. HNSW indexes on `Memory.embedding` + `MemorySummary.embedding` are already created by the Phase 05 migration.
- Provisioning is a human-approved step. Do not run apply/create.

### ElastiCache Redis
- Cluster mode disabled, single primary + one replica is enough for the queue.
- Used by BullMQ (media queue), the WS gateway's per-user pub/sub fan-out, and later for session presence.
- Provisioning is a human-approved step. Do not run apply/create.

### S3 media bucket + CloudFront
- Bucket is **private**; all reads go through CloudFront **signed URLs** (`backend/src/media/storage.ts` handles signing).
- Bucket policy denies `s3:GetObject` from anywhere but the CloudFront OAI/OAC.
- Lifecycle rule to expire unpaid/unreadied assets after N days (defer).
- Provisioning is a human-approved step. Do not run apply/create.

### Route 53
- Records:
  - `poppy.app` -> Amplify domain (A/ALIAS)
  - `api.poppy.app` -> ALB (A/ALIAS)
  - `media.poppy.app` -> CloudFront distribution (A/ALIAS)
- Provisioning is a human-approved step. Do not run apply/create.

### ECS cluster `poppy-prod`
- Fargate only, awsvpc network mode.
- Two services (see `ecs/service-api.json`, `ecs/service-worker.json`).
- Task definitions in `ecs/task-api.json`, `ecs/task-worker.json` reference secrets by ARN; **no secret is ever inlined**.
- Provisioning is a human-approved step. Do not run apply/create.

### SSM / Secrets Manager
- One secret per env var listed in `env-catalog.md`. Naming convention: `poppy/<VAR_NAME>` at path `arn:aws:secretsmanager:REGION:ACCT_ID:secret:poppy/<VAR>`.
- IAM: `poppy-ecs-execution` role has `secretsmanager:GetSecretValue` on the `poppy/*` prefix only.
- Provisioning is a human-approved step. Do not run apply/create.

## Cross-instance fan-out

The WS gateway (`backend/src/ws/gateway.ts`) subscribes each user's connection to a Redis pub/sub channel `poppy:ws:{userId}`. The media worker (`backend/src/queue/ws-notify.ts`) publishes `media.ready` to the same channel. Any API task that has that user's WS connection forwards the payload. This is what makes ALB stickiness a UX niceness (not a correctness requirement) for chat streams and what unblocks horizontal scale-out.

## What lives where

| Concern | Location |
|---|---|
| Frontend build | `amplify.yml` |
| Backend image | `/Dockerfile` |
| Local smoke | `/docker-compose.yml` |
| ECS task defs | `infra/ecs/task-{api,worker}.json` |
| ECS service defs | `infra/ecs/service-{api,worker}.json` |
| Env var catalog | `infra/env-catalog.md` |
| Deploy runbook | `infra/DEPLOY.md` |
| CI pipeline | `.github/workflows/ci.yml` |
