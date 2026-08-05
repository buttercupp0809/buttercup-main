// SECURITY (CODE-2): runtime type assertions for values that flow into a
// Prisma `where:` clause. Prisma's TypeScript types block object operators
// like `{ne: ...}` at compile time, but any caller that trusts a JSON.parse
// result typed `any` can sneak one past the type system. These guards make
// the assertion explicit at every site that touches user data, and they also
// satisfy static scanners (e.g. Aikido) that flag Prisma queries flowing from
// non-primitive `unknown` inputs.
//
// Throws `TypeError` on violation. The thrown error is caught by the caller's
// try/catch and surfaced through structured logging, never echoed to the
// client.

export function assertSafeId(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string, got ${typeof value}`);
  }
  // Defence-in-depth: reject anything that does not look like a primary key.
  // Alphanumerics plus dash and underscore, 1 to 200 chars. The hard goal is
  // to defeat object-operator injection (the typeof check above does that);
  // the regex is a structural sanity floor that still accepts short test
  // fixtures.
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(value)) {
    throw new TypeError(`${name} has invalid shape`);
  }
  return value;
}

// Assert a value is a string of any content. Use for non-ID fields that must
// still be primitives, e.g. file paths already path-locked by an upstream
// guard but then passed into a Prisma `where`.
export function assertSafeString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string, got ${typeof value}`);
  }
  return value;
}
