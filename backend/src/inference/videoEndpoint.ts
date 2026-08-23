// Resolver for the dedicated Wan 2.2 video box (ComfyUI on :8188). Separate box
// and separate router from the Stheno/Juggernaut resolver in poppyEndpoint.ts.
// Scale-to-zero: the box may be stopped and its public IP changes on each start.
//
// Resolution order:
//   1. Static override POPPY_WAN_URL (box pinned on, or local testing).
//   2. Router POPPY_VIDEO_ROUTER_URL (+ POPPY_VIDEO_ROUTER_TOKEN): /wake the box
//      on demand, poll /status until running, cache the IP.

const VIDEO_PORT = 8188;
const IP_TTL_MS = 60_000;
const WAKE_TIMEOUT_MS = 240_000; // A14B cold start (boot + big model load) up to 4 min
const WAKE_POLL_MS = 5_000;

let cachedIp: string | null = null;
let cachedAt = 0;

export function videoConfigured(): boolean {
  return Boolean(process.env.POPPY_WAN_URL || process.env.POPPY_VIDEO_ROUTER_URL);
}

async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`video_router_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function routerUrl(path: string): string {
  const base = (process.env.POPPY_VIDEO_ROUTER_URL ?? "").replace(/\/$/, "");
  const token = process.env.POPPY_VIDEO_ROUTER_TOKEN ?? "";
  const sep = path.includes("?") ? "&" : "?";
  return token ? `${base}${path}${sep}token=${encodeURIComponent(token)}` : `${base}${path}`;
}

interface WakeResponse {
  status?: string; // warming | ready
  state?: string; // ec2 state
  ip?: string | null;
}

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
    const st = (await fetchJson(routerUrl("/status")).catch(() => ({}))) as WakeResponse;
    if (st.state === "running" && st.ip) {
      cachedIp = st.ip;
      cachedAt = Date.now();
      return st.ip;
    }
  }
  throw new Error("video_wake_timeout");
}

// Returns the base URL (scheme://host:8188, no trailing slash) for the video box.
export async function resolveVideoBaseUrl(): Promise<string> {
  const staticUrl = process.env.POPPY_WAN_URL;
  if (staticUrl) return staticUrl.replace(/\/$/, "");
  if (!process.env.POPPY_VIDEO_ROUTER_URL) throw new Error("video_not_configured");
  const ip = await ensureAwakeIp();
  return `http://${ip}:${VIDEO_PORT}`;
}

// Test/ops hook: drop the cached IP so the next call re-resolves via the router.
export function _resetVideoEndpointCache(): void {
  cachedIp = null;
  cachedAt = 0;
}
