// Coarse user-agent -> device-type bucket, used only for the login-device
// tracking column shown in poppy-admin (User.lastLoginDeviceType). Kept
// deliberately dumb: three buckets + "unknown", no third-party UA parsing
// library (extra ~20kb of runtime with a large regex database, all to
// produce the same three-way bucket).
//
// The classifier is intentionally simple and forgiving:
//   - "tablet" wins over "mobile" (iPad UAs contain both keywords in some
//     versions) so a tablet is never mis-classified as a phone.
//   - Anything that looks like a bot/crawler is bucketed "unknown", not
//     "desktop", so admin filters do not see synthetic traffic as human
//     desktop logins.
//   - Empty / missing UA -> "unknown". Not throwing here is deliberate: an
//     auth surface with a missing UA must still be able to complete login;
//     the device column stays null / "unknown" instead.
export type DeviceType = "mobile" | "tablet" | "desktop" | "unknown";

const BOT_RE = /(bot|crawler|spider|crawling|fetch|preview|monitor|scanner|http-client|axios|curl|wget|python-requests|okhttp|go-http-client)/i;
const TABLET_RE = /(ipad|tablet|playbook|silk|kindle|(android(?!.*mobile)))/i;
const MOBILE_RE = /(iphone|ipod|android.*mobile|windows phone|mobile|blackberry|opera mini|iemobile)/i;

export function classifyDevice(userAgent: string | null | undefined): DeviceType {
  if (!userAgent) return "unknown";
  const ua = userAgent.trim();
  if (ua.length === 0) return "unknown";
  if (BOT_RE.test(ua)) return "unknown";
  if (TABLET_RE.test(ua)) return "tablet";
  if (MOBILE_RE.test(ua)) return "mobile";
  return "desktop";
}

// Cap the raw UA we persist. Real UAs top out around 200-300 chars; a much
// larger value is almost certainly junk / probing traffic and there is no
// admin value in storing megabytes of it per row.
const MAX_UA_LEN = 512;

export function truncateUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const trimmed = userAgent.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_UA_LEN ? trimmed.slice(0, MAX_UA_LEN) : trimmed;
}
