import { adminClient, authorizeSync, env, fetchJson, json } from "../_shared/runtime.ts";
import { checksum, compactDate, operationalDate } from "../_shared/owor.ts";
import { normalizeConsolidateRows } from "../_shared/owor-consolidate.mjs";

type SourceRow = Record<string, unknown>;
type Scope = { code: string; zoneFamily: string; minLevel: number; excludedWaves: number[]; enabled: boolean };

const DATASET_ORDERS = 400;
const PAGE_SIZE = 5_000;
const MAX_PAGES = 12;
const WRITE_CHUNK_SIZE = 750;
const DEFAULT_SCOPE = "SRA_L2_UP";

function text(value: unknown): string {
  return String(value ?? "").trim();
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

function supersetCookie(): string {
  const rawCookie = env("SUPERSET_SESSION_COOKIE").replace(/^cookie\s*:\s*/i, "");
  if (!rawCookie) throw new Error("SUPERSET_SESSION_COOKIE is missing");
  return rawCookie.includes("=") ? rawCookie : `session=${rawCookie}`;
}

function supersetHeaders(csrf: string): HeadersInit {
  const base = env("SUPERSET_BASE_URL", "https://dash.astronauts.id").replace(/\/$/, "");
  return { accept: "application/json", "content-type": "application/json", cookie: supersetCookie(), referer: `${base}/`, "x-csrftoken": csrf };
}

function rowsFromSuperset(payload: unknown): SourceRow[] {
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.errors) && root.errors.length) throw new Error(`SUPERSET_QUERY_FAILED: ${JSON.stringify(root.errors).slice(0, 300)}`);
  const rawResult = Array.isArray(root.result) ? root.result[0] : root.result;
  const result = (rawResult ?? {}) as Record<string, unknown>;
  const rawRows = (result.data ?? result.records ?? []) as unknown[];
  const fallback = ["so_number", "destination_name", "picking_area_name", "origin_rack_name", "sku_number", "product_name", "request_qty", "sort_key"];
  const headers = (result.colnames ?? result.column_names ?? fallback) as string[];
  if (!Array.isArray(rawRows)) throw new Error("SUPERSET_RESULT_MISSING");
  return rawRows.map((row) => Array.isArray(row) ? Object.fromEntries(headers.map((header, index) => [header, row[index]])) : row as SourceRow);
}

function queryPayload(date: string, offset: number, limit = PAGE_SIZE) {
  const destination = column("COALESCE(NULLIF(TRIM(destination_name_adjusted), ''), 'UNKNOWN')", "destination_name");
  const product = column("COALESCE(NULLIF(TRIM(product_name_adjusted), ''), NULLIF(TRIM(product_name), ''), '')", "product_name");
  const columns: unknown[] = ["so_number", destination, "picking_area_name", "origin_rack_name", "sku_number", product];
  const requestQty = metric("SUM(request_quantity)", "request_qty");
  const sortMetric = metric("MIN(CONCAT(COALESCE(picking_area_name, ''), '|', COALESCE(origin_rack_name, ''), '|', COALESCE(sku_number, ''), '|', COALESCE(so_number, '')))", "sort_key");
  const simpleFilters = [{ col: "status", op: "NOT IN", val: ["CANCELLED"] }];
  const where = `so_number LIKE 'INV/SO/${compactDate(date)}/%' AND UPPER(COALESCE(picking_area_name, '')) LIKE 'SPR A%'`;
  const query = {
    annotation_layers: [], applied_time_extras: {}, columns, custom_form_data: {}, custom_params: {},
    extras: { having: "", where }, filters: simpleFilters, metrics: [requestQty, sortMetric],
    order_desc: false, orderby: [[sortMetric, true]], post_processing: [], row_limit: limit,
    row_offset: offset, series_limit: 0, time_offsets: [],
    url_params: { datasource_id: String(DATASET_ORDERS), datasource_type: "table" },
  };
  return {
    datasource: { id: DATASET_ORDERS, type: "table" }, force: true, queries: [query],
    form_data: {
      datasource: `${DATASET_ORDERS}__table`, viz_type: "table", query_mode: "aggregate", groupby: columns,
      metrics: [requestQty, sortMetric], orderby: [[sortMetric, true]], order_desc: false,
      adhoc_filters: simpleFilters.map((item) => filter(item.col, item.op, item.val)), row_limit: limit, row_offset: offset,
    },
    result_format: "json", result_type: "results",
  };
}

async function csrfToken(): Promise<string> {
  const base = env("SUPERSET_BASE_URL", "https://dash.astronauts.id").replace(/\/$/, "");
  const payload = await fetchJson(`${base}/api/v1/security/csrf_token/`, {
    headers: { accept: "application/json", cookie: supersetCookie(), referer: `${base}/` },
  }, 30_000, 2) as Record<string, unknown>;
  const csrf = text(payload.result);
  if (!csrf) throw new Error("SUPERSET_CSRF_MISSING");
  return csrf;
}

async function fetchPage(date: string, csrf: string, offset: number, limit = PAGE_SIZE): Promise<SourceRow[]> {
  const base = env("SUPERSET_BASE_URL", "https://dash.astronauts.id").replace(/\/$/, "");
  const payload = await fetchJson(`${base}/api/v1/chart/data`, {
    method: "POST", headers: supersetHeaders(csrf), body: JSON.stringify(queryPayload(date, offset, limit)),
  }, 50_000, 2);
  return rowsFromSuperset(payload);
}

async function refreshRouteConfig(db: ReturnType<typeof adminClient>): Promise<number> {
  const endpoint = env("OWOR_ROSTER_SNAPSHOT_URL");
  const token = env("OWOR_ROSTER_SNAPSHOT_TOKEN");
  if (!endpoint || !token) return 0;
  const url = new URL(endpoint);
  url.searchParams.set("resource", "route_config");
  url.searchParams.set("token", token);
  url.searchParams.set("t", String(Date.now()));
  const payload = await fetchJson(url.toString(), { headers: { accept: "application/json" }, redirect: "follow" }, 25_000, 2) as { ok?: boolean; routes?: Record<string, unknown>[] };
  if (payload.ok !== true || !Array.isArray(payload.routes) || payload.routes.length === 0) throw new Error("OWOR_ROUTE_CONFIG_INVALID");
  const { data, error } = await db.rpc("owor_upsert_hub_wave_config", { p_rows: payload.routes });
  if (error) throw error;
  return Number(data ?? 0);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  if (!authorizeSync(req)) return json(401, { ok: false, error: "UNAUTHORIZED" });
  const body = await req.json().catch(() => ({})) as { date?: string; action?: string; scope?: string };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? "")) ? String(body.date) : operationalDate();
  const scopeCode = text(body.scope || DEFAULT_SCOPE).toUpperCase();
  const db = adminClient();
  let snapshotId = "";

  try {
    const routeRows = await refreshRouteConfig(db);
    const { data: config, error: configError } = await db.rpc("owor_get_consolidate_config", { p_scope_code: scopeCode });
    if (configError) throw configError;
    const settings = config as { scope?: Scope | null; waveMap?: Record<string, { waveNumber: number; routeCode: string }> };
    if (!settings.scope?.enabled) return json(409, { ok: false, error: "SCOPE_NOT_READY", scope: scopeCode });

    const csrf = await csrfToken();
    if (text(body.action).toLowerCase() === "probe") {
      const rows = await fetchPage(date, csrf, 0, 100);
      const areas = [...new Set(rows.map((row) => text(row.picking_area_name).toUpperCase()).filter(Boolean))].sort();
      return json(200, { ok: true, action: "probe", operationalDate: date, sourceColumn: "picking_area_name", rows: rows.length, areaSamples: areas.slice(0, 20) });
    }

    if (!settings.waveMap || Object.keys(settings.waveMap).length === 0) {
      return json(409, { ok: false, error: "WAVE_MAP_REQUIRED", message: "Isi owor_hub_wave_config sebelum publish picklist." });
    }

    const { data: claim, error: claimError } = await db.rpc("owor_begin_consolidate_snapshot", {
      p_scope_code: scopeCode, p_operational_date: date, p_generated_at: new Date().toISOString(), p_lock_seconds: 600,
    });
    if (claimError) throw claimError;
    const lock = claim as { claimed?: boolean; snapshotId?: string; activeSnapshotId?: string };
    if (!lock.claimed) return json(202, { ok: true, status: "already_running", activeSnapshotId: lock.activeSnapshotId });
    snapshotId = text(lock.snapshotId);

    const acceptedRows: Record<string, unknown>[] = [];
    const totals = { sourceRows: 0, acceptedRows: 0, excludedArea: 0, excludedWave1: 0, unmappedWave: 0, invalidRows: 0 };
    let completed = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const sourceRows = await fetchPage(date, csrf, page * PAGE_SIZE);
      const normalized = normalizeConsolidateRows(sourceRows, settings.waveMap, settings.scope);
      acceptedRows.push(...normalized.rows);
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += Number(normalized.diagnostics[key] ?? 0);
      if (sourceRows.length < PAGE_SIZE) { completed = true; break; }
    }
    if (!completed) throw new Error("SUPERSET_CONSOLIDATE_PAGE_LIMIT_REACHED");
    if (!acceptedRows.length) throw new Error(`CONSOLIDATE_RESULT_EMPTY: unmappedWave=${totals.unmappedWave}, excludedWave1=${totals.excludedWave1}`);

    let writtenRows = 0;
    for (let offset = 0; offset < acceptedRows.length; offset += WRITE_CHUNK_SIZE) {
      const { data, error } = await db.rpc("owor_append_consolidate_rows", { p_snapshot_id: snapshotId, p_rows: acceptedRows.slice(offset, offset + WRITE_CHUNK_SIZE) });
      if (error) throw error;
      writtenRows += Number(data ?? 0);
    }
    const digest = await checksum(acceptedRows);
    const { data: finalized, error: finalizeError } = await db.rpc("owor_finalize_consolidate_snapshot", {
      p_snapshot_id: snapshotId, p_checksum: digest,
      p_metadata: { source: "Superset dataset 400", route_source: routeRows > 0 ? "PLAN CBT SEP 2026 live" : "last validated PLAN CBT SEP 2026 snapshot", route_rows: routeRows, source_column: "picking_area_name", scope: settings.scope, diagnostics: totals },
    });
    if (finalizeError) throw finalizeError;
    return json(200, { ok: true, operationalDate: date, scope: settings.scope, diagnostics: totals, writtenRows, snapshot: finalized });
  } catch (error) {
    const message = String((error as { message?: string })?.message || error).replace(/cookie\s*[:=].*/ig, "cookie=[REDACTED]").slice(0, 500);
    if (snapshotId) await db.rpc("owor_fail_consolidate_snapshot", { p_snapshot_id: snapshotId, p_error_message: message });
    console.error("sync-consolidate-picking failed", error);
    return json(502, { ok: false, operationalDate: date, scope: scopeCode, error: message, lastValidSnapshotRetained: true });
  }
});
