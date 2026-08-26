import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("latest Supabase helper flow exposes mobile camera scanning", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(page, /aria-label="Buka kamera scan barcode SO"/);
  assert.match(page, /aria-label="Buka kamera scan lokasi"/);
  assert.match(page, /supabase\.rpc\("owor_apply_helper_action"/);
  assert.match(page, /type HelperRole = "STAGING_HELPER" \| "LINE_HELPER"/);
});
