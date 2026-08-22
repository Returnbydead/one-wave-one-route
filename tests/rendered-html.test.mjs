import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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

test("exports CSV rows only for manually locked SO", async () => {
  const { buildLockedCsv } = await import(new URL("../app/assignment-csv.ts", import.meta.url));
  const csv = buildLockedCsv(
    [
      {
        source: "auto",
        picker: { staffId: "11111" },
        orders: [{ soNumber: "INV/SO/20260821/301/7000001", route: "SWL - PSG" }],
      },
      {
        source: "manual",
        picker: { staffId: "52016" },
        orders: [{ soNumber: "INV/SO/20260821/301/7000002", route: "SWL - PSG" }],
      },
      {
        source: "manual",
        picker: { staffId: "49605" },
        orders: [{ soNumber: "INV/SO/20260821/305/7000003", route: "BSX" }],
      },
    ],
    "SWL - PSG",
  );

  assert.equal(csv, "\ufefferror_message;so_id;staff_id\n;7000002;52016");
});

test("renders assignment, manpower, picking, and helper task as separate menu views", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /aria-label="Buka menu assignment"/);
  assert.match(html, /aria-label="Buka menu manpower"/);
  assert.match(html, /aria-label="Buka menu picking monitor"/);
  assert.match(html, /aria-label="Buka menu helper task"/);
  assert.match(html, /data-workspace-view="assignment"/);
  assert.match(html, />Assignment preview</);
  assert.doesNotMatch(html, />Manpower by zone</);
  assert.doesNotMatch(html, />Live picking monitor</);
  assert.doesNotMatch(html, />Completed picking queue</);
});

test("keeps the V1 assignment and CSV contracts explicit", async () => {
  const [page, layout, packageJson, roster, csv] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/picker-roster.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/assignment-csv.ts", import.meta.url), "utf8"),
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
  assert.match(csv, /error_message;so_id;staff_id/);
  assert.match(page, /Download manual locked CSV \(\{lockedSoCount\}\)/);
  assert.match(page, /downloadLockedCsv\(assignments/);
  assert.doesNotMatch(page, /downloadCsv\(/);
  assert.doesNotMatch(page, /Download all routes/);
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
  assert.match(page, /Completed picking queue/);
  assert.match(page, /owor-helper-task-pilot-v1/);
  assert.match(page, /STG-MEZZANINE/);
  assert.match(page, /STG-SPR/);
  assert.match(page, /Barang sudah di staging packer/);
  assert.match(page, /Zone match \(\{eligiblePickers\.length\}\)/);
  assert.match(page, /Semua picker \(\{searchedPickers\.length\}\)/);
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

test("excludes cancelled SO from the assignment snapshot query", async () => {
  const backend = await readFile(new URL("../backend/Code.gs", import.meta.url), "utf8");
  let capturedRequest;
  const context = {
    UrlFetchApp: {
      fetch(url, options) {
        capturedRequest = { url, options };
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ result: [{ data: [] }] }),
        };
      },
    },
  };

  vm.runInNewContext(`${backend}\n;globalThis.fetchAssignmentRows = fetchSupersetRows_;`, context);
  context.fetchAssignmentRows("session=test");

  const payload = JSON.parse(capturedRequest.options.payload);
  assert.deepEqual(
    JSON.parse(JSON.stringify(payload.queries[0].filters)),
    [{ col: "status", op: "NOT IN", val: ["CANCELLED"] }],
  );
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

