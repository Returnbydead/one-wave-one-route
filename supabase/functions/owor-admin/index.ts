import { adminClient, clean, corsHeaders, env, json } from "../_shared/runtime.ts";
import { checksum, operationalDate } from "../_shared/owor.ts";

const ALLOWED_ROLES = new Set(["DEVELOPER", "STAGING_HELPER", "LINE_HELPER", "CONSOLIDATE_PICKER", "CONSOLIDATOR"]);

function emailForStaff(staffId: string) {
  return `${staffId.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@owor.local`;
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

async function tryBootstrap(req: Request, body: Record<string, unknown>) {
  if (req.method !== "POST" || clean(body.action).toLowerCase() !== "bootstrap") return null;
  const expected = env("OWOR_MANUAL_SYNC_SECRET");
  const supplied = req.headers.get("x-owor-bootstrap-secret")?.trim() ?? "";
  if (!expected || !supplied || !constantTimeEqual(expected, supplied)) return json(401, { ok: false, error: "UNAUTHENTICATED" });
  const db = adminClient();
  const { count, error: countError } = await db.from("owor_user_profiles").select("user_id", { count: "exact", head: true });
  if (countError) throw countError;
  if ((count ?? 0) > 0) return json(409, { ok: false, error: "BOOTSTRAP_ALREADY_COMPLETED" });
  const staffId = clean(body.staffId).toUpperCase();
  const name = clean(body.name);
  const password = String(body.password ?? "");
  if (!staffId || !name || password.length < 12) return json(400, { ok: false, error: "INVALID_BOOTSTRAP_USER" });
  const { data, error } = await db.auth.admin.createUser({
    email: emailForStaff(staffId), password, email_confirm: true,
    app_metadata: { app: "owor", staff_id: staffId, name, role: "DEVELOPER", roles: ["DEVELOPER"] },
  });
  if (error) throw error;
  return json(201, { ok: true, user: { userId: data.user.id, staffId, name, role: "DEVELOPER" } });
}

async function requireDeveloper(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("UNAUTHENTICATED");
  const db = adminClient();
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData.user) throw new Error("UNAUTHENTICATED");
  const { data: profile, error: profileError } = await db
    .from("owor_user_profiles")
    .select("user_id,staff_id,name,role,roles,active")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || !(profile.roles ?? [profile.role]).includes("DEVELOPER")) throw new Error("FORBIDDEN");
  return { db, user: userData.user, profile };
}

async function publishRoster(
  db: ReturnType<typeof adminClient>,
  body: Record<string, unknown>,
  updatedBy: string,
) {
  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  if (rawRows.length === 0 || rawRows.length > 1_000) throw new Error("INVALID_ROSTER_ROWS");
  const seen = new Set<string>();
  const rows = rawRows.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const staff_id = clean(item.staffId).replace(/\D/g, "");
    const name = clean(item.name);
    if (!/^\d{4,8}$/.test(staff_id) || !name || seen.has(staff_id)) return [];
    seen.add(staff_id);
    return [{
      staff_id,
      name,
      zone: clean(item.zone).toUpperCase() || "UNMAPPED",
      productivity: Math.max(0, Number(item.productivity ?? 0) || 0),
      shift: clean(item.shift),
      contract: clean(item.contract),
    }];
  });
  if (rows.length === 0) throw new Error("EMPTY_VALID_ROSTER");
  const requestedDate = clean(body.operationalDate);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : operationalDate();
  const { data: claim, error: claimError } = await db.rpc("owor_claim_sync", {
    p_source: "pickers",
    p_operational_date: date,
    p_lock_seconds: 120,
  });
  if (claimError) throw claimError;
  const lock = claim as { claimed?: boolean; run_id?: string } | null;
  if (!lock?.claimed || !lock.run_id) throw new Error("ROSTER_SYNC_ALREADY_RUNNING");
  const digest = await checksum(rows);
  try {
    const { data: snapshotId, error } = await db.rpc("owor_publish_pickers_snapshot", {
      p_run_id: lock.run_id,
      p_operational_date: date,
      p_generated_at: new Date().toISOString(),
      p_rows: rows,
      p_checksum: digest,
      p_metadata: { source: "google sheets read-only import", updated_by: updatedBy },
    });
    if (error) throw error;
    return { snapshotId, rowCount: rows.length, checksum: digest, operationalDate: date };
  } catch (error) {
    await db.rpc("owor_fail_sync", {
      p_run_id: lock.run_id,
      p_error_code: "ROSTER_IMPORT_FAILED",
      p_error_message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function createBulkAccounts(
  db: ReturnType<typeof adminClient>,
  body: Record<string, unknown>,
  updatedBy: string,
) {
  const rawAccounts = Array.isArray(body.accounts) ? body.accounts : [];
  if (rawAccounts.length === 0 || rawAccounts.length > 25) throw new Error("INVALID_BULK_ACCOUNTS");
  const seen = new Set<string>();
  const accounts = rawAccounts.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const staffId = clean(item.staffId).toUpperCase();
    const name = clean(item.name);
    const password = String(item.password ?? "");
    const roles = [...new Set((Array.isArray(item.roles) ? item.roles : [item.role])
      .map((roleValue) => clean(roleValue).toUpperCase())
      .filter((roleValue) => ALLOWED_ROLES.has(roleValue)))];
    if (!/^\d{4,8}$/.test(staffId) || !name || password.length < 12 || roles.length === 0 || seen.has(staffId)) return [];
    seen.add(staffId);
    return [{ staffId, name, password, roles, role: roles[0] }];
  });
  if (accounts.length !== rawAccounts.length) throw new Error("INVALID_BULK_ACCOUNT_ROW");

  const { data: existingRows, error: existingError } = await db.from("owor_user_profiles")
    .select("staff_id")
    .in("staff_id", accounts.map((account) => account.staffId));
  if (existingError) throw existingError;
  const existingIds = new Set((existingRows ?? []).map((row) => row.staff_id));
  const results: Array<{ staffId: string; status: "CREATED" | "SKIPPED_EXISTING" | "FAILED"; error?: string }> = [];

  for (const account of accounts) {
    if (existingIds.has(account.staffId)) {
      results.push({ staffId: account.staffId, status: "SKIPPED_EXISTING" });
      continue;
    }
    const { error } = await db.auth.admin.createUser({
      email: emailForStaff(account.staffId),
      password: account.password,
      email_confirm: true,
      app_metadata: { app: "owor", staff_id: account.staffId, name: account.name, role: account.role, roles: account.roles },
    });
    if (error) results.push({ staffId: account.staffId, status: "FAILED", error: error.message.slice(0, 160) });
    else results.push({ staffId: account.staffId, status: "CREATED" });
  }

  return {
    requested: accounts.length,
    created: results.filter((result) => result.status === "CREATED").length,
    skipped: results.filter((result) => result.status === "SKIPPED_EXISTING").length,
    failed: results.filter((result) => result.status === "FAILED").length,
    results,
    updatedBy,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (!["GET", "POST", "PATCH"].includes(req.method)) return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  try {
    const bootstrapBody = req.method === "POST" ? await req.clone().json().catch(() => ({})) as Record<string, unknown> : {};
    const bootstrapResponse = await tryBootstrap(req, bootstrapBody);
    if (bootstrapResponse) return bootstrapResponse;
    const { db, profile } = await requireDeveloper(req);
    if (req.method === "GET") {
      const [usersResult, headsResult, runsResult, tasksResult] = await Promise.all([
        db.from("owor_user_profiles").select("user_id,staff_id,name,role,roles,active,updated_at").order("name"),
        db.from("owor_snapshot_heads").select("source,operational_date,generated_at,row_count,checksum").order("source"),
        db.from("owor_sync_runs").select("source,operational_date,status,started_at,finished_at,fetched_rows,written_rows,checksum,error_code").order("started_at", { ascending: false }).limit(12),
        db.from("owor_helper_tasks").select("so_number", { count: "exact", head: true }),
      ]);
      if (usersResult.error) throw usersResult.error;
      if (headsResult.error) throw headsResult.error;
      if (runsResult.error) throw runsResult.error;
      if (tasksResult.error) throw tasksResult.error;
      return json(200, {
        ok: true,
        configured: true,
        accountStore: true,
        users: usersResult.data ?? [],
        snapshotHeads: headsResult.data ?? [],
        latestRuns: runsResult.data ?? [],
        helperTaskCount: tasksResult.count ?? 0,
      });
    }

    const body = req.method === "POST" ? bootstrapBody : await req.json().catch(() => ({})) as Record<string, unknown>;
    if (req.method === "POST" && clean(body.action).toLowerCase() === "bulk_create") {
      const result = await createBulkAccounts(db, body, profile.staff_id);
      return json(200, { ok: true, ...result });
    }
    if (req.method === "POST" && clean(body.action).toLowerCase() === "import_roster") {
      const result = await publishRoster(db, body, profile.staff_id);
      return json(200, { ok: true, ...result });
    }
    if (req.method === "POST" && clean(body.action).toLowerCase() === "sync") {
      const response = await fetch(`${env("SUPABASE_URL")}/functions/v1/sync-owor`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sync-secret": env("SYNC_SECRET") },
        body: JSON.stringify({ source: "all", requestedBy: profile.staff_id }),
      });
      const payload = await response.json().catch(() => ({ ok: false, error: `SYNC_HTTP_${response.status}` }));
      return json(response.status, payload);
    }
    if (req.method === "POST" && clean(body.action).toLowerCase() === "sync_consolidate") {
      const response = await fetch(`${env("SUPABASE_URL")}/functions/v1/sync-consolidate-picking`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sync-secret": env("SYNC_SECRET") },
        body: JSON.stringify({
          action: clean(body.mode).toLowerCase() === "probe" ? "probe" : "sync",
          scope: clean(body.scope).toUpperCase() || "SRA_L2_UP",
          date: clean(body.date) || undefined,
          requestedBy: profile.staff_id,
        }),
      });
      const payload = await response.json().catch(() => ({ ok: false, error: `CONSOLIDATE_SYNC_HTTP_${response.status}` }));
      return json(response.status, payload);
    }
    const staffId = clean(body.staffId).toUpperCase();
    if (!staffId || !/^[A-Z0-9._-]{2,40}$/.test(staffId)) throw new Error("INVALID_STAFF_ID");

    if (req.method === "POST") {
      const name = clean(body.name);
      const roles = [...new Set((Array.isArray(body.roles) ? body.roles : [body.role]).map((value) => clean(value).toUpperCase()).filter((value) => ALLOWED_ROLES.has(value)))];
      const role = roles[0] ?? "";
      const password = String(body.password ?? "");
      if (!name || roles.length === 0 || password.length < 8) throw new Error("INVALID_USER_DATA");
      const { data: existing, error: existingError } = await db.from("owor_user_profiles")
        .select("user_id,staff_id")
        .eq("staff_id", staffId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        const { error: authUpdateError } = await db.auth.admin.updateUserById(existing.user_id, {
          password,
          ban_duration: "none",
          app_metadata: { app: "owor", staff_id: staffId, name, role, roles },
        });
        if (authUpdateError) throw authUpdateError;
        const { error: profileUpdateError } = await db.from("owor_user_profiles")
          .update({ name, role, roles, active: true, updated_at: new Date().toISOString() })
          .eq("user_id", existing.user_id);
        if (profileUpdateError) throw profileUpdateError;
        return json(200, { ok: true, user: { userId: existing.user_id, staffId, name, role, roles, active: true }, reset: true, updatedBy: profile.staff_id });
      }
      const { data, error } = await db.auth.admin.createUser({
        email: emailForStaff(staffId),
        password,
        email_confirm: true,
        app_metadata: { app: "owor", staff_id: staffId, name, role, roles },
      });
      if (error) throw error;
      return json(201, { ok: true, user: { userId: data.user.id, staffId, name, role, roles, active: true }, updatedBy: profile.staff_id });
    }

    const active = body.active === true;
    const { data: target, error: targetError } = await db.from("owor_user_profiles")
      .select("user_id,staff_id,name,role,roles")
      .eq("staff_id", staffId)
      .maybeSingle();
    if (targetError || !target) throw new Error("USER_NOT_FOUND");
    if (target.user_id === profile.user_id) throw new Error("CANNOT_DISABLE_SELF");
    const { error: authError } = await db.auth.admin.updateUserById(target.user_id, {
      ban_duration: active ? "none" : "876000h",
      app_metadata: { app: "owor", staff_id: target.staff_id, name: target.name, role: target.role, roles: target.roles ?? [target.role] },
    });
    if (authError) throw authError;
    const { error: profileUpdateError } = await db.from("owor_user_profiles")
      .update({ active, updated_at: new Date().toISOString() })
      .eq("user_id", target.user_id);
    if (profileUpdateError) throw profileUpdateError;
    return json(200, { ok: true, staffId, active, updatedBy: profile.staff_id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "UNAUTHENTICATED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return json(status, { ok: false, error: message.slice(0, 300) });
  }
});
