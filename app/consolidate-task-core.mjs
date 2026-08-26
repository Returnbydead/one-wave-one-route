export function advanceBatch(batch, action) {
  const status = String(batch?.status || "").toUpperCase();
  const event = String(action || "").toUpperCase();
  if (event === "CLAIM_PICKING") {
    if (status !== "READY") throw new Error("BATCH_NOT_READY");
    return "IN_PROGRESS";
  }
  if (event === "COMPLETE_PICKING") {
    if (status !== "IN_PROGRESS") throw new Error("BATCH_NOT_IN_PROGRESS");
    if (Number(batch?.completedLines || 0) !== Number(batch?.totalLines || 0)) throw new Error("PICK_ROWS_INCOMPLETE");
    return "PICKING_COMPLETED";
  }
  throw new Error("INVALID_BATCH_ACTION");
}

export function advanceConsolidation(status, action) {
  const current = String(status || "").toUpperCase();
  const event = String(action || "").toUpperCase();
  if (event === "CLAIM_CONSOLIDATION") {
    if (current === "WAITING_PICKING") throw new Error("PICKING_NOT_COMPLETED");
    if (current !== "READY") throw new Error("CONSOLIDATION_NOT_READY");
    return "CONSOLIDATING";
  }
  if (event === "COMPLETE_CONSOLIDATION") {
    if (current !== "CONSOLIDATING") throw new Error("CONSOLIDATION_NOT_ACTIVE");
    return "CONSOLIDATED";
  }
  throw new Error("INVALID_CONSOLIDATION_ACTION");
}

export function batchProgress(lines = []) {
  const totalLines = lines.length;
  const completedLines = lines.filter((line) => Number(line.pickedQty || 0) >= Number(line.totalQty || 0)).length;
  const totalQty = lines.reduce((sum, line) => sum + Number(line.totalQty || 0), 0);
  const pickedQty = lines.reduce((sum, line) => sum + Math.min(Number(line.pickedQty || 0), Number(line.totalQty || 0)), 0);
  return { totalLines, completedLines, totalQty, pickedQty, percent: totalQty ? Math.round((pickedQty / totalQty) * 100) : 0 };
}
