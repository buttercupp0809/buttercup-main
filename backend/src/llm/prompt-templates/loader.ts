// Prompt template loader. Reads the numbered `.md` files in this directory
// once at module load, caches them in production, and re-reads on every
// call in development so template edits hot-reload without restarting the
// dev server.
//
// Placeholder syntax:
//   {{PASCAL_CASE}}   -> user-editable fill-in slot (missing = empty string)
//   {{@RUNTIME_KEY}}  -> runtime-injected value (character / relationship
//                        state / memory / etc.). Passed in via `values`.
// The two markers are distinguished by the leading `@` so a stray user slot
// cannot accidentally shadow a runtime value the composer expects to set.
//
// The safety template (60-safety.md) is LOCKED: `resolve` on it never
// substitutes anything. This is enforced by a runtime guard so a future
// caller cannot inject into SB 243 / crisis / hard-rule text.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const TEMPLATE_NAMES = [
  "00-base-persona",
  "10-gesture-format",
  "20-character",
  "30-relationship",
  "40-memory",
  "45-user-context",
  "50-content-mode",
  "60-safety",
  "70-output-rules",
  "80-disclosure",
] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

// Locked templates never accept substitutions. Safety must always render
// exactly what the file says; the SB 243 obligations depend on it.
export const LOCKED_TEMPLATES: ReadonlySet<TemplateName> = new Set(["60-safety"]);

const cache = new Map<TemplateName, { body: string; mtimeMs: number }>();

// tsx (dev) and vitest resolve __dirname to `.../backend/src/llm/prompt-templates`.
// Compiled node (prod) resolves to `.../backend/dist/llm/prompt-templates`.
// The backend `build` script copies the .md files into dist so both paths
// work; we still fall back to src if the dist copy is missing, which keeps
// ad-hoc `node dist/...` invocations from an unbuilt tree from crashing.
function resolvePath(name: TemplateName): string {
  const direct = join(__dirname, `${name}.md`);
  try {
    statSync(direct);
    return direct;
  } catch {
    // Fallback: swap `/dist/` for `/src/` so a partial build still finds the
    // source template. Safe because both trees contain the same file.
    return direct.replace(`${"/dist/"}`, `${"/src/"}`);
  }
}

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function loadTemplate(name: TemplateName): string {
  const path = resolvePath(name);
  if (isDev()) {
    // Dev: cheap mtime check so an unchanged file still hits the cache but
    // any edit is picked up on the next composition call.
    const stat = statSync(path);
    const hit = cache.get(name);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.body;
    const body = readFileSync(path, "utf8");
    cache.set(name, { body, mtimeMs: stat.mtimeMs });
    return body;
  }
  const hit = cache.get(name);
  if (hit) return hit.body;
  const body = readFileSync(path, "utf8");
  cache.set(name, { body, mtimeMs: 0 });
  return body;
}

// Match any {{...}} placeholder. The captured group is the identifier;
// a leading `@` marks a runtime slot vs a user-fill slot. Both look up
// the same values map, but the composer supplies runtime keys with the
// `@` prefix already included.
const PLACEHOLDER_RE = /\{\{([A-Z_@][A-Z0-9_@]*)\}\}/g;

// Resolve placeholders against a values map. Missing / empty user slots
// resolve to empty string (a blank guideline is intentional and byte-safe).
// Missing runtime slots throw because the composer forgot to wire something.
export function resolve(
  name: TemplateName,
  template: string,
  values: Record<string, string> = {},
): string {
  if (LOCKED_TEMPLATES.has(name)) {
    // Locked layer: any substitution attempt is a bug. Return the template
    // verbatim so a caller cannot inject anything into it, ever.
    return template;
  }
  return template.replace(PLACEHOLDER_RE, (_match, key: string) => {
    const isRuntime = key.startsWith("@");
    const value = values[key];
    if (value === undefined) {
      if (isRuntime) {
        throw new Error(`prompt-template: missing runtime slot ${key} in ${name}`);
      }
      return "";
    }
    return value;
  });
}

// Convenience helper: load + resolve in one call. Trims a trailing newline
// that Prettier / editors add to .md files so composition can control its
// own separators (join("\n\n")) without stacking blank lines.
export function render(name: TemplateName, values: Record<string, string> = {}): string {
  const raw = loadTemplate(name);
  const resolved = resolve(name, raw, values);
  return resolved.endsWith("\n") ? resolved.slice(0, -1) : resolved;
}

// Reset the in-memory cache. Only used by tests that want to prove the
// loader re-reads after a file edit.
export function _resetCacheForTests(): void {
  cache.clear();
}
