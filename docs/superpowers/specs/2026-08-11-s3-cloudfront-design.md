# S3 + CloudFront Asset Storage

**Date:** 2026-08-11
**Status:** Approved, pending implementation

---

## Problem

All AI-generated images currently live only in memory as base64 data URLs. They are never persisted: a page refresh loses every chat image. The character gallery stores `/public` paths checked into git, which means large binary assets go through version control. There is no durable, CDN-served store linked to the character or user who owns the asset.

---

## Goals

1. Every AI-generated image (chat or persona pipeline) is stored in S3, linked to its owner character + user in the DB.
2. Assets are served through CloudFront with signed URLs (adult content protection, prevents hotlinking).
3. The persona pipeline generates 4 variants per prompt and saves all to S3 + DB automatically.
4. No binary assets go through git.
5. One setup script provisions all infrastructure and prints the env vars needed.

---

## Infrastructure

### S3 Buckets (eu-north-1)

Three buckets, all in the same region as the GPU box (zero egress cost for uploads from the GPU):

| Bucket | Contents | Key prefix |
|--------|----------|------------|
| `poppy-uploads-{accountId}` | User reference photos, avatar uploads | `images/`, `avatars/` |
| `poppy-generated-{accountId}` | AI images, voice clips | `images/`, `voice/` |
| `poppy-videos-{accountId}` | Video reels | `reels/` |

All buckets: block all public access (no public ACLs), versioning off (assets are immutable by key), lifecycle rule to expire failed-job orphans after 30 days.

### CloudFront Distribution

One distribution, three origins (one per bucket), path-based cache behaviors:

| Path pattern | Origin bucket | Signed URLs | TTL |
|-------------|---------------|-------------|-----|
| `/uploads/*` | poppy-uploads | Required | 48 h |
| `/generated/*` | poppy-generated | Required | 48 h |
| `/videos/*` | poppy-videos | Required | 7 days |

- HTTPS only (HTTP redirected).
- Origin Access Control (OAC) so S3 buckets are never directly accessible.
- Custom error pages: 403/404 return `{"error":"not_found"}` with 404 status.

### Signing

CloudFront signed URLs using RSA 2048 key pair (not signed cookies, to avoid leaking access across assets):

- Public key uploaded to CloudFront as a Key Group.
- Private key stored in `POPPY_CLOUDFRONT_PRIVATE_KEY` (PEM string, newlines as `\n`).
- Key pair ID stored in `POPPY_CLOUDFRONT_KEY_PAIR_ID`.
- Signing done server-side in `backend/src/media/storage.ts` using `@aws-sdk/cloudfront-signer`.

### IAM

One IAM user `poppy-backend`:
- Policy: `s3:PutObject`, `s3:GetObject` on all three buckets.
- No CloudFront IAM permission needed (signing uses the RSA key, not IAM).
- Access key stored in `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.

### Setup Script

`Plans/s3-cdn/10-setup.sh`:
- Creates all three buckets with correct config.
- Creates CloudFront distribution with OAC.
- Creates IAM user + policy + access key.
- Generates RSA 2048 key pair, uploads public key to CloudFront.
- Prints all env vars to stdout (paste into `.env`).

`Plans/s3-cdn/20-destroy.sh`: full teardown (requires confirmation).

---

## Backend

### `backend/src/media/storage.ts` (new)

Single module that owns all S3 and CloudFront operations:

```typescript
uploadToS3(bucket: string, key: string, buffer: Buffer, mimeType: string): Promise<string>
// Returns the s3Key (e.g. "images/abc123.png").

signCdnUrl(s3Key: string, ttlSeconds?: number): string
// Returns a signed CloudFront URL. Default TTL: 48 h for images, 7 days for videos.
// Key prefix determines TTL automatically.

cdnUrlForKey(s3Key: string): string
// Unsigned CloudFront URL (base domain + key path). Stored in DB; signed on serve.
```

Dependencies: `@aws-sdk/client-s3`, `@aws-sdk/cloudfront-signer`. Both already in the AWS SDK v3 family.

### `backend/src/media/asset-store.ts` (new)

Higher-level helper used by image generation and the chat pipeline:

```typescript
saveGeneratedAsset(params: {
  buffer: Buffer;
  mimeType: string;
  kind: "image" | "voice" | "video";
  userId: string;
  characterId?: string;
}): Promise<{ mediaAssetId: string; signedUrl: string }>
```

Internally:
1. Generates a UUID key: `images/<uuid>.png`.
2. Calls `uploadToS3(BUCKET_GENERATED, key, buffer, mimeType)`.
3. Creates `MediaAsset` row: `{ userId, characterId, kind, s3Key: key, status: "ready" }`.
4. Signs and returns the URL.

### Chat image flow changes

**`backend/src/chat/image-turn.ts`**

`generateChatImage()` currently returns `{ dataUrl: string }`. After this change:
- Calls `saveGeneratedAsset()` after getting the image buffer.
- Returns `{ signedUrl: string; mediaAssetId: string; consistent: boolean }`.
- No base64 anywhere in the response.

**`backend/src/ws/gateway.ts` + `backend/src/http/chat-stream.ts`**

`media.ready` WS event and `image` SSE event emit `signedUrl` instead of base64 data URL.

**`frontend/lib/chat-transport.ts`**

`TransportEvent.image.url` was the base64 data URL. Now it is a CloudFront signed URL (still an `https://` URL, so the `<img src>` works identically).

**`frontend/components/chat/ChatWindow.tsx`**

No change required: already renders `<img src={message.imageUrl}>`. The URL format changes from `data:` to `https:`, which `<img>` handles the same way.

### Character gallery signing

`GET /api/characters/[id]` and `GET /api/characters` currently return `CharacterMedia.url` as-is. After this change:
- If `url` starts with `/generated/` or `/uploads/`, sign it before returning (48 h TTL).
- If `url` is a legacy `/public/` path, return as-is (backward compatible during migration).

`CharacterMedia.url` in the DB stores the **unsigned** CloudFront path (e.g. `/generated/images/uuid.png`). Signing always happens at serve time, never stored.

---

## Persona Pipeline

### Bulk 4-variant generation

`persona_pipeline.py` currently generates 1 image per prompt. After:
- Each prompt runs 4 times with different random seeds.
- Results: 4 images per prompt, N prompts = 4N images per persona.

### S3 upload from pipeline

After each image is downloaded from ComfyUI, `persona_pipeline.py`:
1. Calls `boto3.client("s3").put_object(Bucket=BUCKET_GENERATED, Key=key, Body=bytes)`.
2. Calls `POST /api/characters/{characterId}/gallery` with `{ url: cloudfrontPath, kind: "image", isPrimary: false }` to create a `CharacterMedia` row.
3. The first variant of the first prompt is marked `isPrimary: true` only if the character has no existing primary `CharacterMedia` row (prevents overwriting a user-chosen avatar).

Requires: `boto3` (`pip install boto3`), same AWS credentials as the backend.

`generate-persona-images.sh` and `generate-persona-images-batch.sh` pass `CHARACTER_ID` and `API_BASE_URL` to the pipeline so it can call the API.

---

## Database

No schema changes needed. The existing schema already supports this:
- `MediaAsset.s3Key` - stores the S3 object key.
- `MediaAsset.characterId` - links asset to character.
- `CharacterMedia.url` - stores the unsigned CloudFront path.

The only migration needed: add a DB index on `MediaAsset(characterId, kind)` to speed up gallery queries. This is a non-breaking additive migration.

---

## Environment Variables

All generated and printed by `Plans/s3-cdn/10-setup.sh`:

```bash
# AWS credentials
AWS_REGION=eu-north-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# S3 bucket names
POPPY_S3_BUCKET_UPLOADS=poppy-uploads-123456789012
POPPY_S3_BUCKET_GENERATED=poppy-generated-123456789012
POPPY_S3_BUCKET_VIDEOS=poppy-videos-123456789012

# CloudFront
POPPY_CLOUDFRONT_DOMAIN=d1xxxxxxxxxxxx.cloudfront.net
POPPY_CLOUDFRONT_KEY_PAIR_ID=K1XXXXXXXXXX
POPPY_CLOUDFRONT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
```

Add to `backend/.env` and (for the pipeline) `Plans/s3-cdn/.env`.

---

## Error Handling

- S3 upload failure: `saveGeneratedAsset` throws; callers already have try/catch that returns an `error` SSE/WS event. The image generation attempt is lost (no partial DB record). Acceptable for MVP.
- CloudFront signing failure (bad key): throws at startup if env vars are missing. Backend startup check validates `POPPY_CLOUDFRONT_KEY_PAIR_ID` and `POPPY_CLOUDFRONT_PRIVATE_KEY` are set.
- Expired signed URL: CloudFront returns 403. Frontend shows broken image. Future work: auto-refresh via `/api/assets/{id}/sign` endpoint.

---

## Out of Scope (future phases)

- Signed URL refresh endpoint for expired gallery images.
- Pre-signed S3 upload URLs for direct browser-to-S3 upload (bypassing backend for large files).
- Video upload from the GPU box to `poppy-videos`.
- CDN cache invalidation on delete.
