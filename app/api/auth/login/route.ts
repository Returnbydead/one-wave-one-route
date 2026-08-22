import { NextResponse } from "next/server";
import { authenticate, createSession, isAuthConfigured, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "Login belum dikonfigurasi" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({})) as { staffId?: string; password?: string };
  const user = await authenticate(String(body.staffId || ""), String(body.password || ""));
  if (!user) return NextResponse.json({ ok: false, error: "Staff ID atau password salah" }, { status: 401 });

  const response = NextResponse.json({ ok: true, user });
  response.cookies.set(SESSION_COOKIE, await createSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
