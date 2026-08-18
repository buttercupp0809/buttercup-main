# S3 + CloudFront Asset Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every AI-generated image to S3 (3 buckets: uploads / generated / videos), serve through CloudFront signed URLs, link assets to characters in the DB, and generate 4 variants per persona prompt instead of 1.

**Architecture:** Extend the existing `backend/src/media/storage.ts` (which already wraps `@aws-sdk/client-s3` and `@aws-sdk/cloudfront-signer`) to support three separate buckets. Chat image generation calls `saveGeneratedAsset()` after generating the buffer, stores the result in `MediaAsset`, and returns a signed CloudFront URL instead of a base64 data URL. The persona pipeline gains a `--character-id` flag and uploads each variant to S3 via `boto3`, then POSTs to the character gallery API.

**Tech Stack:** AWS SDK v3 (already installed in backend), `@aws-sdk/cloudfront-signer` (add to frontend), Vitest (test runner `npm test` from repo root), boto3 (persona pipeline, `pip install boto3`), bash + AWS CLI (infra scripts).

## Global Constraints

- No em dash character (U+2014) anywhere: code, comments, scripts, docs.
- Strict TypeScript: no `any` without comment explaining why.
- Prisma singleton from `@buttercupp/database` only -- never `new PrismaClient()`.
- Tests run via `npm test` (vitest) from repo root.
- Never commit, push, or deploy without explicit user instruction.
- Env vars printed by the setup script; add to `backend/.env` and root `.env` before running Tasks 2+.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `Plans/s3-cdn/10-setup.sh` | Provision 3 S3 buckets, CloudFront distribution, IAM user, RSA key pair |
| Create | `Plans/s3-cdn/20-destroy.sh` | Tear down everything created by 10-setup.sh |
| Modify | `backend/src/media/storage.ts` | Add `uploadGenerated()`, `isStorageConfigured()` |
| Modify | `backend/src/media/asset.ts` | Add `createReadyAsset()` for synchronous image jobs |
| Modify | `backend/src/media/asset.test.ts` | Test `createReadyAsset` |
| Modify | `backend/src/chat/image-turn.ts` | Accept `userId`, persist to S3, return `url` not `dataUrl` |
| Modify | `backend/src/ws/gateway.ts` | Pass `userId` to `generateChatImage` |
| Modify | `backend/src/http/chat-stream.ts` | Pass `userId` to `generateChatImage` |
| Create | `frontend/lib/cdn.ts` | `signAssetUrl(s3Key, ttl)` using cloudfront-signer |
| Modify | `frontend/app/api/characters/[id]/gallery/route.ts` | Return signed URLs inline |
| Modify | `frontend/package.json` | Add `@aws-sdk/cloudfront-signer` |
| Modify | `packages/database/prisma/schema.prisma` | Add `@@index([characterId, kind])` to `MediaAsset` |
| Modify | `Plans/inference-aws/persona_pipeline.py` | 4 variants/prompt, boto3 upload, API call |
| Modify | `Plans/inference-aws/generate-persona-images.sh` | Pass `CHARACTER_ID` and `API_BASE_URL` |
| Modify | `Plans/inference-aws/generate-persona-images-batch.sh` | Same as above |

---

## Task 1: Infrastructure setup scripts

**Files:**
- Create: `Plans/s3-cdn/10-setup.sh`
- Create: `Plans/s3-cdn/20-destroy.sh`

**Interfaces:**
- Produces: `POPPY_S3_BUCKET_UPLOADS`, `POPPY_S3_BUCKET_GENERATED`, `POPPY_S3_BUCKET_VIDEOS`, `CLOUDFRONT_URL`, `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` printed to stdout.

- [ ] **Step 1: Create `Plans/s3-cdn/10-setup.sh`**

```bash
#!/usr/bin/env bash
# Plans/s3-cdn/10-setup.sh
# Provisions: 3 S3 buckets, 3 OACs, 1 CloudFront distribution, IAM user,
# RSA 2048 key pair for CloudFront signed URLs.
# Run once per environment. Prints env vars to stdout on completion.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AWS_REGION="${AWS_REGION:-eu-north-1}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
B_UPL="poppy-uploads-$ACCOUNT"
B_GEN="poppy-generated-$ACCOUNT"
B_VID="poppy-videos-$ACCOUNT"

echo "==> Creating S3 buckets in $AWS_REGION"
for B in "$B_UPL" "$B_GEN" "$B_VID"; do
  aws s3api head-bucket --bucket "$B" 2>/dev/null && echo "  $B already exists" && continue
  aws s3api create-bucket --bucket "$B" --region "$AWS_REGION" \
    --create-bucket-configuration LocationConstraint="$AWS_REGION" >/dev/null
  aws s3api put-public-access-block --bucket "$B" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
  echo "  created $B"
done

echo "==> Generating RSA 2048 key pair"
KEY_DIR="$HERE/.keys"; mkdir -p "$KEY_DIR"; chmod 700 "$KEY_DIR"
if [[ ! -f "$KEY_DIR/private.pem" ]]; then
  openssl genrsa -out "$KEY_DIR/private.pem" 2048 2>/dev/null
  openssl rsa -pubout -in "$KEY_DIR/private.pem" -out "$KEY_DIR/public.pem" 2>/dev/null
  chmod 600 "$KEY_DIR/private.pem"
fi

echo "==> Uploading public key to CloudFront"
PK_TMP=$(mktemp)
python3 -c "
import json, sys
print(json.dumps({
  'CallerReference': 'poppy-$(date +%s)',
  'Name': 'poppy-sign-key',
  'EncodedKey': open('$KEY_DIR/public.pem').read(),
  'Comment': 'Poppy CDN signing key'
}))
" > "$PK_TMP"
CF_PK_ID=$(aws cloudfront create-public-key \
  --public-key-config "file://$PK_TMP" \
  --query 'PublicKey.Id' --output text)
rm "$PK_TMP"
echo "  key ID: $CF_PK_ID"

echo "==> Creating CloudFront key group"
CF_KG_ID=$(aws cloudfront create-key-group \
  --key-group-config "{\"Name\":\"poppy-keys\",\"Items\":[\"$CF_PK_ID\"],\"Comment\":\"\"}" \
  --query 'KeyGroup.Id' --output text)

echo "==> Creating Origin Access Controls"
create_oac() {
  aws cloudfront create-origin-access-control \
    --origin-access-control-config \
    "{\"Name\":\"$1\",\"Description\":\"\",\"SigningProtocol\":\"sigv4\",\"SigningBehavior\":\"always\",\"OriginAccessControlOriginType\":\"s3\"}" \
    --query 'OriginAccessControl.Id' --output text
}
OAC_UPL=$(create_oac "poppy-oac-uploads")
OAC_GEN=$(create_oac "poppy-oac-generated")
OAC_VID=$(create_oac "poppy-oac-videos")

echo "==> Creating CloudFront distribution (3 origins)"
DIST_TMP=$(mktemp)
python3 - <<PYEOF > "$DIST_TMP"
import json
config = {
  "CallerReference": "poppy-dist-$(date +%s)",
  "Comment": "Poppy CDN",
  "Enabled": True,
  "HttpVersion": "http2",
  "Origins": {
    "Quantity": 3,
    "Items": [
      {
        "Id": "uploads",
        "DomainName": "${B_UPL}.s3.${AWS_REGION}.amazonaws.com",
        "OriginAccessControlId": "${OAC_UPL}",
        "S3OriginConfig": {"OriginAccessIdentity": ""}
      },
      {
        "Id": "generated",
        "DomainName": "${B_GEN}.s3.${AWS_REGION}.amazonaws.com",
        "OriginAccessControlId": "${OAC_GEN}",
        "S3OriginConfig": {"OriginAccessIdentity": ""}
      },
      {
        "Id": "videos",
        "DomainName": "${B_VID}.s3.${AWS_REGION}.amazonaws.com",
        "OriginAccessControlId": "${OAC_VID}",
        "S3OriginConfig": {"OriginAccessIdentity": ""}
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "generated",
    "ViewerProtocolPolicy": "redirect-to-https",
    "TrustedKeyGroups": {"Enabled": True, "Quantity": 1, "Items": ["${CF_KG_ID}"]},
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "AllowedMethods": {"Quantity": 2, "Items": ["GET","HEAD"], "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}}
  },
  "CacheBehaviors": {
    "Quantity": 2,
    "Items": [
      {
        "PathPattern": "/uploads/*",
        "TargetOriginId": "uploads",
        "ViewerProtocolPolicy": "redirect-to-https",
        "TrustedKeyGroups": {"Enabled": True, "Quantity": 1, "Items": ["${CF_KG_ID}"]},
        "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
        "AllowedMethods": {"Quantity": 2, "Items": ["GET","HEAD"], "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}}
      },
      {
        "PathPattern": "/videos/*",
        "TargetOriginId": "videos",
        "ViewerProtocolPolicy": "redirect-to-https",
        "TrustedKeyGroups": {"Enabled": True, "Quantity": 1, "Items": ["${CF_KG_ID}"]},
        "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
        "AllowedMethods": {"Quantity": 2, "Items": ["GET","HEAD"], "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}}
      }
    ]
  }
}
print(json.dumps(config))
PYEOF
DIST_OUT=$(aws cloudfront create-distribution \
  --distribution-config "file://$DIST_TMP" \
  --query 'Distribution.{Id:Id,Domain:DomainName}' --output json)
rm "$DIST_TMP"
CF_DIST_ID=$(echo "$DIST_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['Id'])")
CF_DOMAIN=$(echo "$DIST_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['Domain'])")

# Bucket policies for OAC access
attach_bucket_policy() {
  local bucket=$1 dist_id=$2
  aws s3api put-bucket-policy --bucket "$bucket" --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"AllowCFOAC\",
      \"Effect\": \"Allow\",
      \"Principal\": {\"Service\": \"cloudfront.amazonaws.com\"},
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::${bucket}/*\",
      \"Condition\": {\"StringEquals\": {\"AWS:SourceArn\": \"arn:aws:cloudfront::${ACCOUNT}:distribution/${dist_id}\"}}
    }]
  }"
}
attach_bucket_policy "$B_UPL" "$CF_DIST_ID"
attach_bucket_policy "$B_GEN" "$CF_DIST_ID"
attach_bucket_policy "$B_VID" "$CF_DIST_ID"

echo "==> Creating IAM user poppy-backend"
aws iam create-user --user-name poppy-backend 2>/dev/null || true
aws iam put-user-policy --user-name poppy-backend --policy-name poppy-s3 \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [\"s3:PutObject\",\"s3:GetObject\",\"s3:DeleteObject\"],
      \"Resource\": [
        \"arn:aws:s3:::${B_UPL}/*\",
        \"arn:aws:s3:::${B_GEN}/*\",
        \"arn:aws:s3:::${B_VID}/*\"
      ]
    }]
  }"
KEY_OUT=$(aws iam create-access-key --user-name poppy-backend \
  --query 'AccessKey.{K:AccessKeyId,S:SecretAccessKey}' --output json)
ACCESS_KEY=$(echo "$KEY_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['K'])")
SECRET_KEY=$(echo "$KEY_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['S'])")

# Save state
cat > "$HERE/.state" <<STATE
CF_DIST_ID=$CF_DIST_ID
CF_PK_ID=$CF_PK_ID
CF_KG_ID=$CF_KG_ID
OAC_UPL=$OAC_UPL
OAC_GEN=$OAC_GEN
OAC_VID=$OAC_VID
B_UPL=$B_UPL
B_GEN=$B_GEN
B_VID=$B_VID
AWS_REGION=$AWS_REGION
ACCOUNT=$ACCOUNT
STATE

PRIV_KEY_ONELINER=$(awk 'NF{printf "%s\\n",$0}' "$KEY_DIR/private.pem")

echo ""
echo "============================================================"
echo "Add these to backend/.env and Plans/s3-cdn/.env:"
echo "============================================================"
echo "AWS_REGION=$AWS_REGION"
echo "AWS_ACCESS_KEY_ID=$ACCESS_KEY"
echo "AWS_SECRET_ACCESS_KEY=$SECRET_KEY"
echo "POPPY_S3_BUCKET_UPLOADS=$B_UPL"
echo "POPPY_S3_BUCKET_GENERATED=$B_GEN"
echo "POPPY_S3_BUCKET_VIDEOS=$B_VID"
echo "S3_BUCKET=$B_GEN"
echo "CLOUDFRONT_URL=https://$CF_DOMAIN"
echo "CLOUDFRONT_KEY_PAIR_ID=$CF_PK_ID"
echo "CLOUDFRONT_PRIVATE_KEY=\"$PRIV_KEY_ONELINER\""
echo "============================================================"
echo "NOTE: CloudFront distribution deploys in 10-15 minutes."
echo "      Check status: aws cloudfront get-distribution --id $CF_DIST_ID --query 'Distribution.Status'"
```

- [ ] **Step 2: Create `Plans/s3-cdn/20-destroy.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$HERE/.state" ]] || { echo "no .state file -- nothing to destroy"; exit 1; }
source "$HERE/.state"
echo "This will DELETE all 3 S3 buckets and the CloudFront distribution."
read -r -p "Type DESTROY to confirm: " CONFIRM
[[ "$CONFIRM" == "DESTROY" ]] || { echo "aborted"; exit 1; }
# Disable + delete CloudFront distribution
ETAG=$(aws cloudfront get-distribution --id "$CF_DIST_ID" --query 'ETag' --output text)
aws cloudfront get-distribution-config --id "$CF_DIST_ID" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); d['DistributionConfig']['Enabled']=False; print(json.dumps(d['DistributionConfig']))" \
  > /tmp/cf-disable.json
aws cloudfront update-distribution --id "$CF_DIST_ID" \
  --distribution-config file:///tmp/cf-disable.json --if-match "$ETAG" >/dev/null
echo "Disabled CF dist $CF_DIST_ID -- wait ~5 min then re-run to delete buckets."
# Empty and delete buckets
for B in "$B_UPL" "$B_GEN" "$B_VID"; do
  aws s3 rm "s3://$B" --recursive 2>/dev/null || true
  aws s3api delete-bucket --bucket "$B" --region "$AWS_REGION" 2>/dev/null || true
  echo "deleted $B"
done
echo "Destroy complete. Delete the CF distribution manually once Deployed -> Disabled."
```

- [ ] **Step 3: Run setup script and paste env vars into `backend/.env`**

```bash
cd Plans/s3-cdn
chmod +x 10-setup.sh 20-destroy.sh
./10-setup.sh
```

Paste the printed vars into `backend/.env`. The CF distribution deploys in 10-15 min; you can continue with Tasks 2-5 while it deploys.

- [ ] **Step 4: Verify S3 buckets exist**

```bash
aws s3 ls | grep poppy
# Expected: poppy-uploads-<account>  poppy-generated-<account>  poppy-videos-<account>
```

---

## Task 2: Backend storage layer extensions

**Files:**
- Modify: `backend/src/media/storage.ts`
- Modify: `backend/src/media/asset.ts`
- Test: `backend/src/media/asset.test.ts`

**Interfaces:**
- Consumes: nothing new (extends existing module)
- Produces:
  - `uploadGenerated(buffer: Buffer, ctx: UploadContext): Promise<string>` -- s3Key
  - `isStorageConfigured(): boolean`
  - `createReadyAsset(params: CreateReadyAssetParams): Promise<MediaAsset>` -- bypasses queued state for synchronous generation

- [ ] **Step 1: Write failing test for `createReadyAsset`**

Add to `backend/src/media/asset.test.ts`:

```typescript
import { createReadyAsset } from "./asset";
// Add after existing tests:
describe("createReadyAsset", () => {
  it("exported function exists", () => {
    expect(typeof createReadyAsset).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --reporter=verbose backend/src/media/asset.test.ts
# Expected: FAIL -- createReadyAsset is not exported
```

- [ ] **Step 3: Add `createReadyAsset` to `backend/src/media/asset.ts`**

Add after `createQueuedAsset`:

```typescript
export interface CreateReadyAssetParams {
  userId: string;
  characterId: string | null;
  kind: MediaKind;
  s3Key: string;
  meta?: Record<string, unknown>;
}

export async function createReadyAsset(params: CreateReadyAssetParams): Promise<MediaAsset> {
  return prisma.mediaAsset.create({
    data: {
      userId: params.userId,
      characterId: params.characterId ?? undefined,
      kind: params.kind,
      s3Key: params.s3Key,
      status: "ready",
      meta: (params.meta ?? {}) as Prisma.InputJsonValue,
    },
  });
}
```

- [ ] **Step 4: Add `uploadGenerated` and `isStorageConfigured` to `backend/src/media/storage.ts`**

Add at the end of the file (before the closing of any namespace if any):

```typescript
export function isStorageConfigured(): boolean {
  return Boolean(
    (process.env.POPPY_S3_BUCKET_GENERATED ?? process.env.S3_BUCKET) &&
      process.env.CLOUDFRONT_URL &&
      process.env.CLOUDFRONT_KEY_PAIR_ID &&
      process.env.CLOUDFRONT_PRIVATE_KEY,
  );
}

// Uploads to the generated-assets bucket (POPPY_S3_BUCKET_GENERATED or S3_BUCKET fallback).
// Returns s3Key. Throws if neither bucket env var is set.
export async function uploadGenerated(buffer: Buffer, ctx: UploadContext): Promise<string> {
  const bucket = process.env.POPPY_S3_BUCKET_GENERATED ?? process.env.S3_BUCKET;
  if (!bucket) throw new Error("POPPY_S3_BUCKET_GENERATED not configured");
  const deps = loadS3();
  if (!deps) throw new Error("aws sdk not available");
  const ext = extensionFor(ctx.contentType);
  const { randomUUID } = await import("node:crypto");
  const key = `${ctx.kind}s/${ctx.userId}/${randomUUID()}.${ext}`;
  const PutCtor = deps.PutObjectCommand as new (args: Record<string, unknown>) => unknown;
  const cmd = new PutCtor({ Bucket: bucket, Key: key, Body: buffer, ContentType: ctx.contentType });
  const send = (deps.client as { send: (c: unknown) => Promise<unknown> }).send.bind(deps.client);
  await send(cmd);
  return key;
}
```

- [ ] **Step 5: Run tests to confirm passing**

```bash
npm test -- --reporter=verbose backend/src/media/asset.test.ts
# Expected: all tests PASS including the new createReadyAsset one
```

- [ ] **Step 6: Run TypeScript check**

```bash
npx tsc --project backend/tsconfig.json --noEmit
# Expected: no errors
```

---

## Task 3: Chat image persistence

**Files:**
- Modify: `backend/src/chat/image-turn.ts`
- Modify: `backend/src/ws/gateway.ts`
- Modify: `backend/src/http/chat-stream.ts`

**Interfaces:**
- Consumes: `uploadGenerated(buffer, ctx)` from `storage.ts`, `createReadyAsset(params)` from `asset.ts`, `getSignedUrl(s3Key, ttl)` from `storage.ts`
- Produces: `generateChatImage(userText, conversationId?, userId?): Promise<ChatImageResult>` where `ChatImageResult.url` is a CloudFront signed URL (or base64 data URL if storage not configured).

- [ ] **Step 1: Update `ChatImageResult` interface in `backend/src/chat/image-turn.ts`**

Replace:
```typescript
export interface ChatImageResult {
  dataUrl: string; // data:image/png;base64,...
  provider: string;
  consistent: boolean; // true when the character's face was locked in
  seed?: number;
}
```
With:
```typescript
export interface ChatImageResult {
  // CloudFront signed URL when S3 is configured; data:image/png;base64,... in
  // local dev (when storage is not configured). Callers treat this as an opaque
  // URL that can be dropped into <img src>.
  url: string;
  mediaAssetId?: string; // set when saved to S3; absent in base64 fallback mode
  provider: string;
  consistent: boolean;
  seed?: number;
}
```

- [ ] **Step 2: Add `userId` param to `generateChatImage` and wire in storage**

Replace the existing `generateChatImage` function signature and both return blocks:

```typescript
import { uploadGenerated, isStorageConfigured, getSignedUrl } from "../media/storage";
import { createReadyAsset } from "../media/asset";

export async function generateChatImage(
  userText: string,
  conversationId?: string,
  userId?: string,
): Promise<ChatImageResult> {
  const prompt = cleanImagePrompt(userText);

  let referenceBytes: Buffer | null = null;
  let characterId: string | null = null;
  if (conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { characterId: true },
    });
    if (conv?.characterId) {
      characterId = conv.characterId;
      referenceBytes = await resolveCharacterReferenceBytes(conv.characterId);
    }
  }

  async function persistAndSign(
    buffer: Buffer,
    provider: string,
    consistent: boolean,
    seed?: number,
  ): Promise<ChatImageResult> {
    if (userId && isStorageConfigured()) {
      const s3Key = await uploadGenerated(buffer, {
        userId,
        kind: "image",
        contentType: "image/png",
      });
      const asset = await createReadyAsset({
        userId,
        characterId,
        kind: "image",
        s3Key,
      });
      const signedUrl = await getSignedUrl(s3Key, 48 * 3600);
      return { url: signedUrl, mediaAssetId: asset.id, provider, consistent, seed };
    }
    // Local dev fallback: return base64 data URL, nothing persisted.
    const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
    return { url: dataUrl, provider, consistent, seed };
  }

  if (referenceBytes) {
    const poseHint = extractPoseHint(userText);
    const res = await generateWithComfyUIConsistent({
      prompt,
      negativePrompt: NEGATIVE,
      referenceBytes,
      poseHint: poseHint ?? undefined,
    });
    return persistAndSign(res.buffer, res.provider, true, typeof res.meta.seed === "number" ? res.meta.seed : undefined);
  }

  const res = await generateImage({
    prompt,
    negativePrompt: NEGATIVE,
    style: "realistic",
    referenceImageUrls: [],
    loraRef: null,
  });
  return persistAndSign(res.buffer, res.provider, false, typeof res.meta.seed === "number" ? res.meta.seed : undefined);
}
```

- [ ] **Step 3: Update `backend/src/ws/gateway.ts` to pass `userId`**

Find the line that calls `generateChatImage` (around line 173 based on earlier grep). It currently reads:

```typescript
const img = await generateChatImage(parsed.text, parsed.conversationId);
```

Change to:

```typescript
const img = await generateChatImage(parsed.text, parsed.conversationId, userId);
```

Then update the `media.ready` event emission (line ~173). Change:

```typescript
url: img.dataUrl,
```

To:

```typescript
url: img.url,
```

- [ ] **Step 4: Update `backend/src/http/chat-stream.ts` to pass `userId` and use `img.url`**

In `handleChatStream`, find:

```typescript
const img = await generateChatImage(body.text, body.conversationId);
const id = `img-${Date.now()}`;
sseWrite(res, "image", { url: img.dataUrl, mediaAssetId: id, provider: img.provider });
```

Change to:

```typescript
const img = await generateChatImage(body.text, body.conversationId, userId);
const id = img.mediaAssetId ?? `img-${Date.now()}`;
sseWrite(res, "image", { url: img.url, mediaAssetId: id, provider: img.provider });
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --project backend/tsconfig.json --noEmit
# Expected: no errors
```

- [ ] **Step 6: Manual smoke test (requires backend running + GPU box up)**

Start backend: `npm run dev:backend`
In another terminal, send an image request through the chat WebSocket or SSE endpoint.
Expected: the `image` event now contains an `https://` CloudFront URL instead of `data:image/png;base64,...`.
Check the database: `MediaAsset` row created with `status: "ready"` and `s3Key` set.

---

## Task 4: Gallery signed URLs

**Files:**
- Create: `frontend/lib/cdn.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/app/api/characters/[id]/gallery/route.ts`

**Interfaces:**
- Consumes: `CLOUDFRONT_URL`, `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY` from env
- Produces: `signAssetUrl(s3Key: string, ttlSeconds?: number): string` -- signed CloudFront URL

- [ ] **Step 1: Add `@aws-sdk/cloudfront-signer` to `frontend/package.json`**

```bash
cd frontend && npm install @aws-sdk/cloudfront-signer
```

- [ ] **Step 2: Create `frontend/lib/cdn.ts`**

```typescript
// CloudFront signed URL generation for the Next.js frontend API layer.
// Uses the same env vars as backend/src/media/storage.ts.
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

const CF_URL = process.env.CLOUDFRONT_URL ?? "";
const CF_KEY_ID = process.env.CLOUDFRONT_KEY_PAIR_ID ?? "";
const CF_PRIVATE_KEY = (process.env.CLOUDFRONT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

export function isCdnConfigured(): boolean {
  return Boolean(CF_URL && CF_KEY_ID && CF_PRIVATE_KEY);
}

export function signAssetUrl(s3Key: string, ttlSeconds = 48 * 3600): string {
  if (!isCdnConfigured()) return s3Key; // local dev: return bare key
  const url = `${CF_URL.replace(/\/$/, "")}/${s3Key}`;
  return getSignedUrl({
    url,
    keyPairId: CF_KEY_ID,
    dateLessThan: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    privateKey: CF_PRIVATE_KEY,
  });
}
```

- [ ] **Step 3: Update gallery route to return signed URLs**

In `frontend/app/api/characters/[id]/gallery/route.ts`, replace the response mapping:

```typescript
import { signAssetUrl } from "@/lib/cdn";

// Inside the GET handler, replace the return statement:
return NextResponse.json({
  items: rows.map((r) => ({
    id: r.id,
    url: r.s3Key ? signAssetUrl(r.s3Key) : null,
    s3Key: r.s3Key,
    createdAt: r.createdAt.toISOString(),
  })),
  nextCursor,
});
```

- [ ] **Step 4: TypeScript check on frontend**

```bash
npx tsc --project frontend/tsconfig.json --noEmit
# Expected: no errors
```

---

## Task 5: DB index migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- No code interface changes. Pure DB performance improvement.

- [ ] **Step 1: Add index to `MediaAsset` in schema.prisma**

Find the `MediaAsset` model (search for `model MediaAsset`) and add the index inside the model block, after the existing field definitions:

```prisma
@@index([characterId, kind])
@@index([userId, kind])
```

- [ ] **Step 2: Create and apply migration**

```bash
npm run db:migrate
# When prompted for migration name, enter: add_media_asset_indexes
```

- [ ] **Step 3: Verify migration applied**

```bash
npm run db:studio
# Open the MediaAsset table and confirm the index exists.
# Or: psql your-local-db -c "\d+ MediaAsset"
```

---

## Task 6: Persona pipeline -- 4 variants per prompt + S3 upload

**Files:**
- Modify: `Plans/inference-aws/persona_pipeline.py`
- Modify: `Plans/inference-aws/generate-persona-images.sh`
- Modify: `Plans/inference-aws/generate-persona-images-batch.sh`

**Interfaces:**
- Consumes: `POPPY_S3_BUCKET_GENERATED`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `CLOUDFRONT_URL` from env; `CHARACTER_ID` and `POPPY_API_BASE_URL` as script arguments passed to argv.
- Produces: 4 `CharacterMedia` DB rows per prompt (via `POST /api/characters/{id}/gallery`), each with a CloudFront path as `url`.

**Prerequisites:** `pip install boto3` and `pip install requests` on the machine running the scripts.

- [ ] **Step 1: Add `boto3` + S3 upload + API call helpers to `persona_pipeline.py`**

Add these imports and constants after the existing imports (`import hashlib` etc.):

```python
import uuid
import requests
import boto3

VARIANTS_PER_PROMPT = 4

S3_BUCKET = os.environ.get("POPPY_S3_BUCKET_GENERATED", "")
AWS_REGION_PIPELINE = os.environ.get("AWS_REGION", "eu-north-1")
CF_URL = os.environ.get("CLOUDFRONT_URL", "").rstrip("/")
API_BASE = os.environ.get("POPPY_API_BASE_URL", "http://localhost:4000")
CHARACTER_ID = os.environ.get("POPPY_CHARACTER_ID", "")
API_TOKEN = os.environ.get("POPPY_API_TOKEN", "")

_s3 = None

def get_s3():
    global _s3
    if _s3 is None and S3_BUCKET:
        _s3 = boto3.client("s3", region_name=AWS_REGION_PIPELINE)
    return _s3


def upload_image_to_s3(local_path: str) -> str:
    """Upload a PNG to S3 and return the s3Key."""
    s3 = get_s3()
    if not s3 or not S3_BUCKET:
        return ""
    key = f"images/{uuid.uuid4()}.png"
    with open(local_path, "rb") as fh:
        s3.put_object(Bucket=S3_BUCKET, Key=key, Body=fh.read(), ContentType="image/png")
    return key


def save_to_db(s3_key: str, is_primary: bool) -> bool:
    """Create a CharacterMedia row via the app API."""
    if not CHARACTER_ID or not API_BASE or not s3_key:
        return False
    cf_path = f"{CF_URL}/{s3_key}" if CF_URL else s3_key
    try:
        resp = requests.post(
            f"{API_BASE}/api/characters/{CHARACTER_ID}/gallery",
            json={"url": cf_path, "kind": "image", "isPrimary": is_primary},
            headers={"Authorization": f"Bearer {API_TOKEN}"},
            timeout=10,
        )
        return resp.ok
    except Exception as exc:
        print(f"  [warn] DB save failed: {exc}")
        return False
```

- [ ] **Step 2: Update the main generation loop for 4 variants per prompt**

Replace the existing `for i, prompt in enumerate(prompts, start=1):` loop with:

```python
print(f"[persona {persona_id}] {len(prompts)} prompt(s) x {VARIANTS_PER_PROMPT} variants = {len(prompts) * VARIANTS_PER_PROMPT} images. Face from {uploaded_name}")
first_saved = not bool(CHARACTER_ID)  # skip isPrimary if no character ID

for i, prompt in enumerate(prompts, start=1):
    for v in range(1, VARIANTS_PER_PROMPT + 1):
        seed = random.randint(1, 2_000_000_000)
        pose_index = (i - 1) * VARIANTS_PER_PROMPT + (v - 1)
        pose = POSE_PREFIXES[pose_index % len(POSE_PREFIXES)]
        positive = pose + ", " + quality_prefix + prompt
        prefix = f"{persona_id}_p{i}_v{v}"
        print(f"  (p{i} v{v}/{VARIANTS_PER_PROMPT}) seed={seed} pose={pose[:30]}")
        try:
            pid = submit(build_workflow(positive, seed, prefix))
            img = wait_image(pid)
        except Exception as e:
            print(f"  FAILED: {e}")
            manifest["variants"].append({"index": i, "variant": v, "prompt": prompt, "seed": seed, "file": None, "status": "error"})
            continue
        if not img:
            print(f"  FAILED (timeout)")
            manifest["variants"].append({"index": i, "variant": v, "prompt": prompt, "seed": seed, "file": None, "status": "timeout"})
            continue
        dest_name = f"variant-p{i}-v{v}.png"
        dest = os.path.join(persona_dir, dest_name)
        download(img, dest)
        size = os.path.getsize(dest)
        # Upload to S3 and save to DB
        s3_key = upload_image_to_s3(dest)
        is_primary = (not first_saved)
        db_ok = save_to_db(s3_key, is_primary)
        if db_ok and is_primary:
            first_saved = True
        print(f"  saved {dest_name} ({size} bytes) s3={'ok' if s3_key else 'skipped'} db={'ok' if db_ok else 'skipped'}")
        manifest["variants"].append({
            "index": i, "variant": v, "prompt": prompt, "seed": seed, "pose": pose,
            "file": dest_name, "s3Key": s3_key,
            "references_main_image": manifest["main_image"],
            "status": "ok", "bytes": size,
        })
```

- [ ] **Step 3: Update `generate-persona-images.sh` to export env vars the pipeline needs**

Add after the existing generation params block (after `NEG=...`):

```bash
# S3 + DB integration
export POPPY_S3_BUCKET_GENERATED="${POPPY_S3_BUCKET_GENERATED:-}"
export AWS_REGION="${AWS_REGION:-eu-north-1}"
export CLOUDFRONT_URL="${CLOUDFRONT_URL:-}"
export POPPY_CHARACTER_ID="${CHARACTER_ID:-}"
export POPPY_API_BASE_URL="${API_BASE_URL:-http://localhost:4000}"
export POPPY_API_TOKEN="${POPPY_API_TOKEN:-}"
```

Then update the usage comment at the top to show the new optional env vars:

```bash
# Optional S3+DB env vars (set in Plans/s3-cdn/.env or export before running):
#   CHARACTER_ID=<prisma character id>
#   POPPY_API_TOKEN=<backend JWT for API calls>
#   API_BASE_URL=http://localhost:4000
```

- [ ] **Step 4: Apply the same env var exports to `generate-persona-images-batch.sh`**

Same block as Step 3, added after the `NEG=...` line.

- [ ] **Step 5: Syntax check**

```bash
bash -n Plans/inference-aws/generate-persona-images.sh && echo ok
bash -n Plans/inference-aws/generate-persona-images-batch.sh && echo ok
python3 -m py_compile Plans/inference-aws/persona_pipeline.py && echo ok
```

- [ ] **Step 6: End-to-end test (GPU box must be running)**

```bash
export CHARACTER_ID="<a real character id from your local DB>"
export POPPY_API_TOKEN="<backend auth token>"
export API_BASE_URL="http://localhost:4000"
cd Plans/inference-aws
./generate-persona-images.sh test-persona ~/Desktop/test-face.jpg
```

Expected: 4 images generated per prompt, S3 keys printed, DB rows created in `CharacterMedia`. Check with `npm run db:studio`.

---

## Self-review checklist

- [x] Spec section "Infrastructure" covered by Task 1.
- [x] Spec section "Backend upload layer" covered by Task 2 (`uploadGenerated`, `createReadyAsset`).
- [x] Spec section "Chat image flow" covered by Task 3.
- [x] Spec section "Character gallery signing" covered by Task 4.
- [x] Spec section "DB index" covered by Task 5.
- [x] Spec section "Persona pipeline 4 variants + S3" covered by Task 6.
- [x] No `any` introduced without comment.
- [x] No `new PrismaClient()` introduced.
- [x] No em dashes.
- [x] `ChatImageResult.url` used consistently in Tasks 3, 4 (no leftover `dataUrl` references).
- [x] `signAssetUrl` from `frontend/lib/cdn.ts` matches usage in gallery route (Task 4).
- [x] `createReadyAsset` in Task 3 matches the signature defined in Task 2.
- [x] `uploadGenerated` in Task 3 matches the function defined in Task 2.
- [x] The persona pipeline `save_to_db` posts to `/api/characters/{CHARACTER_ID}/gallery` which is the existing gallery route -- but that route is `GET` only. **Fix below.**

> **Gap found in self-review:** `POST /api/characters/{id}/gallery` does not exist -- the existing route is `GET` only. The persona pipeline needs to POST to create a `CharacterMedia` row. This needs a new API route.

**Additional task required:**

### Task 4b: Add `POST /api/characters/[id]/gallery` route

**Files:**
- Modify: `frontend/app/api/characters/[id]/gallery/route.ts` (add `POST` handler)

- [ ] **Step 1: Add `POST` handler to the gallery route**

```typescript
import { z } from "zod";
import { getSignedUrl } from "@/lib/cdn"; // will be available after Task 4

const postBodySchema = z.object({
  url: z.string().min(1),
  kind: z.enum(["image", "video"]),
  isPrimary: z.boolean().optional().default(false),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const { id: rawId } = await ctx.params;
  let characterId: string;
  try {
    characterId = assertSafeId(rawId, "characterId");
  } catch {
    return jsonError(400, "invalid_id");
  }

  // Verify character belongs to this user
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { creatorId: true },
  });
  if (!character || character.creatorId !== user.id) {
    return jsonError(403, "forbidden");
  }

  let body: z.infer<typeof postBodySchema>;
  try {
    body = postBodySchema.parse(await req.json());
  } catch {
    return jsonError(400, "invalid_body");
  }

  if (body.isPrimary) {
    // Clear existing primary flag before setting new one
    await prisma.characterMedia.updateMany({
      where: { characterId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const media = await prisma.characterMedia.create({
    data: {
      characterId,
      kind: body.kind,
      url: body.url,
      isPrimary: body.isPrimary,
      sort: 0,
      likesBase: 0,
    },
    select: { id: true, url: true, isPrimary: true },
  });

  return NextResponse.json({ id: media.id, url: media.url, isPrimary: media.isPrimary }, { status: 201 });
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --project frontend/tsconfig.json --noEmit
```
