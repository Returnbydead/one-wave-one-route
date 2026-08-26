import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("logout is single-flight and exits the authenticated app with one hard navigation", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /const \[logoutPending, setLogoutPending\] = useState\(false\)/);
  assert.match(page, /if \(logoutPending\) return/);
  assert.match(page, /setAuthReady\(false\)/);
  assert.match(page, /window\.location\.replace\("\/login\/"\)/);
  assert.doesNotMatch(page, /async function logout\(\)[\s\S]*?router\.replace\("\/login\/"\)/);
});
