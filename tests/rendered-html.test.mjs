import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("statically exports the protected ONE WAVE ONE ROUTE access shell", async () => {
  const html = await readFile(new URL("../out/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>ONE WAVE ONE ROUTE · CBT<\/title>/i);
  assert.match(html, /Memuat akses workspace/);
  assert.match(html, /Role dan session sedang diverifikasi/);
  assert.doesNotMatch(html, /Generate assignment/);
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

test("renders assignment, picking, SO master, consolidate, and helper operations as separate menu views", async () => {
  const html = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(html, /aria-label="Buka menu assignment"/);
  assert.doesNotMatch(html, /aria-label="Buka menu manpower"/);
  assert.match(html, /aria-label="Buka menu picking monitor"/);
  assert.match(html, /aria-label="Buka menu SO Master"/);
  assert.match(html, /aria-label="Buka menu consolidate picking"/);
  assert.match(html, /aria-label="Buka menu staging helper"/);
  assert.match(html, /aria-label="Buka menu line checker"/);
  assert.match(html, /aria-label="Buka menu developer"/);
  assert.match(html, /authUser\.role === "DEVELOPER"/);
  assert.match(html, /setActiveView\("staging-tasks"\)/);
  assert.match(html, /setActiveView\("line-tasks"\)/);
  assert.match(html, /Developer control center/);
  assert.doesNotMatch(html, />Completed picking queue</);
});

test("keeps consolidate picking scoped to SRA level 2+ and non-wave-1 allocations", async () => {
  const [page, consolidate] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/consolidate-picking-view.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<ConsolidatePickingView user=\{authUser\} \/>/);
  assert.match(consolidate, /owor_get_consolidate_picklist/);
  assert.match(consolidate, /sync_consolidate/);
  assert.match(consolidate, /SRA · LEVEL 2\+/);
  assert.match(consolidate, /Wave 2–4 · Wave 1 dikecualikan/);
  assert.match(consolidate, /row\.allocations\.map/);
  assert.doesNotMatch(consolidate, /x-sync-secret|SUPERSET_SESSION_COOKIE/);
});

test("separates helper operations and exposes task submenus under consolidate picking", async () => {
  const [page, consolidate] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/consolidate-picking-view.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Buka menu staging helper/);
  assert.match(page, /Buka menu line checker/);
  assert.match(consolidate, /Picklist/);
  assert.match(consolidate, /Picking Task/);
  assert.match(consolidate, /Consolidation Task/);
});

test("prioritizes consolidation work by wave and exposes a developer-only task reset", async () => {
  const [page, consolidate, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/consolidate-picking-view.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../supabase/migrations/20260827030000_consolidate_wave_filter_reset.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(consolidate, /const \[waveFilter, setWaveFilter\] = useState/);
  assert.match(consolidate, /aria-label="Filter consolidation task berdasarkan wave"/);
  assert.match(consolidate, /Semua wave/);
  assert.match(consolidate, /filteredConsolidations\.map/);
  assert.match(page, /owor_reset_consolidate_tasks/);
  assert.match(page, /Reset all consolidate tasks/);
  assert.match(page, /window\.confirm/);
  assert.match(migration, /v_profile\.role <> 'DEVELOPER'/);
  assert.match(migration, /delete from public\.owor_consolidate_batches/);
  assert.match(migration, /scope_code = v_scope_code/);
});

test("keeps complete SO search separate from the IWIR assignment snapshot", async () => {
  const [page, soMaster] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/so-master-view.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<SoMasterView \/>/);
  assert.match(soMaster, /owor_search_so_master/);
  assert.match(soMaster, /owor_get_so_master_detail/);
  assert.match(soMaster, /p_page_size: PAGE_SIZE/);
  assert.match(soMaster, /const PAGE_SIZE = 50/);
  assert.match(soMaster, /Status CANCELLED tidak dimuat/);
  assert.doesNotMatch(soMaster, /owor_get_live_snapshot/);
});

test("opens SO detail as its own workspace and collapses assignment preview by zone", async () => {
  const [page, soMaster] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/so-master-view.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(soMaster, /setSelectedRow\(row\)/);
  assert.match(soMaster, /Kembali ke SO Master/);
  assert.match(soMaster, /aria-label="Bagian detail SO"/);
  assert.match(soMaster, /Detail distribusi/);
  assert.match(page, /assignmentsByZone/);
  assert.match(page, /aria-expanded=\{expanded\}/);
  assert.match(page, /Lihat MP ↓/);
});

test("keeps the V1 assignment, Supabase, and CSV contracts explicit", async () => {
  const [page, layout, nextConfig, packageJson, csv] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
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
  assert.match(page, /supabase\.rpc\("owor_get_live_snapshot"\)/);
  assert.match(page, /Live Supabase snapshot/);
  assert.match(page, /Last valid snapshot/);
  assert.match(page, /payload\.stale/);
  assert.match(page, /Live picking monitor/);
  assert.match(page, /SO yang sedang gue kerjakan/);
  assert.match(page, /role="listbox"/);
  assert.match(page, /helperSuggestionOrders/);
  assert.match(page, /Queue dari staging picking/);
  assert.match(page, /owor_helper_tasks/);
  assert.match(page, /owor_apply_helper_action/);
  assert.doesNotMatch(page, /localStorage/);
  assert.doesNotMatch(page, /activity\.status === "COMPLETED"[\s\S]{0,200}helper/i);
  assert.match(page, /STG-MEZZANINE/);
  assert.match(page, /STG-SPR/);
  assert.match(page, /Barang sudah di staging packer/);
  assert.match(page, /Staff accounts & roles/);
  assert.match(page, /Akun helper hanya mendapat menu Helper Task/);
  assert.match(page, /supabase\.functions\.invoke\("owor-admin"/);
  assert.doesNotMatch(page, /\/api\/developer\/users/);
  assert.match(page, /Zone match \(\{eligiblePickers\.length\}\)/);
  assert.match(page, /Semua picker \(\{searchedPickers\.length\}\)/);
  assert.match(page, /picker\.activities\.map/);
  assert.match(page, /activity\.pickedQty/);
  assert.match(page, /activity\.remainingQty/);
  assert.match(page, /selectedPickerIds/);
  assert.match(page, /livePickers \?\? EMPTY_PICKERS/);
  assert.match(
    page,
    /Math\.ceil\(totalQty \/ Math\.max\(1, rule\?\.productivity \?\? 2000\)\)/,
  );
  assert.match(layout, /ONE WAVE ONE ROUTE · CBT/);
  assert.match(nextConfig, /output:\s*"export"/);
  assert.match(packageJson, /@supabase\/supabase-js/);
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
  assert.match(backend, /OWOR USER ACCOUNTS/);
  assert.match(backend, /upsert_user/);
  assert.match(backend, /set_user_active/);
  assert.match(backend, /auth_user/);
  assert.doesNotMatch(backend, /Object\.keys\(order\.zones\)\.sort/);
});

test("rejects disabled legacy Supabase keys before a production build", async () => {
  const browserClient = await readFile(
    new URL("../lib/supabase-browser.ts", import.meta.url),
    "utf8",
  );

  assert.match(browserClient, /startsWith\("sb_publishable_"\)/);
  assert.match(browserClient, /Legacy Supabase API keys are not supported/);
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

