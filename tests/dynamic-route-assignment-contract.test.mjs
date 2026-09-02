import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sql = fs.readFileSync(new URL("../supabase/migrations/20260902013000_dynamic_routes_and_qty_balancing.sql", import.meta.url), "utf8");
const gas = fs.readFileSync(new URL("../backend/Code.gs", import.meta.url), "utf8");
const sync = fs.readFileSync(new URL("../supabase/functions/sync-consolidate-picking/index.ts", import.meta.url), "utf8");

test("route and wave config comes from PLAN CBT SEP 2026 through the compact GAS endpoint", () => {
  assert.match(gas, /resource === 'route_config'/);
  assert.match(gas, /readRouteConfig_/);
  assert.match(sync, /refreshRouteConfig/);
  assert.match(sync, /OWOR_ROSTER_SNAPSHOT_URL/);
  assert.match(sql, /route_code/);
  assert.match(sql, /jsonb_build_object\(\s*'waveNumber'/);
});

test("assignment allocates whole locations by current total request qty", () => {
  assert.match(sql, /sum\(r\.request_qty\) qty/);
  assert.match(sql, /order by qty desc/);
  assert.match(sql, /order by assigned_qty,u\.ordinality/);
  assert.match(sql, /if coalesce\(cardinality\(v_picker_locations\),0\)=0 then continue/);
});
