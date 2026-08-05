// Frontend-wide constants. Kept in one place so cookie names, TTLs, and JWT
// scopes cannot drift between the auth lib and the middleware.

export const AUTH_COOKIE = "poppy_auth";

// One week. Short enough that stolen tokens age out, long enough that users
// are not forced to log in every day. Extend/refresh flow lands in a later
// phase; today the cookie is a static maxAge.
export const TOKEN_MAX_AGE = 60 * 60 * 24 * 7;

// Magic link TTL: 15 minutes. Single-use, SHA-256 hashed at rest.
export const MAGIC_LINK_TTL_S = 15 * 60;

// Reset token TTL: 1 hour.
export const RESET_MAX_AGE = 60 * 60;

export const JWT_ISSUER = "poppy";
export const JWT_AUD_AUTH = "poppy:auth";
export const JWT_AUD_RESET = "poppy:reset";
export const JWT_AUD_MAGIC = "poppy:magic";

// Origins the app itself calls (auth cookie is same-site Lax so this is
// primarily for CORS on /api). NEXT_PUBLIC_APP_URL is the source of truth.
export const ALLOWED_ORIGINS: readonly string[] = [
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
];

// Paths that require a valid auth cookie. Middleware redirects unauthenticated
// visitors to /login. The AGE GATE check happens in the (protected) layout via
// requireAgeVerified(), NOT in middleware, because edge cannot reach Prisma.
export const PROTECTED_PATH_PREFIXES = [
  "/dashboard",
  "/chat",
  "/create",
  "/characters",
  "/settings",
] as const;
