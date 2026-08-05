// Frontend copy of the backend runtime guards. Kept identical to
// backend/src/utils/safe-types.ts so behaviour matches on both sides of the
// wire. Every user value entering a Prisma `where` on the frontend goes
// through assertSafeId or assertSafeString.

export function assertSafeId(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string, got ${typeof value}`);
  }
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(value)) {
    throw new TypeError(`${name} has invalid shape`);
  }
  return value;
}

export function assertSafeString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string, got ${typeof value}`);
  }
  return value;
}
