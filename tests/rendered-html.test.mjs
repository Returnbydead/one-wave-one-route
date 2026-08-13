import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ONE WAVE ONE ROUTE dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ONE WAVE ONE ROUTE · CBT<\/title>/i);
  assert.match(html, /ONE WAVE/);
  assert.match(html, /ONE ROUTE/);
  assert.match(html, /Connecting live data/);
  assert.match(html, /Generate assignment/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps the V1 assignment and CSV contracts explicit", async () => {
  const [page, layout, packageJson, roster] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/picker-roster.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /"SWL - PSG"/);
  assert.match(page, /"CSA - KLD"/);
  assert.doesNotMatch(page, /SMN|MRY/);
  assert.match(page, /"BSX"/);
  assert.match(page, /"CPT - PPL"/);
  assert.match(page, /"RDS - SLP"/);
  assert.match(page, /"JLB"/);
  assert.match(page, /Assign by route/);
  assert.match(page, /Assign by zone/);
  assert.match(page, /mode === "zone"\s*\? `\$\{normalizedZone\(order\.zone\)\}::\$\{staffId\}`/);
  assert.match(page, /buildManualAssignments\(ordersData, manualOverrides, pickerRoster, assignmentMode\)/);
  assert.match(page, /Pilih zone lintas route/i);
  assert.match(page, /Semua zone/i);
  assert.match(page, /aria-label="Pilih zone assignment"/);
  assert.match(page, /mpRequired: Math\.ceil\(current\.qty \/ productivity\)/);
  assert.match(page, /\{number\(item\.qty\)\} QTY/);
  assert.match(page, /\{item\.mpRequired\} MP/);
  assert.match(page, /error_message;so_id;staff_id/);
  assert.match(page, /↓ Locked only \(\{lockedSoCount\}\)/);
  assert.match(page, /item\.source === source/);
  assert.match(page, /source === "manual" \? "-locked"/);
  assert.match(page, /Manual SO assignment/);
  assert.match(page, /manualOverrides\[order\.soNumber\]/);
  assert.match(page, /Manual lock selalu menang atas auto-assignment/);
  assert.match(page, /Assign \{selectedOrders\.length \|\| "selected"\} SO to/);
  assert.match(page, /Paste multiple Staff ID/);
  assert.match(page, /\/api\/live/);
  assert.match(page, /Live Superset \+ GSheet/);
  assert.match(page, /Last snapshot · sync paused/);
  assert.match(page, /payload\.stale/);
  assert.match(page, /Live picking monitor/);
  assert.match(page, /picker\.activities\.map/);
  assert.match(page, /activity\.pickedQty/);
  assert.match(page, /activity\.remainingQty/);
  assert.match(page, /selectedPickerIds/);
  assert.equal((roster.match(/"staffId":/g) ?? []).length, 228);
  assert.match(roster, /Muhammad Faris Gumay/);
  assert.match(roster, /Jonathan Syah Romadhanu/);
  assert.match(
    page,
    /Math\.ceil\(totalQty \/ Math\.max\(1, rule\?\.productivity \?\? 2000\)\)/,
  );
  assert.match(layout, /ONE WAVE ONE ROUTE · CBT/);
  assert.doesNotMatch(page + layout, /Ã|Â|â[\u0080-\u00BF]|à¸|�/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("keeps the Superset backend atomic per SO and origin rack zone", async () => {
  const backend = await readFile(new URL("../backend/Code.gs", import.meta.url), "utf8");
  for (const hub of ["SWL", "PSG", "CSA", "KLD", "BSX", "CPT", "PPL", "RDS", "SLP", "JLB"]) {
    assert.match(backend, new RegExp(`\\b${hub}\\b`));
  }
  assert.doesNotMatch(backend, /SMN|MRY/);
  assert.match(backend, /origin_rack_name/);
  assert.match(backend, /parsed_zone/);
  assert.match(backend, /ZONE_CONFLICT/);
  assert.match(backend, /OWOR SO CONFLICTS/);
  assert.match(backend, /OWOR PICKING MONITOR/);
  assert.match(backend, /SUM\(incoming_quantity\)/);
  assert.match(backend, /picking_start_at/);
  assert.match(backend, /picking_end_at/);
  assert.match(backend, /normalizePicking_/);
  assert.doesNotMatch(backend, /Object\.keys\(order\.zones\)\.sort/);
});

test("keeps scheduled sync within the UrlFetch daily budget", async () => {
  const backend = await readFile(new URL("../backend/Code.gs", import.meta.url), "utf8");

  assert.match(backend, /everyMinutes\(15\)/);
  assert.doesNotMatch(backend, /everyMinutes\(5\)/);
  assert.match(backend, /SYNC_WINDOW_START_HOUR:\s*4/);
  assert.match(backend, /SYNC_WINDOW_END_HOUR:\s*20/);
  assert.match(backend, /nextScheduledSource_/);
  assert.match(backend, /source === 'orders' \|\| source === 'all'/);
  assert.match(backend, /source === 'picking' \|\| source === 'all'/);
  assert.match(backend, /QUOTA_PAUSED/);
  assert.match(backend, /quotaCooldownActive_/);
  assert.match(backend, /isQuotaError_/);
  assert.match(backend, /last valid snapshot retained/i);
  assert.match(backend, /snapshotRowCount_/);
  assert.match(backend, /snapshotGeneratedAt_/);
});

