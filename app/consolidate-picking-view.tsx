"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type ConsolidateRole = "DEVELOPER" | "CONSOLIDATE_PICKER" | "CONSOLIDATOR" | "STAGING_HELPER" | "LINE_HELPER";
type User = { staffId: string; name: string; role: ConsolidateRole };
type ViewMode = "PICKLIST" | "PICKING_TASK" | "CONSOLIDATION_TASK";
type Allocation = { soNumber: string; hubCode: string; waveNumber: number; requestQty: number };
type PickItem = {
  pickingAreaName: string; zoneFamily: string; floorNumber: number; originRackName: string;
  skuNumber: string; productName: string; expiryDate?: string | null; totalQty: number;
  soCount: number; waves: number[]; allocations: Allocation[];
};
type Snapshot = {
  ok: boolean; generatedAt?: string | null; operationalDate?: string | null; stale?: boolean;
  totals?: { pickRows: number; soCount: number; totalQty: number }; picklist?: PickItem[];
};
type BatchLine = {
  lineId: number; lineNo: number; originRackName: string; skuNumber: string; productName: string;
  totalQty: number; pickedQty: number; status: "READY" | "DONE"; waves: number[];
};
type Batch = {
  batchId: string; batchCode: string; pickingAreaName: string;
  status: "READY" | "IN_PROGRESS" | "PICKING_COMPLETED"; pickerId: string; lines: BatchLine[];
};
type Consolidation = {
  batchId: string; batchCode: string; soNumber: string; hubCode: string; waveNumber: number;
  status: "READY" | "CONSOLIDATING" | "CONSOLIDATED"; consolidatorId: string;
  expectedQty: number; allocations: Array<{ lineId: number; skuNumber: string; productName: string; requestQty: number }>;
};
type TaskPayload = { ok: boolean; batches: Batch[]; consolidations: Consolidation[] };

const number = (value: number) => new Intl.NumberFormat("id-ID").format(Number(value || 0));
const shortSo = (value: string) => String(value || "").split("/").filter(Boolean).at(-1) || value;
const normalize = (value: string) => value.trim().toUpperCase();

function freshness(value?: string | null) {
  if (!value) return "Belum ada snapshot";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function defaultMode(role: ConsolidateRole): ViewMode {
  if (role === "CONSOLIDATE_PICKER") return "PICKING_TASK";
  if (role === "CONSOLIDATOR") return "CONSOLIDATION_TASK";
  return "PICKLIST";
}

export function ConsolidatePickingView({ user }: { user: User }) {
  const [mode, setMode] = useState<ViewMode>(() => defaultMode(user.role));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tasks, setTasks] = useState<TaskPayload>({ ok: true, batches: [], consolidations: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("ALL");
  const [expanded, setExpanded] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [selectedSo, setSelectedSo] = useState("");
  const [qtyInputs, setQtyInputs] = useState<Record<number, string>>({});
  const [soScan, setSoScan] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [picklistResult, taskResult] = await Promise.all([
      supabase.rpc("owor_get_consolidate_picklist", { p_scope_code: "SRA_L2_UP" }),
      supabase.rpc("owor_get_consolidate_tasks", { p_scope_code: "SRA_L2_UP" }),
    ]);
    if (picklistResult.error) {
      setSnapshot(null);
      setMessage(picklistResult.error.message || "Picklist belum bisa dibaca");
    } else {
      setSnapshot(picklistResult.data as Snapshot);
    }
    if (!taskResult.error && taskResult.data) setTasks(taskResult.data as TaskPayload);
    else if (taskResult.error) setMessage(taskResult.error.message || "Task backend belum siap");
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function runSync() {
    setBusy(true);
    setMessage("Mengambil batch picklist terbaru dari Superset…");
    const { data, error } = await supabase.functions.invoke("owor-admin", {
      method: "POST", body: { action: "sync_consolidate", scope: "SRA_L2_UP" },
    });
    const payload = data as { ok?: boolean; error?: string } | null;
    if (error || payload?.ok !== true) setMessage(payload?.error || error?.message || "Sync consolidate gagal");
    else {
      setMessage("Snapshot terbaru berhasil diterbitkan. Task aktif lama tetap tidak berubah.");
      await load();
    }
    setBusy(false);
  }

  async function generateTasks() {
    setBusy(true);
    const { data, error } = await supabase.rpc("owor_generate_consolidate_tasks", { p_scope_code: "SRA_L2_UP" });
    if (error) setMessage(error.message || "Generate task gagal");
    else {
      setTasks(data as TaskPayload);
      setMessage("Picking Task berhasil dibuat dari snapshot aktif.");
      setMode("PICKING_TASK");
    }
    setBusy(false);
  }

  async function applyAction(batchId: string, action: string, lineId?: number, qty?: number, soNumber = "") {
    setBusy(true);
    const { data, error } = await supabase.rpc("owor_apply_consolidate_action", {
      p_batch_id: batchId, p_action: action, p_line_id: lineId ?? null,
      p_qty: qty ?? null, p_so_number: soNumber,
    });
    if (error) setMessage(error.message || "Task gagal diperbarui");
    else {
      setTasks(data as TaskPayload);
      setMessage(action === "COMPLETE_PICKING" ? "Picking selesai. Consolidation Task sudah diterbitkan." : "Task berhasil diperbarui.");
    }
    setBusy(false);
  }

  const rows = useMemo(() => snapshot?.picklist ?? [], [snapshot?.picklist]);
  const areas = useMemo(() => [...new Set(rows.map((row) => row.pickingAreaName))].sort(), [rows]);
  const filtered = useMemo(() => {
    const query = normalize(search);
    return rows.filter((row) => {
      if (area !== "ALL" && row.pickingAreaName !== area) return false;
      return !query || [row.pickingAreaName, row.originRackName, row.skuNumber, row.productName, ...row.allocations.flatMap((item) => [item.soNumber, item.hubCode])]
        .some((value) => normalize(String(value || "")).includes(query));
    });
  }, [area, rows, search]);
  const selectedBatch = tasks.batches.find((batch) => batch.batchId === selectedBatchId) || tasks.batches[0];
  const selectedConsolidation = tasks.consolidations.find((task) => task.soNumber === selectedSo) || tasks.consolidations[0];
  const canWorkBatch = selectedBatch && (user.role === "DEVELOPER" || selectedBatch.pickerId === normalize(user.staffId));
  const completedLines = selectedBatch?.lines.filter((line) => line.status === "DONE").length || 0;
  const canWorkConsolidation = selectedConsolidation && (user.role === "DEVELOPER" || selectedConsolidation.consolidatorId === normalize(user.staffId));
  const visibleQty = filtered.reduce((total, row) => total + Number(row.totalQty || 0), 0);
  const visibleSo = new Set(filtered.flatMap((row) => row.allocations.map((item) => item.soNumber))).size;

  return (
    <section className="consolidate-workspace" aria-labelledby="consolidate-title">
      <div className="consolidate-hero">
        <div><p className="eyebrow">CBT · BATCH PICKING PILOT</p><h2 id="consolidate-title">Consolidate <em>picking</em></h2><p>Picking lintas SO, lalu pisahkan barang menjadi task per sales order.</p></div>
        <div className="consolidate-scope-card"><span>ACTIVE SCOPE</span><strong>SRA · LEVEL 2+</strong><small>Wave 2–4 · Wave 1 dikecualikan</small></div>
      </div>

      <div className="consolidate-tabs" role="tablist" aria-label="Submenu Consolidate Picking">
        {user.role === "DEVELOPER" && <button role="tab" aria-selected={mode === "PICKLIST"} className={mode === "PICKLIST" ? "active" : ""} onClick={() => setMode("PICKLIST")}><b>01</b><span>Picklist<small>Raw planning</small></span></button>}
        {(user.role === "DEVELOPER" || user.role === "CONSOLIDATE_PICKER") && <button role="tab" aria-selected={mode === "PICKING_TASK"} className={mode === "PICKING_TASK" ? "active" : ""} onClick={() => setMode("PICKING_TASK")}><b>02</b><span>Picking Task<small>Rack → SKU</small></span></button>}
        {(user.role === "DEVELOPER" || user.role === "CONSOLIDATOR") && <button role="tab" aria-selected={mode === "CONSOLIDATION_TASK"} className={mode === "CONSOLIDATION_TASK" ? "active" : ""} onClick={() => setMode("CONSOLIDATION_TASK")}><b>03</b><span>Consolidation Task<small>Barang → SO</small></span></button>}
      </div>

      <div className="consolidate-status" aria-live="polite">
        <span data-state={snapshot?.ok ? (snapshot.stale ? "stale" : "live") : "empty"}><i />{snapshot?.ok ? (snapshot.stale ? "Last valid snapshot" : "Live picklist") : "Snapshot belum tersedia"}</span>
        <small>{freshness(snapshot?.generatedAt)}{snapshot?.operationalDate ? ` · operational ${snapshot.operationalDate}` : ""}</small>
        <div>
          <button className="soft-button" disabled={loading || busy} onClick={() => void load()}>↻ Refresh</button>
          {user.role === "DEVELOPER" && mode === "PICKLIST" && <button className="primary-button" disabled={busy} onClick={() => void runSync()}>{busy ? "Syncing…" : "Sync Superset"}</button>}
          {user.role === "DEVELOPER" && mode === "PICKING_TASK" && <button className="primary-button" disabled={busy || !snapshot?.ok} onClick={() => void generateTasks()}>Generate task</button>}
        </div>
      </div>
      {message && <div className="consolidate-message" role="status">{message}</div>}

      {mode === "PICKLIST" && <>
        <div className="consolidate-kpis" aria-label="Ringkasan consolidate picking">
          <article><span>PICK ROWS</span><strong>{number(snapshot?.totals?.pickRows || 0)}</strong><small>rack × SKU × expiry</small></article>
          <article><span>TOTAL QTY</span><strong>{number(snapshot?.totals?.totalQty || 0)}</strong><small>trial SRA L2+</small></article>
          <article><span>SALES ORDER</span><strong>{number(snapshot?.totals?.soCount || 0)}</strong><small>allocation tujuan</small></article>
          <article className="accent"><span>VISIBLE QTY</span><strong>{number(visibleQty)}</strong><small>{number(visibleSo)} SO pada filter</small></article>
        </div>
        <section className="consolidate-panel">
          <div className="consolidate-panel-head"><div><span>01</span><div><h3>Batch picklist</h3><p>Urutan kerja: picking area → rack → SKU</p></div></div><div className="consolidate-filters"><label><span className="sr-only">Filter picking area</span><select value={area} onChange={(event) => setArea(event.target.value)}><option value="ALL">Semua picking area</option>{areas.map((value) => <option key={value}>{value}</option>)}</select></label><label><span className="sr-only">Cari picklist</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari rack, SKU, SO, hub…" /></label></div></div>
          {loading ? <div className="consolidate-empty"><strong>Memuat picklist…</strong><span>Membaca snapshot Supabase.</span></div> : !snapshot?.ok ? <div className="consolidate-empty"><strong>Picklist belum diterbitkan</strong><span>Klik Sync Superset untuk membuat snapshot pertama.</span></div> : !filtered.length ? <div className="consolidate-empty"><strong>Tidak ada row pada filter ini</strong></div> : <div className="consolidate-list">
            <div className="consolidate-list-label"><span>Area / rack</span><span>SKU / product</span><span>Wave</span><span>Qty</span><span>SO</span><span /></div>
            {filtered.map((row) => { const key = [row.pickingAreaName, row.originRackName, row.skuNumber, row.expiryDate || ""].join("::"); const open = expanded === key; return <article className="consolidate-row" key={key} data-open={open}><div className="consolidate-row-main"><span className="consolidate-rack"><b>{row.pickingAreaName}</b><strong>{row.originRackName}</strong><small>Floor {row.floorNumber}</small></span><span className="consolidate-product"><strong>{row.skuNumber}</strong><b>{row.productName || "Product name unavailable"}</b><small>{row.expiryDate ? `Expiry ${row.expiryDate}` : "Expiry tidak tersedia"}</small></span><span className="consolidate-waves">{row.waves.map((wave) => <i key={wave}>W{wave}</i>)}</span><span className="consolidate-qty"><strong>{number(row.totalQty)}</strong><small>qty</small></span><span className="consolidate-so"><strong>{number(row.soCount)}</strong><small>SO</small></span><button aria-expanded={open} aria-label={`${open ? "Tutup" : "Buka"} allocation SKU ${row.skuNumber}`} onClick={() => setExpanded(open ? "" : key)}>{open ? "−" : "+"}</button></div>{open && <div className="consolidate-allocations"><div className="consolidate-allocation-head"><span>SO ID</span><span>Hub</span><span>Wave</span><span>Request qty</span></div>{row.allocations.map((item) => <div key={`${item.soNumber}-${item.hubCode}-${item.waveNumber}`}><span><strong>{shortSo(item.soNumber)}</strong><small>{item.soNumber}</small></span><b>{item.hubCode}</b><i>WAVE {item.waveNumber}</i><strong>{number(item.requestQty)}</strong></div>)}</div>}</article>; })}
          </div>}
        </section>
      </>}

      {mode === "PICKING_TASK" && <section className="task-mobile-layout">
        <div className="task-mobile-queue panel">
          <div className="task-mobile-heading"><span>02</span><div><h3>Picking Task</h3><p>Claim satu batch, konfirmasi qty per rack dan SKU.</p></div></div>
          {!tasks.batches.length ? <div className="consolidate-empty"><strong>Belum ada Picking Task</strong><span>Developer perlu menekan Generate task.</span></div> : tasks.batches.map((batch) => <button key={batch.batchId} className={selectedBatch?.batchId === batch.batchId ? "active" : ""} onClick={() => setSelectedBatchId(batch.batchId)}><span><b>{batch.batchCode}</b><small>{batch.pickingAreaName}</small></span><strong>{batch.lines.length} rows</strong><em data-state={batch.status}>{batch.status.replaceAll("_", " ")}</em></button>)}
        </div>
        <aside className="task-mobile-detail panel">
          {!selectedBatch ? <div className="consolidate-empty"><strong>Pilih batch</strong></div> : <>
            <div className="task-active-head"><span><small>ACTIVE BATCH</small><strong>{selectedBatch.batchCode}</strong></span><b>{completedLines}/{selectedBatch.lines.length}</b></div>
            {selectedBatch.status === "READY" ? <div className="task-claim-card"><h3>Batch siap diambil</h3><p>{number(selectedBatch.lines.reduce((sum, line) => sum + Number(line.totalQty), 0))} qty · {selectedBatch.lines.length} rack/SKU</p><button disabled={busy} onClick={() => void applyAction(selectedBatch.batchId, "CLAIM_PICKING")}>Ambil Picking Task</button></div> : <div className="task-pick-lines">
              {selectedBatch.lines.map((line) => <article key={line.lineId} data-done={line.status === "DONE"}><header><span><b>{line.originRackName}</b><small>#{line.lineNo} · W{line.waves.join(" / W")}</small></span><em>{line.status === "DONE" ? "DONE" : "PICK"}</em></header><strong>{line.skuNumber}</strong><p>{line.productName}</p><div><label><span>Target qty</span><input inputMode="numeric" aria-label={`Qty SKU ${line.skuNumber}`} value={qtyInputs[line.lineId] ?? String(line.totalQty)} disabled={line.status === "DONE" || !canWorkBatch} onChange={(event) => setQtyInputs((current) => ({ ...current, [line.lineId]: event.target.value }))} /></label><button disabled={busy || line.status === "DONE" || !canWorkBatch} onClick={() => void applyAction(selectedBatch.batchId, "COMPLETE_LINE", line.lineId, Number(qtyInputs[line.lineId] ?? line.totalQty))}>{line.status === "DONE" ? "Terkonfirmasi" : `Konfirmasi ${number(line.totalQty)}`}</button></div></article>)}
              {selectedBatch.status === "IN_PROGRESS" && <button className="task-finish-button" disabled={busy || completedLines !== selectedBatch.lines.length || !canWorkBatch} onClick={() => void applyAction(selectedBatch.batchId, "COMPLETE_PICKING")}>Selesaikan picking batch</button>}
              {selectedBatch.status === "PICKING_COMPLETED" && <div className="task-complete-state"><strong>Picking completed</strong><span>Task per SO sudah masuk submenu Consolidation Task.</span></div>}
            </div>}
          </>}
        </aside>
      </section>}

      {mode === "CONSOLIDATION_TASK" && <section className="task-mobile-layout">
        <div className="task-mobile-queue panel">
          <div className="task-mobile-heading"><span>03</span><div><h3>Consolidation Task</h3><p>Pisahkan hasil batch menjadi sales order.</p></div></div>
          {!tasks.consolidations.length ? <div className="consolidate-empty"><strong>Belum ada task</strong><span>Task muncul setelah satu batch selesai picking.</span></div> : tasks.consolidations.map((task) => <button key={`${task.batchId}-${task.soNumber}`} className={selectedConsolidation?.soNumber === task.soNumber ? "active" : ""} onClick={() => { setSelectedSo(task.soNumber); setSoScan(""); }}><span><b>SO {shortSo(task.soNumber)}</b><small>{task.hubCode} · Wave {task.waveNumber}</small></span><strong>{number(task.expectedQty)} qty</strong><em data-state={task.status}>{task.status.replaceAll("_", " ")}</em></button>)}
        </div>
        <aside className="task-mobile-detail panel">
          {!selectedConsolidation ? <div className="consolidate-empty"><strong>Pilih SO</strong></div> : <>
            <div className="task-active-head"><span><small>ACTIVE SO</small><strong>{shortSo(selectedConsolidation.soNumber)}</strong></span><b>W{selectedConsolidation.waveNumber}</b></div>
            <div className="consolidation-allocation-list">{selectedConsolidation.allocations.map((item) => <article key={`${item.lineId}-${item.skuNumber}`}><span><b>{item.skuNumber}</b><small>{item.productName}</small></span><strong>{number(item.requestQty)} qty</strong></article>)}</div>
            {selectedConsolidation.status === "READY" ? <div className="task-claim-card"><h3>SO siap dipisahkan</h3><p>{selectedConsolidation.allocations.length} SKU · {number(selectedConsolidation.expectedQty)} qty</p><button disabled={busy} onClick={() => void applyAction(selectedConsolidation.batchId, "CLAIM_CONSOLIDATION", undefined, undefined, selectedConsolidation.soNumber)}>Ambil Consolidation Task</button></div> : selectedConsolidation.status === "CONSOLIDATING" ? <div className="consolidation-scan-card"><label><span>Scan barcode SO untuk menyelesaikan</span><input inputMode="numeric" autoComplete="off" aria-label="Scan barcode SO consolidation" value={soScan} onChange={(event) => setSoScan(event.target.value)} placeholder={shortSo(selectedConsolidation.soNumber)} /></label><button disabled={busy || !canWorkConsolidation || ![normalize(selectedConsolidation.soNumber), normalize(shortSo(selectedConsolidation.soNumber))].includes(normalize(soScan))} onClick={() => void applyAction(selectedConsolidation.batchId, "COMPLETE_CONSOLIDATION", undefined, undefined, selectedConsolidation.soNumber)}>SO lengkap · Kirim ke staging helper</button></div> : <div className="task-complete-state"><strong>SO consolidated</strong><span>Barang siap diambil Staging Helper.</span></div>}
          </>}
        </aside>
      </section>}
    </section>
  );
}
