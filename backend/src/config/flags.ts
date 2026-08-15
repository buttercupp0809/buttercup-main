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

// Phase 30: memory graph flags. Unlike matureContentEnabled, these default
// OFF (a flag is ON only when the env var is the exact string "true"), so
// the flag-off path stays byte-identical to Phase 05/23 behavior until
// explicitly opted in. Names mirror the sibling Pellow project for env
// parity.
function defaultOff(envVar: string): boolean {
  return process.env[envVar] === "true";
}

// Gates entity + edge writes in the extractor (memory-extractor.ts) and the
// graph-aware retrieval read (memory-retriever.ts getRelevantMemoriesWithGraph).
export function memoryGraphEnabled(): boolean {
  return defaultOff("MEMORY_GRAPH_ENABLED");
}

// Gates the nightly clustering job (memory/dreaming.ts). Never runs on the
// hot chat-turn path; only from the manual/scheduled script.
export function memoryDreamingEnabled(): boolean {
  return defaultOff("MEMORY_DREAMING_ENABLED");
}

// Gates the user-set conversational rulebook (memory/rulebook.ts).
export function userRulebookEnabled(): boolean {
  return defaultOff("USER_RULEBOOK_ENABLED");
}

// Gates the gap-free tiered MemorySummary fetch (memory/coverage.ts).
// Flag-off returns the single latest summary, byte-identical to today.
export function memoryTieredContextEnabled(): boolean {
  return defaultOff("MEMORY_TIERED_CONTEXT_ENABLED");
}
