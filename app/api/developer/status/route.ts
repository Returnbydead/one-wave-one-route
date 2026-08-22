import { NextRequest, NextResponse } from "next/server";
import { requireDeveloper } from "@/lib/developer-auth";
import { gasGet, gasPost, isBackendConfigured } from "@/lib/gas-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireDeveloper(request);
  if (access.response) return access.response;

  const configured = isBackendConfigured();
  if (!configured) return NextResponse.json({ ok: true, configured: false, accountStore: false });

  let health: Record<string, unknown> | null = null;
  let accountStore = false;
  let accountError = "";
  try { health = await gasGet("health"); } catch (error) { health = { ok: false, error: error instanceof Error ? error.message : "HEALTH_CHECK_FAILED" }; }
  try { await gasGet("users"); accountStore = true; } catch (error) { accountError = error instanceof Error ? error.message : "ACCOUNT_MODULE_UNAVAILABLE"; }

  return NextResponse.json({ ok: true, configured, accountStore, accountError, health });
}

export async function POST(request: NextRequest) {
  const access = await requireDeveloper(request);
  if (access.response) return access.response;
  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action !== "sync") return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
  try {
    return NextResponse.json(await gasPost("sync"));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "SYNC_FAILED" }, { status: 502 });
  }
}
