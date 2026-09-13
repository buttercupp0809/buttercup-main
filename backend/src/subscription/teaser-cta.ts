// Re-export the shared CTA copy module so backend delivery paths (SSE/WS/
// worker) and the frontend history SSR select the SAME stable line for a
// given mediaAssetId. The implementation lives in @buttercupp/shared because
// it is pure (no I/O) and needed on both sides of the wire.

export { ctaLineFor, CTA_LINES } from "@buttercupp/shared";
