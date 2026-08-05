// Small wrappers so route handlers stay declarative. Zod parse -> 400,
// unknown throw -> 500 without leaking the message. Never echo an untrusted
// value back in an error body.

import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...(extra ?? {}) }, { status });
}

export function jsonOk<T extends Record<string, unknown>>(body: T = {} as T, status = 200) {
  return NextResponse.json({ ok: true, ...body }, { status });
}

export async function parseJson<T extends ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  const ctype = req.headers.get("content-type") ?? "";
  if (!ctype.toLowerCase().includes("application/json")) {
    return { ok: false, response: jsonError(415, "content_type_must_be_application_json") };
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: jsonError(400, "invalid_json") };
  }
  try {
    const data = schema.parse(raw);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        ok: false,
        response: jsonError(400, "validation_failed", { issues: err.issues.map((i) => ({ path: i.path, message: i.message })) }),
      };
    }
    return { ok: false, response: jsonError(400, "invalid_input") };
  }
}
