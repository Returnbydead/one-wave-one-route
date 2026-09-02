import assert from "node:assert/strict";
import test from "node:test";
import {
  KOLI_AUDIT_COLUMNS,
  KOLI_AUDIT_DATASET_ID,
  chunkKoliAuditRows,
  normalizeKoliAuditRow,
} from "../supabase/functions/_shared/koli-audit-source.mjs";

test("koli sync targets the verified Superset dataset and only valid destination columns", () => {
  assert.equal(KOLI_AUDIT_DATASET_ID, 323);
  assert.equal(KOLI_AUDIT_COLUMNS.includes("destination_location_id"), false);
  assert.equal(KOLI_AUDIT_COLUMNS.includes("destination_id"), true);
  assert.equal(KOLI_AUDIT_COLUMNS.includes("destination_location_name"), true);
});

test("large koli snapshots are published in bounded database transactions", () => {
  const rows = Array.from({ length: 2_501 }, (_, index) => ({ index }));
  const chunks = chunkKoliAuditRows(rows, 1_000);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [1_000, 1_000, 501]);
});

test("koli source row keeps a useful hub label from destination name", () => {
  assert.deepEqual(normalizeKoliAuditRow({
    koli_code: "K202609020001",
    so_number: "INV/SO/20260902/125/6499506",
    product_sku_number: "899123",
    product_name: "Beras Ramos 5KG",
    request_quantity: 2,
    "fsoid.status": "LOADING",
    destination_id: 125,
    destination_location_name: "MTH - Menteng",
  }), {
    koli_code: "K202609020001",
    so_number: "INV/SO/20260902/125/6499506",
    sku: "899123",
    product_name: "Beras Ramos 5KG",
    expected_qty: 2,
    source_status: "LOADING",
    destination_id: "125",
    destination_name: "MTH - Menteng",
    hub_code: "MTH",
  });
});
