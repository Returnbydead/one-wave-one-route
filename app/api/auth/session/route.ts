import { NextRequest, NextResponse } from "next/server";
import { isAuthConfigured, readSession, SESSION_COOKIE } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json({
      ok: true,
      user: { staffId: "DEV01", name: "Developer", role: "DEVELOPER" },
      configured: false,
    });
  }
  const user = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  return NextResponse.json({ ok: true, user, configured: true });
}
