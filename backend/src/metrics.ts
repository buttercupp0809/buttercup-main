// In-process metrics. Deliberately lightweight: counters and a rolling
// latency window per label. A real deployment forwards these to Prometheus
// / Datadog via a scrape endpoint or push agent; the in-memory store keeps
// the health endpoint useful in isolation and unit-testable.

const counters = new Map<string, number>();
const latencies = new Map<string, number[]>();
const LATENCY_WINDOW = 500;

const providerOutcomes = new Map<string, { success: number; failure: number; fallback: number }>();
const mediaOutcomes = new Map<string, { ok: number; failed: number }>();

export function incrementCounter(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function getCounter(name: string): number {
  return counters.get(name) ?? 0;
}

export function recordLatency(label: string, ms: number): void {
  const arr = latencies.get(label) ?? [];
  arr.push(ms);
  if (arr.length > LATENCY_WINDOW) arr.shift();
  latencies.set(label, arr);
}

// p95 over the rolling window. Cheap enough at 500 samples that we sort
// per call; upgrade to a streaming histogram if we ever exceed a few
// thousand labels.
export function getLatencyP95(label: string): number {
  const arr = latencies.get(label);
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

export function recordProviderOutcome(input: {
  provider: string;
  success: boolean;
  fallback?: boolean;
}): void {
  const bucket = providerOutcomes.get(input.provider) ?? { success: 0, failure: 0, fallback: 0 };
  if (input.success) bucket.success += 1;
  else bucket.failure += 1;
  if (input.fallback) bucket.fallback += 1;
  providerOutcomes.set(input.provider, bucket);
}

export function recordMediaJobOutcome(input: { kind: string; status: "ok" | "failed" }): void {
  const bucket = mediaOutcomes.get(input.kind) ?? { ok: 0, failed: 0 };
  bucket[input.status] += 1;
  mediaOutcomes.set(input.kind, bucket);
}

// Rolling fallback rate across all providers over the current window.
export function getFallbackRate(): number {
  let total = 0;
  let fb = 0;
  for (const b of providerOutcomes.values()) {
    total += b.success + b.failure;
    fb += b.fallback;
  }
  return total === 0 ? 0 : fb / total;
}

export interface HealthSnapshot {
  counters: Record<string, number>;
  latencyP95: Record<string, number>;
  providers: Record<string, { success: number; failure: number; fallback: number }>;
  media: Record<string, { ok: number; failed: number }>;
  fallbackRate: number;
}

export function getHealthSnapshot(): HealthSnapshot {
  return {
    counters: Object.fromEntries(counters),
    latencyP95: Object.fromEntries(Array.from(latencies.keys()).map((k) => [k, getLatencyP95(k)])),
    providers: Object.fromEntries(providerOutcomes),
    media: Object.fromEntries(mediaOutcomes),
    fallbackRate: getFallbackRate(),
  };
}

// Test-only reset.
export function _resetMetrics(): void {
  counters.clear();
  latencies.clear();
  providerOutcomes.clear();
  mediaOutcomes.clear();
}
