import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mobile consolidation opens selected SO in an accessible bottom sheet", async () => {
  const [view, css] = await Promise.all([
    readFile(new URL("../app/consolidate-picking-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(view, /role="dialog"/);
  assert.match(view, /aria-modal="true"/);
  assert.match(view, /Tutup detail SO/);
  assert.match(css, /\.consolidation-mobile-backdrop/);
  assert.match(css, /position:\s*fixed/);
});

test("accounts expose multiple access roles and picking assignments use wave plus locations", async () => {
  const [page, view, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/consolidate-picking-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260827040000_multi_role_pick_assignment.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /roles:\s*UserRole\[\]/);
  assert.match(page, /type="checkbox"/);
  assert.match(view, /Assign by wave & location/);
  assert.match(view, /owor_assign_consolidate_picking/);
  assert.match(migration, /roles text\[\]/i);
  assert.match(migration, /p_waves integer\[\]/i);
  assert.match(migration, /p_locations text\[\]/i);
});
