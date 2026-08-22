import { NextRequest, NextResponse } from "next/server";
import { isAuthConfigured, readSession, SESSION_COOKIE } from "./lib/auth";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function proxy(request: NextRequest) {
  if (!isAuthConfigured()) return NextResponse.next();

  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login" && session) return NextResponse.redirect(new URL("/", request.url));
  if (isPublic) return NextResponse.next();
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|og.png).*)"],
};
