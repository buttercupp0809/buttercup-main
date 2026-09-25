import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ characterId: string }> },
): Promise<NextResponse> {
  const { characterId } = await params;
  const cookie = req.headers.get("cookie") ?? "";
  const backendRes = await fetch(
    `${BACKEND_URL}/telegram/status/${characterId}`,
    { headers: { Cookie: cookie } },
  );
  const data = await backendRes.json().catch(() => ({}));
  return NextResponse.json(data, { status: backendRes.status });
}
