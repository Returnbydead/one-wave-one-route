import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildBulkCredentialCsv, createInitialPassword, parseBulkStaffIds } from "../app/bulk-account-core.mjs";

test("parses pasted spreadsheet or markdown staff IDs and removes duplicates", () => {
  const input = "| 42915 |\n| :---: |\n43194\n42915\ninvalid\n52016";
  assert.deepEqual(parseBulkStaffIds(input), ["42915", "43194", "52016"]);
});

test("creates a strong one-time password without embedding the staff ID", () => {
  const password = createInitialPassword(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  assert.match(password, /^Iw![A-Za-z0-9]{12}$/);
  assert.equal(password.includes("42915"), false);
});

test("credential CSV preserves multi-role values and spreadsheet characters", () => {
  const csv = buildBulkCredentialCsv([{ staffId: "42915", name: 'Picker, "A"', password: "Iw!Example123", roles: ["CONSOLIDATE_PICKER", "CONSOLIDATOR"] }]);
  assert.match(csv, /"42915","Picker, ""A""","Iw!Example123","CONSOLIDATE_PICKER \+ CONSOLIDATOR"/);
});

test("bulk account backend skips existing profiles and never returns passwords", async () => {
  const source = await readFile(new URL("../supabase/functions/owor-admin/index.ts", import.meta.url), "utf8");
  assert.match(source, /bulk_create/i);
  assert.match(source, /status:\s*"SKIPPED_EXISTING"/);
  assert.doesNotMatch(source, /results\.push\([^)]*password/is);
});

test("developer UI exposes paste, role selection, progress, and credential download", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Buat banyak akun sekaligus/);
  assert.match(page, /action:\s*"bulk_create"/);
  assert.match(page, /Download CSV lagi/);
  assert.match(page, /offset \+= 25/);
  assert.match(css, /\.bulk-account-builder/);
});
