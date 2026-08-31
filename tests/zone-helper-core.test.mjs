import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalSoZone,
  pickerMatchesAnyZone,
  pickerMatchesZone,
} from "../app/zone-eligibility.mjs";
import {
  compareActivityTimeDesc,
  filterHelperCandidates,
  findExactHelperOrder,
  getLoadPosition,
  nextHelperTask,
} from "../app/helper-task-core.mjs";

test("maps free-form GSheet picker zones to operational SO zones", () => {
  assert.equal(canonicalSoZone("CBT-SRA1"), "SRA1");
  assert.equal(canonicalSoZone("SPR A1-1"), "SRA1");
  assert.equal(pickerMatchesZone("HR A", "HRA3"), true);
  assert.equal(pickerMatchesZone("MZC-2&3", "MZC2"), true);
  assert.equal(pickerMatchesZone("MZC-2&3", "MZC3"), true);
  assert.equal(pickerMatchesZone("SPR C1-1", "SRC1"), true);
  assert.equal(pickerMatchesZone("SPR A2-1", "SRA1"), true);
  assert.equal(pickerMatchesAnyZone("MZD-2", ["HRA1", "MZD2"]), true);
  assert.equal(pickerMatchesZone("MZD-2", "MZD1"), false);
});

test("derives head body tail from route sequence", () => {
  assert.equal(getLoadPosition("BSX", "BSX"), "HEAD");
  assert.equal(getLoadPosition("PKC - PAM", "PKC"), "TAIL");
  assert.equal(getLoadPosition("PKC - PAM", "PAM"), "HEAD");
  assert.equal(getLoadPosition("SWG - LIM - BGR3", "LIM"), "BODY");
  assert.equal(getLoadPosition("SWG - LIM - BGR3", "BGR3"), "HEAD");
});

test("requires claim and staging before locating an SO at packing line", () => {
  const claimed = nextHelperTask(null, { type: "CLAIM_STAGING", helperId: "DEV01", at: "2026-08-21T03:00:00.000Z" });
  assert.throws(() => nextHelperTask(claimed, { type: "SCAN_PACKING_LINE", barcode: "LINE-01" }), /line checker/i);
  const staged = nextHelperTask(claimed, { type: "SCAN_STAGING", barcode: "STG-MEZZANINE" });
  const lineClaimed = nextHelperTask(staged, { type: "CLAIM_LINE", helperId: "DEV02" });
  const done = nextHelperTask(lineClaimed, { type: "SCAN_PACKING_LINE", barcode: "LINE-01" });
  assert.equal(done.status, "STAGED_PACKER");
  assert.equal(done.packingLine, "LINE-01");
  assert.equal(done.stagingHelperId, "DEV01");
  assert.equal(done.lineHelperId, "DEV02");
});

test("sorts mixed live timestamp types without crashing", () => {
  const rows = [
    { id: "old", at: "2026-08-21T02:00:00.000Z" },
    { id: "new", at: Date.parse("2026-08-21T03:00:00.000Z") },
    { id: "empty", at: null },
  ];
  rows.sort((a, b) => compareActivityTimeDesc(a.at, b.at));
  assert.deepEqual(rows.map((row) => row.id), ["new", "old", "empty"]);
});

test("suggests active IWIR SO while excluding completed picking", () => {
  const orders = [
    { soNumber: "INV/SO/20260901/301/7000001", destination: "PKC", route: "PKC - PAM", zone: "MZE1", qty: 120 },
    { soNumber: "INV/SO/20260901/302/7000002", destination: "PAM", route: "PKC - PAM", zone: "MZF1", qty: 80 },
    { soNumber: "INV/SO/20260825/305/7000003", destination: "BSX", route: "BSX", zone: "SRC1", qty: 60 },
  ];
  const picking = [{ soNumber: orders[2].soNumber, status: "COMPLETED" }];

  assert.deepEqual(
    filterHelperCandidates(orders, picking, "", 20).map((order) => order.soNumber),
    [orders[0].soNumber, orders[1].soNumber],
  );
  assert.deepEqual(
    filterHelperCandidates(orders, picking, "PAM", 20).map((order) => order.soNumber),
    [orders[1].soNumber, orders[0].soNumber],
  );
  assert.equal(findExactHelperOrder(orders, "7000002")?.soNumber, orders[1].soNumber);
  assert.equal(findExactHelperOrder(orders, "7000"), undefined);
});
