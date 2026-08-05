# Stage 1: Build
FROM node:20-slim AS builder

# Build-time deps: openssl (Prisma), python3/make/g++ (native modules),
# libvips-dev (sharp).
RUN apt-get update -y && apt-get install -y --no-install-recommends \
      openssl python3 make g++ libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifest files first for cache efficiency.
COPY package.json package-lock.json* tsconfig.json ./
COPY backend/package.json backend/tsconfig.json ./backend/
COPY packages/database/package.json packages/database/tsconfig.json ./packages/database/
COPY packages/database/prisma ./packages/database/prisma
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/

# Install (postinstall runs prisma generate).
RUN npm install --no-audit --no-fund || npm install --no-audit --no-fund

# Copy remaining sources.
COPY packages/shared/ ./packages/shared/
COPY packages/database/ ./packages/database/
COPY backend/ ./backend/

# Build shared, then database (prisma generate + tsc), then backend.
RUN cd packages/shared && npx tsc
RUN cd packages/database && npx prisma generate && npx tsc
RUN cd backend && npx tsc

# Drop dev deps to shrink the runtime image.
RUN npm prune --production --no-audit

# Stage 2: Runtime
FROM node:20-slim

# Runtime-only deps: openssl (Prisma), ffmpeg (voice/video), ca-certificates
# (HTTPS to LLM/media/payment vendors), tini (PID 1 for clean SIGTERM).
RUN apt-get update -y && apt-get install -y --no-install-recommends \
      openssl ffmpeg ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# SECURITY: create a non-root user up-front so every subsequent COPY and the
# runtime CMD run as `app` (uid 10001), not root. A root-shelled container
# would give an attacker who pops the Node process direct access to the host.
RUN groupadd --system --gid 10001 app \
 && useradd  --system --uid 10001 --gid app --shell /usr/sbin/nologin --create-home app \
 && chown -R app:app /app

# Copy only what the runtime needs, preserving `app` ownership.
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/packages/database ./packages/database
COPY --from=builder --chown=app:app /app/packages/shared ./packages/shared
COPY --from=builder --chown=app:app /app/backend ./backend
COPY --from=builder --chown=app:app /app/package.json ./package.json

WORKDIR /app/backend

EXPOSE 4000

USER app

# Poppy runs two roles from a single image:
#   PROCESS_ROLE=api    (default) -> node dist/index.js  (HTTP + WS gateway)
#   PROCESS_ROLE=worker           -> node dist/worker.js (BullMQ consumer)
# The ECS worker task overrides CMD to ["node","dist/worker.js"]. The default
# CMD dispatches by env so operators can also run one image locally with only
# PROCESS_ROLE set.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "if [ \"$PROCESS_ROLE\" = \"worker\" ]; then exec node dist/worker.js; else exec node dist/index.js; fi"]

STOPSIGNAL SIGTERM

# ECS/ALB health check target. Backend exposes /healthz at PORT.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
