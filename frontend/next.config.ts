import type { NextConfig } from "next";
import path from "path";

// Env comes from frontend/.env.local, which Next auto-loads from this
// directory. See frontend/.env.example for the required keys.

// Security headers per master-prd.md §15. CSP allowlist is scoped to
// ButterCupp's actual providers (LLMs, media, adult-friendly payment
// processors, Sentry). 'unsafe-eval' is dev-only; the prod CSP would omit
// it entirely.

const isDev = process.env.NODE_ENV !== "production";

// Dev-only: the /api/media proxy 302-redirects to a presigned URL. In
// production that target is CloudFront (already covered by the
// https://*.cloudfront.net allowlist below); in local dev it is the local
// MinIO container the app talks to when S3_ENDPOINT is set (see
// backend/.env, frontend/app/api/media/route.ts), which the browser then
// follows directly. Without this, the browser's own CSP silently blocks
// every locally-stored character image (no network/console error beyond a
// CSP violation), even though the proxy and MinIO both answer fine. Omitted
// entirely in production, where nothing serves media over plain localhost.
const DEV_LOCAL_MEDIA_ORIGINS = isDev ? ["http://localhost:9000", "http://127.0.0.1:9000"] : [];

const CSP_DIRECTIVES = [
  "default-src 'self'",
  [
    "img-src 'self' data: blob:",
    "https://*.cloudfront.net",
    "https://*.s3.amazonaws.com",
    "https://*.s3.eu-north-1.amazonaws.com",
    "https://*.fal.media",
    ...DEV_LOCAL_MEDIA_ORIGINS,
  ].join(" "),
  [
    "media-src 'self' blob:",
    "https://*.cloudfront.net",
    "https://*.s3.amazonaws.com",
    "https://*.s3.eu-north-1.amazonaws.com",
    ...DEV_LOCAL_MEDIA_ORIGINS,
  ].join(" "),
  // Google Identity Services (Sign in with Google): the GIS client script is
  // loaded from accounts.google.com; without it here the button never renders
  // (CSP blocks https://accounts.google.com/gsi/client). The button also draws
  // in an accounts.google.com iframe (frame-src) and pulls an external GIS
  // stylesheet (style-src) that 'unsafe-inline' does NOT cover.
  `script-src 'self' 'unsafe-inline' https://accounts.google.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  [
    "connect-src 'self' https: wss:",
    // Dev-only: the browser calls the local backend (BillingClient, media,
    // chat-stream) directly over plain http on a different port
    // (NEXT_PUBLIC_BACKEND_URL/NEXT_PUBLIC_WS_URL, localhost:4000 by
    // default), which the production-shaped "https: wss:" wildcards above
    // never cover. Without this, every local /billing and /upgrade fetch is
    // silently dropped by the browser's own CSP enforcement (not a network
    // or CORS error), even though the backend itself answers fine. Omitted
    // entirely in production, where the backend is HTTPS/WSS and already
    // covered by the wildcards above.
    ...(isDev ? ["http://localhost:4000", "ws://localhost:4000"] : []),
    "https://openrouter.ai",
    "https://api.anthropic.com",
    "https://api.openai.com",
    "https://api.elevenlabs.io",
    "https://api.cartesia.ai",
    "https://texttospeech.googleapis.com",
    "https://fal.run",
    "https://api.replicate.com",
    "https://api.ccbill.com",
    "https://secure.verotel.com",
    "https://secure2.segpay.com",
    "https://commerce.coinbase.com",
    "https://*.sentry.io",
  ].join(" "),
  "frame-src 'self' https://accounts.google.com https://api.ccbill.com https://secure.verotel.com https://secure2.segpay.com https://commerce.coinbase.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://api.ccbill.com https://secure.verotel.com https://secure2.segpay.com https://commerce.coinbase.com",
];

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // "same-origin" breaks Google Sign-In popup mode: the GSI gsi/transform page
  // calls window.opener.postMessage() to send the credential back, but COOP
  // same-origin severs window.opener for all cross-origin popups (opener is
  // null -> TypeError). "same-origin-allow-popups" keeps the opener reference
  // for popups we open (Google auth) while still blocking cross-origin pages
  // from navigating into our browsing context group.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES.join("; ") },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@buttercupp/database", "@buttercupp/shared"],
  // sharp is a native module (used by lib/media-blur.ts for server-side
  // paywall blurring). Keep it external so Next never tries to bundle the
  // platform-specific binary.
  // Prisma client + engine and adapter must stay external. When webpack bundles
  // @prisma/client, the generated engine path resolution breaks in the Lambda
  // ("could not locate the Query Engine"). Keeping them external makes Next
  // trace the real generated client + engine into the serverless output.
  serverExternalPackages: ["sharp", "@prisma/client", ".prisma/client", "@prisma/adapter-pg", "@prisma/driver-adapter-utils", "pg"],
  // Monorepo: the build runs from frontend/ but @buttercupp/* and the Prisma
  // engine live one level up. Tracing from the repo root ensures those files
  // are bundled into the serverless output on Vercel (and silences Next's
  // multi-lockfile root inference warning). The build always runs with cwd =
  // frontend/ (Vercel Root Directory and Amplify appRoot both = frontend).
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  // instrumentation.ts (and a few API routes) import Node built-ins (fs, path,
  // crypto, child_process). Next compiles instrumentation for BOTH nodejs and
  // edge runtimes; webpack fails on the edge/client pass if it can't resolve
  // these. Stub them out for non-Node bundles so webpack skips them. The
  // nodejs server build picks them up natively at runtime.
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        path: false,
        crypto: false,
        child_process: false,
      };
    }
    return config;
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/api/(.*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
