import { adminClient, authorizeSync, env, fetchJson, json } from "../_shared/runtime.ts";
import { operationalDate } from "../_shared/owor.ts";
import { chunkKoliAuditRows, KOLI_AUDIT_COLUMNS, KOLI_AUDIT_DATASET_ID, koliAuditWhere, normalizeKoliAuditRow } from "../_shared/koli-audit-source.mjs";

type SourceRow = Record<string, unknown>;
const DATASET_NAME = "fact_supply_order_item_details";
const PAGE_SIZE = 5_000;
const MAX_PAGES = 25;
const text = (value: unknown) => String(value ?? "").trim();
const metric = (sqlExpression: string, label: string) => ({ expressionType: "SQL", sqlExpression, label, hasCustomLabel: true, optionName: `metric_${label}` });

function cookie() {
  const value = env("SUPERSET_SESSION_COOKIE").replace(/^cookie\s*:\s*/i, "");
  if (!value) throw new Error("SUPERSET_SESSION_COOKIE is missing");
  return value.includes("=") ? value : `session=${value}`;
}
async function csrf() {
  const base = env("SUPERSET_BASE_URL", "https://dash.astronauts.id").replace(/\/$/, "");
  const payload = await fetchJson(`${base}/api/v1/security/csrf_token/`, { headers: { accept: "application/json", cookie: cookie(), referer: `${base}/` } }, 30_000, 2) as { result?: string };
  if (!text(payload.result)) throw new Error("SUPERSET_CSRF_MISSING");
  return text(payload.result);
}
async function datasetId() {
  const configured = Number(env("KOLI_AUDIT_DATASET_ID", String(KOLI_AUDIT_DATASET_ID)));
  if (Number.isInteger(configured) && configured > 0) return configured;
  const base = env("SUPERSET_BASE_URL", "https://dash.astronauts.id").replace(/\/$/, "");
  const q = `(page:0,page_size:100,filters:!((col:table_name,opr:eq,value:'${DATASET_NAME}')))`;
  const payload = await fetchJson(`${base}/api/v1/dataset/?q=${encodeURIComponent(q)}`, { headers: { accept: "application/json", cookie: cookie(), referer: `${base}/` } }, 30_000, 2) as { result?: Array<{ id?: number; table_name?: string }> };
  const match = payload.result?.find((item) => text(item.table_name).toLowerCase() === DATASET_NAME);
  if (!match?.id) throw new Error("KOLI_AUDIT_DATASET_NOT_FOUND");
  return Number(match.id);
}
function rows(payload: unknown): SourceRow[] {
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.errors) && root.errors.length) throw new Error(`SUPERSET_QUERY_FAILED: ${JSON.stringify(root.errors).slice(0,300)}`);
  const rawResult = Array.isArray(root.result) ? root.result[0] : root.result;
  const result = (rawResult ?? {}) as Record<string, unknown>;
  const data = (result.data ?? result.records ?? []) as unknown[];
  const headers = (result.colnames ?? result.column_names ?? []) as string[];
  return data.map((row) => Array.isArray(row) ? Object.fromEntries(headers.map((header,index) => [header,row[index]])) : row as SourceRow);
}
function payload(dataset: number,date: string,offset: number) {
  const columns = KOLI_AUDIT_COLUMNS;
  const requestQty = metric("SUM(request_quantity)","request_quantity");
  const query = { annotation_layers: [],applied_time_extras: {},columns,custom_form_data: {},custom_params: {},extras: { having: "",where: koliAuditWhere() },filters: [{ col: "origin_id", op: "IN", val: ["819"] }, { col: "unloading_status", op: "NOT IN", val: ["COMPLETED"] }],metrics: [requestQty],order_desc: false,orderby: [],post_processing: [],row_limit: PAGE_SIZE,row_offset: offset,series_limit: 0,time_offsets: [],url_params: { datasource_id: String(dataset),datasource_type: "table" } };
  return { datasource: { id: dataset,type: "table" },force: true,queries: [query],form_data: { datasource: `${dataset}__table`,viz_type: "table",query_mode: "aggregate",groupby: columns,metrics: [requestQty],adhoc_filters: [],row_limit: PAGE_SIZE,row_offset: offset },result_format: "json",result_type: "results" };
}

Deno.serve(async (req) => {
  if (req.method!=="POST") return json(405,{ ok:false,error:"METHOD_NOT_ALLOWED" });
  if (!authorizeSync(req)) return json(401,{ ok:false,error:"UNAUTHORIZED" });
  const body = await req.json().catch(() => ({})) as { date?: string };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text(body.date)) ? text(body.date) : operationalDate();
  try {
    const [token,id] = await Promise.all([csrf(),datasetId()]);
    const base = env("SUPERSET_BASE_URL","https://dash.astronauts.id").replace(/\/$/,"");
    const source: Record<string,unknown>[] = [];
    let completed=false;
    for (let page=0;page<MAX_PAGES;page+=1) {
      const response = await fetchJson(`${base}/api/v1/chart/data`,{ method:"POST",headers:{ accept:"application/json","content-type":"application/json",cookie:cookie(),referer:`${base}/`,"x-csrftoken":token },body:JSON.stringify(payload(id,date,page*PAGE_SIZE)) },50_000,2);
      const pageRows=rows(response);
      source.push(...pageRows.map((row) => {
        const normalized = normalizeKoliAuditRow(row);
        return { ...normalized, destination_location_id: normalized.hub_code };
      }).filter((row) => row.koli_code && row.so_number && row.sku && Number.isFinite(row.expected_qty) && row.expected_qty>=0));
      if (pageRows.length<PAGE_SIZE) { completed=true; break; }
    }
    if (!completed) throw new Error("KOLI_AUDIT_PAGE_LIMIT_REACHED");
    const db=adminClient();
    const published = { tasks: 0, lines: 0, batches: 0 };
    for (const batch of chunkKoliAuditRows(source, 1_000)) {
      const { data,error }=await db.rpc("owor_publish_koli_audit_snapshot",{ p_operational_date:date,p_rows:batch });
      if (error) throw error;
      const result = (data ?? {}) as { tasks?: number; lines?: number };
      published.tasks += Number(result.tasks ?? 0);
      published.lines += Number(result.lines ?? 0);
      published.batches += 1;
    }
    return json(200,{ ok:true,dataset:DATASET_NAME,datasetId:id,sourceRows:source.length,result:{ ...published, operationalDate:date } });
  } catch (error) {
    console.error("sync-koli-audit failed", error);
    const message=String((error as { message?:string })?.message||error).replace(/cookie\s*[:=].*/ig,"cookie=[REDACTED]").slice(0,500);
    return json(502,{ ok:false,error:message,operationalDate:date });
  }
});
