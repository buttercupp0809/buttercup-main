# Environment variable catalog

Maps every runtime env var to its **home**:
- **Amplify env**: frontend/SSR (Next.js). Values written in the Amplify console per branch.
- **ECS API secret**: backend API + WS gateway task. Value stored in Secrets Manager, referenced by ARN in `ecs/task-api.json`.
- **ECS worker secret**: BullMQ worker task. Same store, referenced by ARN in `ecs/task-worker.json`.

**Writing any of these into Amplify, SSM, or Secrets Manager is a human-approved action.** This file is a specification, not an executor.

| Variable | Purpose | Amplify | ECS API | ECS worker | `NEXT_PUBLIC_*` |
|---|---|---|---|---|---|
| `DATABASE_URL` | RDS Postgres pooled | Y | Y | Y | N |
| `JWT_SECRET` | Auth cookie signing | Y | Y | N | N |
| `REDIS_URL` | ElastiCache queue + pub/sub | N | Y | Y | N |
| `NEXT_PUBLIC_BACKEND_URL` | Frontend -> backend URL (WS/SSE) | Y | N | N | Y |
| `NEXT_PUBLIC_APP_URL` | Absolute app URL for magic links | Y | N | N | Y |
| `OPENROUTER_API_KEY` | LLM primary (uncensored) | N | Y | N | N |
| `ANTHROPIC_API_KEY` | LLM fallback | N | Y | N | N |
| `OPENAI_API_KEY` | LLM fallback | N | Y | N | N |
| `ELEVENLABS_API_KEY` | TTS primary | N | Y | Y | N |
| `CARTESIA_API_KEY` | TTS fallback | N | Y | Y | N |
| `GOOGLE_TTS_API_KEY` | TTS final fallback | N | Y | Y | N |
| `FAL_KEY` | Image primary | N | Y | Y | N |
| `REPLICATE_API_TOKEN` | Image fallback | N | Y | Y | N |
| `S3_BUCKET` | Media bucket name | N | Y | Y | N |
| `S3_ENDPOINT` | Only for MinIO/LocalStack | N | dev only | dev only | N |
| `AWS_REGION` | AWS region | N | Y | Y | N |
| `CLOUDFRONT_URL` | Signed URL base | Y | Y | Y | N |
| `CLOUDFRONT_KEY_PAIR_ID` | CF key-pair id | N | Y | Y | N |
| `CLOUDFRONT_PRIVATE_KEY` | CF private key (PEM) | N | Y | Y | N |
| `CCBILL_ACCOUNT_NUMBER` | CCBill account | N | Y | N | N |
| `CCBILL_FLEXFORM_ID` | CCBill checkout form | N | Y | N | N |
| `CCBILL_DATALINK_SALT` | Webhook signature salt | N | Y | N | N |
| `VEROTEL_SHOP_ID` | Verotel shop | N | Y | N | N |
| `VEROTEL_SIGNATURE_KEY` | Verotel webhook key | N | Y | N | N |
| `SEGPAY_PACKAGE_ID` | SegPay package | N | Y | N | N |
| `SEGPAY_URL_ID` | SegPay url id | N | Y | N | N |
| `SEGPAY_HMAC_KEY` | SegPay HMAC | N | Y | N | N |
| `COINBASE_COMMERCE_API_KEY` | Crypto checkout (optional) | N | Y | N | N |
| `PAYMENT_PRIMARY_PROVIDER` | Failover ordering | N | Y | N | N |
| `AGE_VERIFICATION_VENDOR_KEY` | Age vendor (Yoti/Persona) | N | Y | N | N |
| `SENTRY_DSN` | Error tracking | Y | Y | Y | Y (via `NEXT_PUBLIC_SENTRY_DSN`) |
| `MEDIA_WORKER_CONCURRENCY` | Worker parallelism | N | N | Y | N |
| `PROCESS_ROLE` | api or worker (image dispatch) | N | Y | Y | N |
| `NODE_ENV` | production | Y | Y | Y | N |

## Provisioning checklist (human-executed)

1. Create Secrets Manager entries at `buttercupp/<VAR>` for every ECS row above. STOP for approval before each write.
2. Grant `buttercupp-ecs-execution` `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:REGION:ACCT_ID:secret:buttercupp/*`.
3. Populate the Amplify console env for the app's production branch with every "Amplify" row.
4. Confirm `NEXT_PUBLIC_*` values are also visible to Amplify's SSR runtime (they are baked into `.next/server-env.json` by `amplify.yml`).
5. Never commit any of these values to the repository. `.env` is git-ignored; `.env.example` holds placeholders only.
