import { NextRequest, NextResponse } from "next/server";
import { hashPassword, UserRole } from "@/lib/auth";
import { requireDeveloper } from "@/lib/developer-auth";
import { gasGet, gasPost } from "@/lib/gas-client";

const ROLES: UserRole[] = ["DEVELOPER", "STAGING_HELPER", "LINE_HELPER"];

export async function GET(request: NextRequest) {
  const access = await requireDeveloper(request);
  if (access.response) return access.response;
  try {
    return NextResponse.json(await gasGet("users"));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "USERS_UNAVAILABLE" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const access = await requireDeveloper(request);
  if (access.response) return access.response;
  const body = await request.json().catch(() => ({})) as { staffId?: string; name?: string; role?: UserRole; password?: string };
  const staffId = String(body.staffId || "").trim().toUpperCase();
  const name = String(body.name || "").trim();
  if (!staffId || !name || !body.role || !ROLES.includes(body.role)) {
    return NextResponse.json({ ok: false, error: "DATA_AKUN_TIDAK_LENGKAP" }, { status: 400 });
  }
  try {
    const password = await hashPassword(String(body.password || ""));
    return NextResponse.json(await gasPost("upsert_user", {
      user: { staffId, name, role: body.role, ...password, active: true },
      updatedBy: access.user.staffId,
    }));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "CREATE_USER_FAILED" }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  const access = await requireDeveloper(request);
  if (access.response) return access.response;
  const body = await request.json().catch(() => ({})) as { staffId?: string; active?: boolean };
  const staffId = String(body.staffId || "").trim().toUpperCase();
  if (!staffId || typeof body.active !== "boolean") return NextResponse.json({ ok: false, error: "INVALID_ACCOUNT_STATE" }, { status: 400 });
  if (staffId === access.user.staffId && !body.active) return NextResponse.json({ ok: false, error: "AKUN_SENDIRI_TIDAK_BISA_DINONAKTIFKAN" }, { status: 400 });
  try {
    return NextResponse.json(await gasPost("set_user_active", { staffId, active: body.active, updatedBy: access.user.staffId }));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "UPDATE_USER_FAILED" }, { status: 502 });
  }
}
