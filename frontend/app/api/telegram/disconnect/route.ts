import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  const cookie = req.headers.get("cookie") ?? "";
  const characterId = typeof body["characterId"] === "string" ? body["characterId"] : "";

  const backendRes = await fetch(`${BACKEND_URL}/telegram/link/${characterId}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  const data = await backendRes.json().catch(() => ({}));
  return NextResponse.json(data, { status: backendRes.status });
}
