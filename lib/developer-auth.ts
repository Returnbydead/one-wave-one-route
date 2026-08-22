import { NextRequest, NextResponse } from "next/server";
import { readSession, SESSION_COOKIE } from "./auth";

export async function requireDeveloper(request: NextRequest) {
  const user = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return { response: NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (user.role !== "DEVELOPER") return { response: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
  return { user };
}
