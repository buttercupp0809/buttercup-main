# ButterCupp AWS deployment

One-command-ish deploy of the whole product on AWS, modeled on the Pellow
`Plans/aws-automation/` layout:

- **Frontend** -> AWS Amplify (Next.js 16 SSR / WEB_COMPUTE) at `www.buttercupp.fun`
- **Backend + WebSocket** -> ECS Fargate behind an ALB at `api.buttercupp.fun`
- **Worker** -> ECS Fargate (BullMQ media worker), same image, no load balancer
- **Database** -> RDS Postgres 16 (+ pgvector)
- **Queue / pub-sub** -> ElastiCache Redis
- **Media** -> existing S3 buckets, served through CloudFront signed URLs

Everything is driven by one config file (`config.env`) and a shared helper
(`lib.sh`). Every mutating script prints what it will do and waits for you to
type `yes` (pass `--yes` to skip in automation). Nothing here deploys on its
own; you run each step.

## 0. Prerequisites

- `aws` CLI v2 configured with an admin-ish profile in the target account
- `docker` (with buildx), `jq`, `psql`, `openssl`, `node`/`npm`
- Domain `buttercupp.fun` reachable in Route 53 (or your DNS host, for the ACM
  validation + final CNAME/ALIAS records)
- The three S3 buckets already exist: `poppy-character-media`, `poppy-generated`,
  `poppy-reels`

## 1. Fill config + secrets

```bash
cd Plans/aws-automation
cp secrets.env.example secrets.env          # backend/ECS secrets  (git-ignored)
cp amplify-env.env.example amplify-env.env   # frontend/Amplify env (git-ignored)
# edit config.env only if the defaults (region, names, domain) need changing
```

`config.env` holds non-secret constants and a "FILL AFTER PROVISION" block.
Each provisioning script prints the ids it creates; paste them back into
`config.env` before running the step that needs them.

## 2. Provision (greenfield, run in order)

| Step | Script | Creates | Paste back into config.env |
|------|--------|---------|-----------------------------|
| 0 | `./00-preflight.sh` | nothing (checks) | - |
| 1 | `./01-provision-foundation.sh` | VPC/subnets discovery, 4 security groups, ECR repo, log groups, IAM roles | `VPC_ID`, `SUBNET_IDS`, `PUBLIC_SUBNET_IDS`, `SG_*` |
| 2 | `./02-provision-data.sh` | RDS Postgres + ElastiCache Redis | `RDS_ENDPOINT`, `REDIS_ENDPOINT` |
| 3 | `./03-provision-secrets.sh` | Secrets Manager `buttercupp/<KEY>` from `secrets.env` | - |
| 4 | `./04-provision-cloudfront.sh` | ACM (us-east-1), OAC, distribution, signing key group | `CLOUDFRONT_DIST_ID`, `CLOUDFRONT_DOMAIN`, `CLOUDFRONT_KEY_PAIR_ID` |
| 5 | `./05-provision-alb.sh` | ACM (eu-north-1), ALB, target group, listeners | `ALB_ARN`, `ALB_DNS`, `TG_API_ARN` |
| 6 | `./06-provision-ecs.sh` | ECS cluster, task defs, api + worker services | - |
| 7 | `./07-provision-amplify.sh` | Amplify app + branch + env + custom domain (writes `www`/apex records) | `AMPLIFY_APP_ID` |
| 8 | `./08-provision-dns.sh` | Route 53: ACM validation CNAMEs + `api` (ALB alias) + `media` (CloudFront alias) | - |

Notes:
- Step 4 and 5 request ACM certs and print DNS validation CNAMEs. Add those to
  your DNS, wait for the certs to go `ISSUED`, then continue.
- After step 4, put the CloudFront values into **both** `secrets.env`
  (`CLOUDFRONT_URL`, `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY` from
  `cf_private.pem`) and `amplify-env.env`, then re-run step 3 and set the
  Amplify env (step 7).
- Generate the CloudFront signing keypair before step 4:
  ```bash
  openssl genrsa -out cf_private.pem 2048
  openssl rsa -pubout -in cf_private.pem -out cloudfront_signing_public_key.pem
  ```
  `cf_private.pem` is git-ignored; its contents are the `CLOUDFRONT_PRIVATE_KEY`
  secret.
- Connecting a **private** GitHub repo to Amplify needs a one-time OAuth
  authorization; set `GITHUB_ACCESS_TOKEN` before step 7 or finish the
  "Connect repository" step in the Amplify console.

### DNS records

If `buttercupp.fun` is in Route 53, `./08-provision-dns.sh` writes these for you:

- `api.buttercupp.fun` -> A-ALIAS to the ALB
- `media.buttercupp.fun` -> A-ALIAS to the CloudFront distribution
- the ACM validation CNAMEs for both certs (so they reach `ISSUED`)

`www.buttercupp.fun` + `buttercupp.fun` (apex, redirects to `www`) are written by
Amplify's domain association in step 07, including their own cert validation.

Run `./08-provision-dns.sh validation` right after steps 04/05 to validate the
certs, then `./08-provision-dns.sh records` once `ALB_ARN` + `CLOUDFRONT_DOMAIN`
are in `config.env`. If your domain lives at another DNS host, create the same
records there by hand.

## 3. Deploy

```bash
./10-migrate-db.sh              # prisma migrate deploy + CREATE EXTENSION vector
./11-deploy-backend.sh full     # build -> ECR -> digest-pinned roll of api+worker
./12-deploy-frontend.sh         # trigger the Amplify build
./14-health-check.sh            # verify everything is green
```

Or all at once with gates:

```bash
./16-deploy-all.sh              # health -> migrate -> backend -> frontend -> sanity
```

## 4. Day-2 ops

| Script | Use |
|--------|-----|
| `./11-deploy-backend.sh [full\|build-only\|ecs-only]` | ship a backend change |
| `./12-deploy-frontend.sh` | rebuild the frontend |
| `./13-set-env-vars.sh secrets.env` | rotate/patch backend secrets + roll |
| `./14-health-check.sh` | full system status |
| `./15-sanity-check.sh` | scan recent logs for errors after a deploy |
| `./connect.sh backend logs` | tail the api log group |
| `./connect.sh db shell` | psql into RDS (needs `PGPASSWORD`) |

## Why images broke on the old host (and how this fixes it)

`lib/cdn.ts` `signAssetUrl()` returns a **CloudFront signed URL** when
`CLOUDFRONT_URL` + `CLOUDFRONT_KEY_PAIR_ID` + `CLOUDFRONT_PRIVATE_KEY` are set;
otherwise it falls back to the server-side `/api/media?k=` proxy, which itself
needs `AWS_REGION` + `S3_BUCKET` + `POPPY_S3_BUCKET_GENERATED` + AWS credentials
in the runtime. The old host had none of these in its server env, so both paths
failed and images 404'd. This deploy sets them in the Amplify env (and, because
Amplify does not reliably forward console env to the SSR runtime,
`frontend/instrumentation.ts` loads them from the build-baked
`.next/server-env.json`). The CSP `img-src` in `next.config.ts` already allows
`*.cloudfront.net` and `*.s3.eu-north-1.amazonaws.com`; if you serve media from
`media.buttercupp.fun`, add that host to `img-src`/`media-src`.

## Gotchas baked into the scripts

- **Digest-pinned ECS rollout**: `11-deploy-backend.sh` re-registers the task
  def pinned to the new image `@sha256:...` digest, not `:latest`. A plain
  `--force-new-deployment` would silently re-pull the old digest.
- **Every secret referenced by a task def must exist.** ECS will not start a
  task if any `valueFrom` secret is missing, so keep all keys in `secrets.env`
  present (blank is fine for optional ones).
- **Default VPC**: `06-provision-ecs.sh` runs tasks with `assignPublicIp=ENABLED`
  because a default VPC has no NAT. The `infra/ecs/service-*.json` templates
  assume private subnets + NAT (`assignPublicIp=DISABLED`); switch to those once
  you add private networking.
- **JWT_SECRET must match** across Amplify, the ECS api task, and the frontend,
  or auth cookies minted on one side fail to verify on the other.
