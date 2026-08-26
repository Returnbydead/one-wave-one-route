import assert from "node:assert/strict";
import test from "node:test";

import { advanceBatch, advanceConsolidation, batchProgress } from "../app/consolidate-task-core.mjs";

test("picker claims a ready batch and completes it only after every pick row is done", () => {
  assert.equal(advanceBatch({ status: "READY", totalLines: 3, completedLines: 0 }, "CLAIM_PICKING"), "IN_PROGRESS");
  assert.throws(
    () => advanceBatch({ status: "IN_PROGRESS", totalLines: 3, completedLines: 2 }, "COMPLETE_PICKING"),
    /PICK_ROWS_INCOMPLETE/,
  );
  assert.equal(advanceBatch({ status: "IN_PROGRESS", totalLines: 3, completedLines: 3 }, "COMPLETE_PICKING"), "PICKING_COMPLETED");
});
test("consolidation task is claimable only after batch picking completes", () => {
  assert.throws(() => advanceConsolidation("WAITING_PICKING", "CLAIM_CONSOLIDATION"), /PICKING_NOT_COMPLETED/);
  assert.equal(advanceConsolidation("READY", "CLAIM_CONSOLIDATION"), "CONSOLIDATING");
  assert.equal(advanceConsolidation("CONSOLIDATING", "COMPLETE_CONSOLIDATION"), "CONSOLIDATED");
});

test("batch progress reports mobile task completion using known quantities", () => {
  assert.deepEqual(batchProgress([
    { totalQty: 5, pickedQty: 5 },
    { totalQty: 22, pickedQty: 10 },
    { totalQty: 30, pickedQty: 0 },
  ]), { totalLines: 3, completedLines: 1, totalQty: 57, pickedQty: 15, percent: 26 });
});
