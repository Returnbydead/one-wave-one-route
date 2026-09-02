import assert from "node:assert/strict";
import test from "node:test";
import { balanceLocationsByQty, extractHubCode, normalizeConsolidateRows, parsePickingArea } from "../supabase/functions/_shared/owor-consolidate.mjs";

test("parses SPR picking areas into extensible SR zone families", () => {
  assert.deepEqual(parsePickingArea("SPR A2-1"), { pickingAreaName: "SPR A2-1", zoneFamily: "SRA", floorNumber: 2, subAreaNumber: 1 });
  assert.equal(parsePickingArea("SPR B3-2")?.zoneFamily, "SRB");
  assert.equal(parsePickingArea("MZA1"), null);
});
test("extracts the longest mapped hub code", () => {
  assert.equal(extractHubCode("CBT - BGR3", ["BGR", "BGR3"]), "BGR3");
  assert.equal(extractHubCode("Destination PPL", ["PPL"]), "PPL");
});
test("trial only includes SRA level 2+ and waves above one", () => {
  const base = { so_number: "INV/SO/20260826/1", destination_name: "CBT - PPL", origin_rack_name: "CBT-SRA2", sku_number: "SKU-1", product_name: "Item", request_qty: 4 };
  const result = normalizeConsolidateRows([
    { ...base, picking_area_name: "SPR A2-1" },
    { ...base, so_number: "INV/SO/20260826/2", picking_area_name: "SPR A1-1" },
    { ...base, so_number: "INV/SO/20260826/3", destination_name: "CBT - SWL", picking_area_name: "SPR A3-1" },
    { ...base, so_number: "INV/SO/20260826/4", picking_area_name: "SPR B3-1" },
    { ...base, so_number: "INV/SO/20260826/5", destination_name: "UNKNOWN", picking_area_name: "SPR A2-1" },
  ], { PPL: 2, SWL: 1 }, { zoneFamily: "SRA", minLevel: 2 });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].hub_code, "PPL");
  assert.equal(result.diagnostics.excludedArea, 2);
  assert.equal(result.diagnostics.excludedWave1, 1);
  assert.equal(result.diagnostics.unmappedWave, 1);
});

test("keeps per-SO allocations while merging duplicate source fragments", () => {
  const common = { destination_name: "PPL", picking_area_name: "SPR A2-1", origin_rack_name: "CBT-SRA2-01", sku_number: "SKU-1", product_name: "Item" };
  const result = normalizeConsolidateRows([
    { ...common, so_number: "SO-1", request_qty: 2 },
    { ...common, so_number: "SO-1", request_qty: 3 },
    { ...common, so_number: "SO-2", request_qty: 4 },
  ], { PPL: 2 }, { zoneFamily: "SRA", minLevel: 2 });
  assert.deepEqual(result.rows.map((row) => [row.so_number, row.request_qty]), [["SO-1", 5], ["SO-2", 4]]);
});

test("uses the current route metadata and still excludes wave one", () => {
  const base = { picking_area_name: "SPR A2-1", origin_rack_name: "CBT-SRA2-01", sku_number: "SKU-1", product_name: "Item", request_qty: 4 };
  const result = normalizeConsolidateRows([
    { ...base, so_number: "SO-W2", destination_name: "CBT - KLN" },
    { ...base, so_number: "SO-W1", destination_name: "CBT - PAM" },
  ], {
    KLN: { waveNumber: 2, routeCode: "PGD - KLN" },
    PAM: { waveNumber: 1, routeCode: "PKC - PAM" },
  }, { zoneFamily: "SRA", minLevel: 2 });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].route_code, "PGD - KLN");
  assert.equal(result.rows[0].wave_number, 2);
  assert.equal(result.diagnostics.excludedWave1, 1);
});

test("balances whole locations by total qty across selected pickers", () => {
  const result = balanceLocationsByQty([
    { origin_rack_name: "LOC-A", request_qty: 100 },
    { origin_rack_name: "LOC-B", request_qty: 80 },
    { origin_rack_name: "LOC-C", request_qty: 20 },
    { origin_rack_name: "LOC-D", request_qty: 10 },
  ], ["P1", "P2"]);

  assert.equal(result.length, 2);
  assert.deepEqual(result.flatMap((item) => item.locations).sort(), ["LOC-A", "LOC-B", "LOC-C", "LOC-D"]);
  assert.deepEqual(result.map((item) => item.totalQty).sort((a, b) => a - b), [100, 110]);
});

test("does not create empty picker assignments", () => {
  const result = balanceLocationsByQty([{ origin_rack_name: "LOC-A", request_qty: 5 }], ["P1", "P2"]);
  assert.deepEqual(result, [{ pickerId: "P1", locations: ["LOC-A"], totalQty: 5 }]);
});
