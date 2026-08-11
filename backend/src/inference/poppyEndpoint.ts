// Resolver for the self-hosted GPU box (poppy-inference): Stheno text on
// :8001 and Juggernaut/ComfyUI image on :8188. The box is SCALE-TO-ZERO, so its
// public IP changes on each start and it may be stopped when a request lands.
//
// Resolution order:
//   1. Static override (POPPY_STHENO_URL / POPPY_JUGGERNAUT_URL): use when the box
//      is pinned on, or for local testing. Skips the router entirely.
//   2. Router (POPPY_ROUTER_URL + POPPY_ROUTER_TOKEN): calls /wake to start
//      the box on demand, polls /status until it is running, caches the IP.
//
// If neither is configured, resolution throws "poppy_not_configured" and the
// caller (LLM chain / image chain) falls through to its other providers.

type Service = "stheno" | "juggernaut";

const PORT: Record<Service, number> = { stheno: 8001, juggernaut: 8188 };

const IP_TTL_MS = 60_000; // re-check the router at most once a minute
const WAKE_TIMEOUT_MS = 180_000; // give a cold box up to 3 min to come up
const WAKE_POLL_MS = 5_000;

let cachedIp: string | null = null;
let cachedAt = 0;

export function poppyConfigured(): boolean {
  return Boolean(
    process.env.POPPY_ROUTER_URL ||
      process.env.POPPY_STHENO_URL ||
      process.env.POPPY_JUGGERNAUT_URL,
  );
}

async function fetchJson(url: string, opts?: RequestInit, timeoutMs = 10_000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`router_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function routerUrl(path: string): string {
  const base = (process.env.POPPY_ROUTER_URL ?? "").replace(/\/$/, "");
  const token = process.env.POPPY_ROUTER_TOKEN ?? "";
  const sep = path.includes("?") ? "&" : "?";
  return token ? `${base}${path}${sep}token=${encodeURIComponent(token)}` : `${base}${path}`;
}

interface WakeResponse {
  status?: string; // warming | ready
  state?: string; // ec2 state
  ip?: string | null;
}

// Ensure the box is running via the router and return its current public IP.
async function ensureAwakeIp(): Promise<string> {
  if (cachedIp && Date.now() - cachedAt < IP_TTL_MS) return cachedIp;

  const wake = (await fetchJson(routerUrl("/wake"))) as WakeResponse;
  if (wake.status === "ready" && wake.ip) {
    cachedIp = wake.ip;
    cachedAt = Date.now();
    return wake.ip;
  }

  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, WAKE_POLL_MS));
    const st = (await fetchJson(routerUrl("/status")).catch(() => ({}))) as WakeResponse & {
      ready?: boolean;
    };
    if (st.state === "running" && st.ip) {
      cachedIp = st.ip;
      cachedAt = Date.now();
      return st.ip;
    }
  }
  throw new Error("poppy_wake_timeout");
}

// Returns the base URL (scheme://host:port, no trailing slash) for a service.
// Stheno callers should append "/v1"; ComfyUI callers use the root.
export async function resolvePoppyBaseUrl(service: Service): Promise<string> {
  const staticUrl =
    service === "stheno" ? process.env.POPPY_STHENO_URL : process.env.POPPY_JUGGERNAUT_URL;
  if (staticUrl) return staticUrl.replace(/\/$/, "");

  if (!process.env.POPPY_ROUTER_URL) throw new Error("poppy_not_configured");
  const ip = await ensureAwakeIp();
  return `http://${ip}:${PORT[service]}`;
}

// Test/ops hook: drop the cached IP so the next call re-resolves via the router.
export function _resetPoppyCache(): void {
  cachedIp = null;
  cachedAt = 0;
}
