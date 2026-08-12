import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function validEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "script.google.com" &&
      /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export async function GET() {
  const endpoint = process.env.OWOR_GAS_ENDPOINT?.trim() ?? "";
  const token = process.env.OWOR_GAS_TOKEN?.trim() ?? "";
  if (!validEndpoint(endpoint) || token.length < 24) {
    return NextResponse.json(
      { ok: false, error: "LIVE_BACKEND_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  try {
    const url = new URL(endpoint);
    url.searchParams.set("resource", "snapshot");
    url.searchParams.set("token", token);
    url.searchParams.set("t", String(Date.now()));
    const upstream = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    const raw = await upstream.text();
    if (!upstream.ok || raw.length > 2_000_000) {
      throw new Error(`GAS_HTTP_${upstream.status}`);
    }
    const payload = JSON.parse(raw) as { ok?: boolean };
    if (payload.ok !== true) {
      return NextResponse.json(payload, { status: 503 });
    }
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=0, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    const timeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return NextResponse.json(
      { ok: false, error: timeout ? "LIVE_BACKEND_TIMEOUT" : "LIVE_BACKEND_UNAVAILABLE" },
      { status: timeout ? 504 : 502 },
    );
  }
}
