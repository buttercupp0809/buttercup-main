import type { NextConfig } from "next";
import path from "node:path";

// Env comes from frontend/.env.local, which Next auto-loads from this
// directory. See frontend/.env.example for the required keys.

// Security headers per master-prd.md §15. CSP allowlist is scoped to
// Poppy's actual providers (LLMs, media, adult-friendly payment
// processors, Sentry). 'unsafe-eval' is dev-only; the prod CSP would omit
// it entirely.

const isDev = process.env.NODE_ENV !== "production";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://*.cloudfront.net https://*.s3.amazonaws.com https://*.fal.media",
  "media-src 'self' blob: https://*.cloudfront.net https://*.s3.amazonaws.com",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  [
    "connect-src 'self' https: wss:",
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
  "frame-src 'self' https://api.ccbill.com https://secure.verotel.com https://secure2.segpay.com https://commerce.coinbase.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://api.ccbill.com https://secure.verotel.com https://secure2.segpay.com https://commerce.coinbase.com",
];

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES.join("; ") },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@poppy/database", "@poppy/shared"],
  // Monorepo: the build runs from frontend/ but @poppy/* and the Prisma
  // engine live one level up. Tracing from the repo root ensures those files
  // are bundled into the serverless output on Vercel (and silences Next's
  // multi-lockfile root inference warning). The build always runs with cwd =
  // frontend/ (Vercel Root Directory and Amplify appRoot both = frontend).
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/api/(.*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
