// Phase 00 feature flags. Same `defaultOn` pattern as
// ../Pellow/backend/src/config/flags.ts: a flag is ON unless the env var is
// set to the exact string "false". Read lazily so tests and dotenv timing
// pick up live env changes.

function defaultOn(envVar: string): boolean {
  return process.env[envVar] !== "false";
}

// Master switch for mature content across the platform. Per PRD §0, ButterCupp is
// mature-gated from day one, so this defaults ON. Later phases add narrower
// per-tier and per-user gates on top of this.
export function matureContentEnabled(): boolean {
  return defaultOn("MATURE_CONTENT_ENABLED");
}
