import {
  adminClient, authorizeSync, env, fetchJson, json,
} from "../_shared/runtime.ts";
import {
  checksum, compactDate, normalizeOrders, normalizePicking, operationalDate, OWOR_DESTINATIONS,
} from "../_shared/owor.ts";

type Source = "orders" | "picking" | "pickers";
type Claim = { claimed: boolean; run_id?: string; active_run_id?: string };

const PAGE_SIZE = 5_000;
const MAX_PAGES = 5;
const DATASET_ORDERS = 400;
const DATASET_PICKING = 108;

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

function authorizeOwor(req: Request): boolean {
  if (authorizeSync(req)) return true;
  const expected = env("OWOR_MANUAL_SYNC_SECRET");
  const supplied = req.headers.get("x-owor-sync-secret")?.trim() ?? "";
  return Boolean(expected && supplied && constantTimeEqual(expected, supplied));
}

function supersetCookie(): string {
  const rawCookie = env("SUPERSET_SESSION_COOKIE").replace(/^cookie\s*:\s*/i, "");
  if (!rawCookie) throw new Error("SUPERSET_SESSION_COOKIE is missing");
  return rawCookie.includes("=") ? rawCookie : `session=${rawCookie}`;
}

function supersetHeaders(csrf: string): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    cookie: supersetCookie(),
    referer: `${env("SUPERSET_BASE_URL", "https://dash.astronauts.id").replace(/\/$/, "")}/`,
    "x-csrftoken": csrf,
  };
  return headers;
}

function safeSupersetDiagnostics() {
  const base = env("SUPERSET_BASE_URL", "https://dash.astronauts.id");
  const rawCookie = env("SUPERSET_SESSION_COOKIE").replace(/^cookie\s*:\s*/i, "");
  let baseHost = "invalid";
  let basePath = "";
  try {
    const url = new URL(base);
    baseHost = url.hostname;
    basePath = url.pathname;
  } catch {
    // Return only non-secret configuration shape.
  }
  return {
    baseHost,
    basePath,
    cookieLength: rawCookie.length,
    cookieNames: rawCookie.split(";").map((part) => part.split("=")[0].trim()).filter(Boolean).slice(0, 12),
  };
}

function destinationSql(column: string): string {
  return `CASE ${OWOR_DESTINATIONS.map((code) => `WHEN UPPER(COALESCE(${column}, '')) LIKE '%${code}%' THEN '${code}'`).join(" ")} ELSE 'OTHER' END`;
}

function column(sqlExpression: string, label: string) {
  return { expressionType: "SQL", sqlExpression, label };
}

function metric(sqlExpression: string, label: string) {
  return { expressionType: "SQL", sqlExpression, label, hasCustomLabel: true, optionName: `metric_${label}` };
}

function filter(subject: string, operator: string, comparator: unknown) {
  return {
    clause: "WHERE", comparator, datasourceWarning: false, expressionType: "SIMPLE",
    filterOptionName: `filter_${subject.replace(/[^A-Za-z0-9]/g, "_")}`, isExtra: false,
    isNew: false, operator, operatorId: operator === "NOT IN" ? "NOT_IN" : operator,
    sqlExpression: null, subject,
  };
}

function rowsFromSuperset(payload: unknown, fallbackHeaders: string[]): Record<string, unknown>[] {
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.errors) && root.errors.length) {
    throw new Error(`SUPERSET_QUERY_FAILED: ${JSON.stringify(root.errors).slice(0, 300)}`);
  }
  const rawResult = Array.isArray(root.result) ? root.result[0] : root.result;
  const result = (rawResult ?? {}) as Record<string, unknown>;
  const rows = (result.data ?? result.records ?? []) as unknown[];
  const headers = (result.colnames ?? result.column_names ?? fallbackHeaders) as string[];
  if (!Array.isArray(rows)) throw new Error("SUPERSET_RESULT_MISSING");
  return rows.map((row) => {
    if (!Array.isArray(row)) return row as Record<string, unknown>;
    return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
  });
}

function queryPayload(source: "orders" | "picking", date: string, offset: number) {
  const isOrders = source === "orders";
  const dataset = isOrders ? DATASET_ORDERS : DATASET_PICKING;
  const destinationField = isOrders ? "destination_name_adjusted" : "destination_name";
  const destinationColumn = column(destinationSql(destinationField), "destination_code");
  const zoneExpression = isOrders
    ? "extract(origin_rack_name, '^CBT-([^-]+)')"
    : "REGEXP_EXTRACT(origin_rack_name, r'^CBT-([^-]+)')";
  const zoneColumn = column(zoneExpression, "parsed_zone");
  const destinationsWhere = OWOR_DESTINATIONS.map((code) => `UPPER(${destinationField}) LIKE '%${code}%'`).join(" OR ");
  const datePrefix = compactDate(date);
  const columns: unknown[] = isOrders
    ? ["so_number", destinationColumn, zoneColumn]
    : ["so_number", "so_status", destinationColumn, zoneColumn, "picker_name", "picker_id", "picking_start_at", "picking_end_at"];
  const metrics = isOrders
    ? [metric("SUM(request_quantity)", "request_qty"), metric("COUNT(DISTINCT sku_number)", "sku_count")]
    : [metric("SUM(request_quantity)", "request_qty"), metric("SUM(incoming_quantity)", "picked_qty"), metric("COUNT(DISTINCT sku_number)", "sku_count")];
  const simpleFilters = isOrders
    ? [{ col: "status", op: "NOT IN", val: ["CANCELLED"] }]
    : [
      { col: "origin_id", op: "IN", val: ["819"] },
      { col: "so_status", op: "NOT IN", val: ["CANCELLED"] },
      { col: "created_so_date", op: "TEMPORAL_RANGE", val: "Current day" },
      { col: "remarks", op: "IN", val: ["REGULER"] },
    ];
  const where = `so_number LIKE 'INV/SO/${datePrefix}/%' AND UPPER(COALESCE(origin_rack_name, '')) LIKE 'CBT-%' AND (${destinationsWhere})`;
  const query = {
    annotation_layers: [], applied_time_extras: {}, columns, custom_form_data: {}, custom_params: {},
    extras: { having: "", where }, filters: simpleFilters, metrics, order_desc: true, orderby: [],
    post_processing: [], row_limit: PAGE_SIZE, row_offset: offset, series_limit: 0, time_offsets: [],
    url_params: { datasource_id: String(dataset), datasource_type: "table" },
  };
  return {
    datasource: { id: dataset, type: "table" }, force: true, queries: [query],
    form_data: {
      datasource: `${dataset}__table`, viz_type: "table", query_mode: "aggregate", groupby: columns,
      metrics, adhoc_filters: simpleFilters.map((item) => filter(item.col, item.op, item.val)),
      row_limit: PAGE_SIZE, row_offset: offset,
    },
    result_format: "json", result_type: "results",
  };
}

async function fetchSupersetRows(source: "orders" | "picking", date: string): Promise<Record<string, unknown>[]> {
  const base = env("SUPERSET_BASE_URL", "https://dash.astronauts.id").replace(/\/$/, "");
  const endpoint = `${base}/api/v1/chart/data`;
  const csrfPayload = await fetchJson(`${base}/api/v1/security/csrf_token/`, {
    headers: { accept: "application/json", cookie: supersetCookie(), referer: `${base}/` },
  }, 30_000, 2) as Record<string, unknown>;
  const csrf = String(csrfPayload.result ?? "").trim();
  if (!csrf) throw new Error("SUPERSET_CSRF_MISSING");
  const fallback = source === "orders"
    ? ["so_number", "destination_code", "parsed_zone", "request_qty", "sku_count"]
    : ["so_number", "so_status", "destination_code", "parsed_zone", "picker_name", "picker_id", "picking_start_at", "picking_end_at", "request_qty", "picked_qty", "sku_count"];
  const result: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await fetchJson(endpoint, {
      method: "POST",
      headers: supersetHeaders(csrf),
      body: JSON.stringify(queryPayload(source, date, page * PAGE_SIZE)),
    }, 45_000, 2);
    const rows = rowsFromSuperset(payload, fallback);
    result.push(...rows);
    if (rows.length < PAGE_SIZE) return result;
  }
  throw new Error(`SUPERSET_${source.toUpperCase()}_PAGE_LIMIT_REACHED`);
}

async function claim(db: ReturnType<typeof adminClient>, source: Source, date: string): Promise<Claim> {
  const { data, error } = await db.rpc("owor_claim_sync", {
    p_source: source,
    p_operational_date: date,
    p_lock_seconds: 300,
  });
  if (error) throw error;
  return data as Claim;
}

async function fail(db: ReturnType<typeof adminClient>, runId: string | undefined, error: unknown) {
  if (!runId) return;
  const detail = error as { code?: string; message?: string };
  await db.rpc("owor_fail_sync", {
    p_run_id: runId,
    p_error_code: String(detail?.code || "SYNC_FAILED").slice(0, 80),
    p_error_message: String(detail?.message || error).replace(/cookie\s*[:=].*/ig, "cookie=[REDACTED]").slice(0, 500),
  });
}

async function syncOrders(db: ReturnType<typeof adminClient>, date: string) {
  const lock = await claim(db, "orders", date);
  if (!lock.claimed) return { source: "orders", status: "already_running" };
  try {
    const upstream = await fetchSupersetRows("orders", date);
    const normalized = normalizeOrders(upstream);
    const digest = await checksum(normalized);
    const generatedAt = new Date().toISOString();
    const { data, error } = await db.rpc("owor_publish_orders_snapshot", {
      p_run_id: lock.run_id,
      p_operational_date: date,
      p_generated_at: generatedAt,
      p_orders: normalized.orders,
      p_conflicts: normalized.conflicts,
      p_checksum: digest,
      p_metadata: { fetched_rows: upstream.length, conflict_rows: normalized.conflicts.length, filter: `INV/SO/${compactDate(date)}/%` },
    });
    if (error) throw error;
    return { source: "orders", status: "success", fetched: upstream.length, written: normalized.orders.length, conflicts: normalized.conflicts.length, checksum: digest, snapshotId: data };
  } catch (error) {
    await fail(db, lock.run_id, error);
    throw error;
  }
}

async function syncPicking(db: ReturnType<typeof adminClient>, date: string) {
  const lock = await claim(db, "picking", date);
  if (!lock.claimed) return { source: "picking", status: "already_running" };
  try {
    const upstream = await fetchSupersetRows("picking", date);
    const rows = normalizePicking(upstream);
    const digest = await checksum(rows);
    const generatedAt = new Date().toISOString();
    const { data, error } = await db.rpc("owor_publish_picking_snapshot", {
      p_run_id: lock.run_id,
      p_operational_date: date,
      p_generated_at: generatedAt,
      p_rows: rows,
      p_checksum: digest,
      p_metadata: { fetched_rows: upstream.length, filter: `INV/SO/${compactDate(date)}/%` },
    });
    if (error) throw error;
    return { source: "picking", status: "success", fetched: upstream.length, written: rows.length, checksum: digest, snapshotId: data };
  } catch (error) {
    await fail(db, lock.run_id, error);
    throw error;
  }
}

async function syncPickers(db: ReturnType<typeof adminClient>, date: string) {
  const endpoint = env("OWOR_ROSTER_SNAPSHOT_URL");
  const token = env("OWOR_ROSTER_SNAPSHOT_TOKEN");
  if (!endpoint || !token) return { source: "pickers", status: "not_configured" };
  const lock = await claim(db, "pickers", date);
  if (!lock.claimed) return { source: "pickers", status: "already_running" };
  try {
    const url = new URL(endpoint);
    url.searchParams.set("resource", "snapshot");
    url.searchParams.set("token", token);
    url.searchParams.set("t", String(Date.now()));
    const payload = await fetchJson(url.toString(), { headers: { accept: "application/json" }, redirect: "follow" }, 25_000, 2) as { ok?: boolean; pickers?: Record<string, unknown>[] };
    if (payload.ok !== true || !Array.isArray(payload.pickers)) throw new Error("OWOR_ROSTER_SNAPSHOT_INVALID");
    const rows = payload.pickers.map((item) => ({
      staff_id: String(item.staffId ?? "").trim(), name: String(item.name ?? "").trim(),
      zone: String(item.zone ?? "UNMAPPED").trim().toUpperCase(), productivity: Math.max(0, Number(item.productivity ?? 0)),
      shift: String(item.shift ?? "").trim(), contract: String(item.contract ?? "").trim(),
    })).filter((item) => item.staff_id && item.name);
    const digest = await checksum(rows);
    const { data, error } = await db.rpc("owor_publish_pickers_snapshot", {
      p_run_id: lock.run_id,
      p_operational_date: date,
      p_generated_at: new Date().toISOString(),
      p_rows: rows,
      p_checksum: digest,
      p_metadata: { source: "legacy compact roster only" },
    });
    if (error) throw error;
    return { source: "pickers", status: "success", written: rows.length, checksum: digest, snapshotId: data };
  } catch (error) {
    await fail(db, lock.run_id, error);
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, message: "Method not allowed" });
  if (!authorizeOwor(req)) return json(401, { ok: false, message: "Unauthorized" });
  const body = await req.json().catch(() => ({})) as { source?: string; date?: string };
  const requested = body.source === "orders" || body.source === "picking" || body.source === "pickers" ? body.source : "all";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? "")) ? String(body.date) : operationalDate();
  const db = adminClient();
  try {
    const results = [];
    if (requested === "all" || requested === "orders") results.push(await syncOrders(db, date));
    if (requested === "all" || requested === "picking") results.push(await syncPicking(db, date));
    if (requested === "all" || requested === "pickers") results.push(await syncPickers(db, date));
    await db.rpc("owor_prune_snapshots", { p_keep: 3 });
    return json(200, { ok: true, operationalDate: date, results });
  } catch (error) {
    console.error("sync-owor failed", error);
    return json(502, {
      ok: false,
      operationalDate: date,
      error: String(error instanceof Error ? error.message : error).slice(0, 500),
      lastValidSnapshotRetained: true,
      diagnostics: safeSupersetDiagnostics(),
    });
  }
});
