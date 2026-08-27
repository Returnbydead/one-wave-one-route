"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { validatePickConfirmation } from "./consolidate-task-core.mjs";

type ConsolidateRole = "DEVELOPER" | "CONSOLIDATE_PICKER" | "CONSOLIDATOR" | "STAGING_HELPER" | "LINE_HELPER";
type User = { staffId: string; name: string; role: ConsolidateRole; roles: ConsolidateRole[] };
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

function defaultMode(roles: ConsolidateRole[]): ViewMode {
  if (roles.includes("CONSOLIDATE_PICKER")) return "PICKING_TASK";
  if (roles.includes("CONSOLIDATOR")) return "CONSOLIDATION_TASK";
  return "PICKLIST";
}

export function ConsolidatePickingView({ user }: { user: User }) {
  const isDeveloper = user.roles.includes("DEVELOPER");
  const canPick = isDeveloper || user.roles.includes("CONSOLIDATE_PICKER");
  const canConsolidate = isDeveloper || user.roles.includes("CONSOLIDATOR");
  const [mode, setMode] = useState<ViewMode>(() => defaultMode(user.roles));
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
  const [waveFilter, setWaveFilter] = useState("ALL");
  const [qtyInputs, setQtyInputs] = useState<Record<number, string>>({});
  const [skuInputs, setSkuInputs] = useState<Record<number, string>>({});
  const [activePickLineId, setActivePickLineId] = useState<number | null>(null);
  const [soScan, setSoScan] = useState("");
  const [assignmentOptions, setAssignmentOptions] = useState<{ pickers: Array<{staffId:string;name:string}>; waves:number[]; locations:string[] }>({ pickers: [], waves: [], locations: [] });
  const [assignedPickers, setAssignedPickers] = useState<string[]>([]);
  const [pickerDropdownOpen, setPickerDropdownOpen] = useState(false);
  const [assignmentPickerSearch, setAssignmentPickerSearch] = useState("");
  const [assignedWaves, setAssignedWaves] = useState<number[]>([]);
  const [assignedLocations, setAssignedLocations] = useState<string[]>([]);

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

  useEffect(() => {
    if (!isDeveloper) return;
    void supabase.rpc("owor_get_consolidate_assignment_options", { p_scope_code: "SRA_L2_UP" }).then(({ data }) => {
      const options = data as typeof assignmentOptions | null;
      if (!options) return;
      setAssignmentOptions(options);
      setAssignedWaves(options.waves ?? []);
      setAssignedLocations(options.locations ?? []);
    });
  }, [isDeveloper]);

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

  async function assignPickingTasks() {
    if (!assignedPickers.length || !assignedWaves.length || !assignedLocations.length) {
      setMessage("Pilih minimal satu picker, wave, dan lokasi."); return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("owor_assign_consolidate_picking", {
      p_picker_ids: assignedPickers, p_waves: assignedWaves, p_locations: assignedLocations, p_scope_code: "SRA_L2_UP",
    });
    if (error) setMessage(error.message || "Assignment gagal dibuat");
    else { setTasks(data as TaskPayload); setMessage("Picking Task sudah dibagi ke picker berdasarkan wave dan lokasi."); }
    setBusy(false);
  }

  async function confirmPick(batch: Batch, line: BatchLine) {
    try {
      validatePickConfirmation({ expectedSku: line.skuNumber, scannedSku: skuInputs[line.lineId] || "", targetQty: line.totalQty, pickedQty: line.pickedQty, inputQty: Number(qtyInputs[line.lineId] || 0) });
    } catch (error) {
      setMessage(error instanceof Error && error.message === "SKU_MISMATCH" ? "SKU berbeda. Picking tidak dapat dikonfirmasi." : "Qty tidak valid atau melebihi target."); return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("owor_confirm_consolidate_pick", { p_batch_id: batch.batchId, p_line_id: line.lineId, p_sku: skuInputs[line.lineId], p_qty: Number(qtyInputs[line.lineId]) });
    if (error) setMessage(error.message || "Konfirmasi picking gagal");
    else { setTasks(data as TaskPayload); setMessage("Qty picking tersimpan."); setQtyInputs((current) => ({ ...current, [line.lineId]: "" })); }
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
  const visibleBatches = isDeveloper ? tasks.batches : tasks.batches.filter((batch) => batch.pickerId === normalize(user.staffId));
  const selectedBatch = visibleBatches.find((batch) => batch.batchId === selectedBatchId) || visibleBatches[0];
  const consolidationWaves = useMemo(
    () => [...new Set(tasks.consolidations.map((task) => task.waveNumber))].sort((left, right) => left - right),
    [tasks.consolidations],
  );
  const consolidationWaveCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const task of tasks.consolidations) counts.set(task.waveNumber, (counts.get(task.waveNumber) || 0) + 1);
    return counts;
  }, [tasks.consolidations]);
  const filteredConsolidations = useMemo(
    () => waveFilter === "ALL"
      ? tasks.consolidations
      : tasks.consolidations.filter((task) => task.waveNumber === Number(waveFilter)),
    [tasks.consolidations, waveFilter],
  );
  const selectedConsolidation = filteredConsolidations.find((task) => task.soNumber === selectedSo);
  const canWorkBatch = selectedBatch && (isDeveloper || selectedBatch.pickerId === normalize(user.staffId));
  const completedLines = selectedBatch?.lines.filter((line) => line.status === "DONE").length || 0;
  const canWorkConsolidation = selectedConsolidation && (isDeveloper || selectedConsolidation.consolidatorId === normalize(user.staffId));
  const visibleQty = filtered.reduce((total, row) => total + Number(row.totalQty || 0), 0);
  const visibleSo = new Set(filtered.flatMap((row) => row.allocations.map((item) => item.soNumber))).size;
  const filteredAssignmentPickers = assignmentOptions.pickers.filter((picker) => {
    const query = normalize(assignmentPickerSearch);
    return !query || normalize(picker.name).includes(query) || normalize(picker.staffId).includes(query);
  });
  const selectedAssignmentPickers = assignedPickers
    .map((staffId) => assignmentOptions.pickers.find((picker) => picker.staffId === staffId))
    .filter((picker): picker is { staffId: string; name: string } => Boolean(picker));

  return (
    <section className="consolidate-workspace" aria-labelledby="consolidate-title">
      <div className="consolidate-hero">
        <div><p className="eyebrow">CBT · BATCH PICKING PILOT</p><h2 id="consolidate-title">Consolidate <em>picking</em></h2><p>Picking lintas SO, lalu pisahkan barang menjadi task per sales order.</p></div>
        <div className="consolidate-scope-card"><span>ACTIVE SCOPE</span><strong>SRA · LEVEL 2+</strong><small>Wave 2–4 · Wave 1 dikecualikan</small></div>
      </div>

      <div className="consolidate-tabs" role="tablist" aria-label="Submenu Consolidate Picking">
        {isDeveloper && <button role="tab" aria-selected={mode === "PICKLIST"} className={mode === "PICKLIST" ? "active" : ""} onClick={() => setMode("PICKLIST")}><b>01</b><span>Picklist<small>Raw planning</small></span></button>}
        {canPick && <button role="tab" aria-selected={mode === "PICKING_TASK"} className={mode === "PICKING_TASK" ? "active" : ""} onClick={() => setMode("PICKING_TASK")}><b>02</b><span>Picking Task<small>Rack → SKU</small></span></button>}
        {canConsolidate && <button role="tab" aria-selected={mode === "CONSOLIDATION_TASK"} className={mode === "CONSOLIDATION_TASK" ? "active" : ""} onClick={() => setMode("CONSOLIDATION_TASK")}><b>03</b><span>Consolidation Task<small>Barang → SO</small></span></button>}
      </div>

      <div className="consolidate-status" aria-live="polite">
        <span data-state={snapshot?.ok ? (snapshot.stale ? "stale" : "live") : "empty"}><i />{snapshot?.ok ? (snapshot.stale ? "Last valid snapshot" : "Live picklist") : "Snapshot belum tersedia"}</span>
        <small>{freshness(snapshot?.generatedAt)}{snapshot?.operationalDate ? ` · operational ${snapshot.operationalDate}` : ""}</small>
        <div>
          <button className="soft-button" disabled={loading || busy} onClick={() => void load()}>↻ Refresh</button>
          {isDeveloper && mode === "PICKLIST" && <button className="primary-button" disabled={busy} onClick={() => void runSync()}>{busy ? "Syncing…" : "Sync Superset"}</button>}
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

      {mode === "PICKING_TASK" && isDeveloper && <section className="picking-assignment-builder panel" aria-label="Assign by wave and location">
        <div><span>ASSIGNMENT BUILDER</span><h3>Assign by wave & location</h3><p>Pilih beberapa picker, wave, dan lokasi. Lokasi dibagi merata; satu lokasi hanya masuk ke satu picker.</p></div>
        <div className="assignment-picker-select">
          <span className="assignment-field-label">Picker</span>
          <button type="button" className="assignment-picker-trigger" aria-haspopup="listbox" aria-expanded={pickerDropdownOpen} aria-controls="assignment-picker-options" onClick={() => setPickerDropdownOpen((current) => !current)}>
            <span><strong>{assignedPickers.length ? `${assignedPickers.length} picker dipilih` : "Pilih picker"}</strong><small>{selectedAssignmentPickers.length ? selectedAssignmentPickers.slice(0, 2).map((picker) => picker.name).join(", ") + (selectedAssignmentPickers.length > 2 ? ` +${selectedAssignmentPickers.length - 2}` : "") : "Cari nama atau Staff ID"}</small></span><b aria-hidden="true">{pickerDropdownOpen ? "−" : "+"}</b>
          </button>
          {pickerDropdownOpen && <div className="assignment-picker-dropdown">
            <label><span className="sr-only">Cari picker</span><input type="search" role="combobox" aria-autocomplete="list" aria-controls="assignment-picker-options" aria-expanded="true" value={assignmentPickerSearch} onChange={(event) => setAssignmentPickerSearch(event.target.value)} placeholder="Cari nama atau Staff ID…" autoFocus /></label>
            <div id="assignment-picker-options" className="assignment-picker-options" role="listbox" aria-label="Daftar picker" aria-multiselectable="true">
              {filteredAssignmentPickers.map((picker) => { const selected = assignedPickers.includes(picker.staffId); return <button type="button" role="option" aria-selected={selected} className={selected ? "selected" : ""} key={picker.staffId} onClick={() => setAssignedPickers((current) => selected ? current.filter((id) => id !== picker.staffId) : [...current, picker.staffId])}><i>{selected ? "✓" : "+"}</i><span><strong>{picker.name}</strong><small>{picker.staffId}</small></span></button>; })}
              {!filteredAssignmentPickers.length && <div className="assignment-picker-empty">Picker tidak ditemukan</div>}
            </div>
            <footer><button type="button" disabled={!assignedPickers.length} onClick={() => setAssignedPickers([])}>Clear</button><button type="button" onClick={() => setPickerDropdownOpen(false)}>Selesai · {assignedPickers.length}</button></footer>
          </div>}
        </div>
        <fieldset><legend>Wave</legend>{assignmentOptions.waves.map((wave) => <label key={wave}><input type="checkbox" checked={assignedWaves.includes(wave)} onChange={(event) => setAssignedWaves((current) => event.target.checked ? [...current, wave] : current.filter((value) => value !== wave))} /><span>Wave {wave}</span></label>)}</fieldset>
        <fieldset className="assignment-location-list"><legend>Lokasi ({assignedLocations.length})</legend>{assignmentOptions.locations.map((location) => <label key={location}><input type="checkbox" checked={assignedLocations.includes(location)} onChange={(event) => setAssignedLocations((current) => event.target.checked ? [...current, location] : current.filter((value) => value !== location))} /><span>{location}</span></label>)}</fieldset>
        <button className="primary-button" disabled={busy} onClick={() => void assignPickingTasks()}>Buat task picker</button>
      </section>}

      {mode === "PICKING_TASK" && <section className="task-mobile-layout">
        <div className="task-mobile-queue panel">
          <div className="task-mobile-heading"><span>02</span><div><h3>Picking Task</h3><p>Claim satu batch, konfirmasi qty per rack dan SKU.</p></div></div>
          {!visibleBatches.length ? <div className="consolidate-empty"><strong>Belum ada Picking Task</strong><span>Developer perlu membuat assignment picker.</span></div> : visibleBatches.map((batch) => <button key={batch.batchId} className={selectedBatch?.batchId === batch.batchId ? "active" : ""} onClick={() => setSelectedBatchId(batch.batchId)}><span><b>{batch.batchCode}</b><small>{batch.pickingAreaName}</small></span><strong>{batch.lines.length} rows</strong><em data-state={batch.status}>{batch.status.replaceAll("_", " ")}</em></button>)}
        </div>
        <aside className="task-mobile-detail panel">
          {!selectedBatch ? <div className="consolidate-empty"><strong>Pilih batch</strong></div> : <>
            <div className="task-active-head"><span><small>ACTIVE BATCH</small><strong>{selectedBatch.batchCode}</strong></span><b>{completedLines}/{selectedBatch.lines.length}</b></div>
            {selectedBatch.status === "READY" ? <div className="task-claim-card"><h3>Batch siap diambil</h3><p>{number(selectedBatch.lines.reduce((sum, line) => sum + Number(line.totalQty), 0))} qty · {selectedBatch.lines.length} rack/SKU</p><button disabled={busy} onClick={() => void applyAction(selectedBatch.batchId, "CLAIM_PICKING")}>Ambil Picking Task</button></div> : <div className="task-pick-lines">
              {selectedBatch.lines.map((line) => { const open = activePickLineId === line.lineId || line.status === "DONE"; const remaining = Number(line.totalQty) - Number(line.pickedQty || 0); return <article key={line.lineId} data-done={line.status === "DONE"} data-open={open}><button className="pick-location-button" aria-expanded={open} onClick={() => setActivePickLineId(open && line.status !== "DONE" ? null : line.lineId)}><span><b>{line.originRackName}</b><small>#{line.lineNo} · W{line.waves.join(" / W")}</small></span><em>{line.status === "DONE" ? "DONE" : `${number(remaining)} left`}</em></button>{open && <div className="pick-confirmation-form"><strong>{line.skuNumber}</strong><p>{line.productName}</p><label><span>Scan / input SKU</span><input autoComplete="off" inputMode="numeric" aria-label={`Scan SKU ${line.skuNumber}`} value={skuInputs[line.lineId] ?? ""} disabled={line.status === "DONE" || !canWorkBatch} onChange={(event) => setSkuInputs((current) => ({ ...current, [line.lineId]: event.target.value }))} placeholder="Scan barcode atau ketik SKU" /></label><label><span>Qty diambil · target {number(line.totalQty)} · sudah {number(line.pickedQty)}</span><input inputMode="numeric" aria-label={`Qty SKU ${line.skuNumber}`} value={qtyInputs[line.lineId] ?? ""} disabled={line.status === "DONE" || !canWorkBatch} onChange={(event) => setQtyInputs((current) => ({ ...current, [line.lineId]: event.target.value }))} placeholder={`Maks. ${number(remaining)}`} /></label><button disabled={busy || line.status === "DONE" || !canWorkBatch || !skuInputs[line.lineId] || !qtyInputs[line.lineId]} onClick={() => void confirmPick(selectedBatch, line)}>{line.status === "DONE" ? "Picking completed" : "Konfirmasi picking"}</button></div>}</article>; })}
              {selectedBatch.status === "IN_PROGRESS" && <button className="task-finish-button" disabled={busy || completedLines !== selectedBatch.lines.length || !canWorkBatch} onClick={() => void applyAction(selectedBatch.batchId, "COMPLETE_PICKING")}>Selesaikan picking batch</button>}
              {selectedBatch.status === "PICKING_COMPLETED" && <div className="task-complete-state"><strong>Picking completed</strong><span>Task per SO sudah masuk submenu Consolidation Task.</span></div>}
            </div>}
          </>}
        </aside>
      </section>}

      {mode === "CONSOLIDATION_TASK" && <section className="task-mobile-layout">
        <div className="task-mobile-queue panel">
          <div className="task-mobile-heading"><span>03</span><div><h3>Consolidation Task</h3><p>Pisahkan hasil batch menjadi sales order.</p></div></div>
          {!!tasks.consolidations.length && <div className="task-wave-filter"><span>PRIORITY WAVE</span><div role="group" aria-label="Filter consolidation task berdasarkan wave"><button aria-pressed={waveFilter === "ALL"} className={waveFilter === "ALL" ? "active" : ""} onClick={() => { setWaveFilter("ALL"); setSelectedSo(""); }}>Semua wave <small>{tasks.consolidations.length}</small></button>{consolidationWaves.map((wave) => <button key={wave} aria-pressed={waveFilter === String(wave)} className={waveFilter === String(wave) ? "active" : ""} onClick={() => { setWaveFilter(String(wave)); setSelectedSo(""); }}>Wave {wave} <small>{consolidationWaveCounts.get(wave) || 0}</small></button>)}</div></div>}
          {!tasks.consolidations.length ? <div className="consolidate-empty"><strong>Belum ada task</strong><span>Task muncul setelah satu batch selesai picking.</span></div> : !filteredConsolidations.length ? <div className="consolidate-empty"><strong>Tidak ada task pada wave ini</strong><span>Pilih wave lain untuk melanjutkan consolidate.</span></div> : filteredConsolidations.map((task) => <button key={`${task.batchId}-${task.soNumber}`} className={selectedConsolidation?.soNumber === task.soNumber ? "active" : ""} onClick={() => { setSelectedSo(task.soNumber); setSoScan(""); }}><span><b>SO {shortSo(task.soNumber)}</b><small>{task.hubCode} · Wave {task.waveNumber}</small></span><strong>{number(task.expectedQty)} qty</strong><em data-state={task.status}>{task.status.replaceAll("_", " ")}</em></button>)}
        </div>
        {selectedConsolidation && <button className="consolidation-mobile-backdrop" aria-label="Tutup detail SO" onClick={() => setSelectedSo("")} />}
        <aside className={`task-mobile-detail consolidation-detail-sheet panel ${selectedConsolidation ? "open" : ""}`} role="dialog" aria-modal="true" aria-label={selectedConsolidation ? `Detail SO ${shortSo(selectedConsolidation.soNumber)}` : "Detail SO"}>
          {!selectedConsolidation ? <div className="consolidate-empty"><strong>Pilih SO</strong></div> : <>
            <div className="task-active-head"><span><small>ACTIVE SO</small><strong>{shortSo(selectedConsolidation.soNumber)}</strong></span><b>W{selectedConsolidation.waveNumber}</b><button aria-label="Tutup detail SO" onClick={() => setSelectedSo("")}>×</button></div>
            <div className="consolidation-allocation-list">{selectedConsolidation.allocations.map((item) => <article key={`${item.lineId}-${item.skuNumber}`}><span><b>{item.skuNumber}</b><small>{item.productName}</small></span><strong>{number(item.requestQty)} qty</strong></article>)}</div>
            {selectedConsolidation.status === "READY" ? <div className="task-claim-card"><h3>SO siap dipisahkan</h3><p>{selectedConsolidation.allocations.length} SKU · {number(selectedConsolidation.expectedQty)} qty</p><button disabled={busy} onClick={() => void applyAction(selectedConsolidation.batchId, "CLAIM_CONSOLIDATION", undefined, undefined, selectedConsolidation.soNumber)}>Ambil Consolidation Task</button></div> : selectedConsolidation.status === "CONSOLIDATING" ? <div className="consolidation-scan-card"><label><span>Scan barcode SO untuk menyelesaikan</span><input inputMode="numeric" autoComplete="off" aria-label="Scan barcode SO consolidation" value={soScan} onChange={(event) => setSoScan(event.target.value)} placeholder={shortSo(selectedConsolidation.soNumber)} /></label><button disabled={busy || !canWorkConsolidation || ![normalize(selectedConsolidation.soNumber), normalize(shortSo(selectedConsolidation.soNumber))].includes(normalize(soScan))} onClick={() => void applyAction(selectedConsolidation.batchId, "COMPLETE_CONSOLIDATION", undefined, undefined, selectedConsolidation.soNumber)}>SO lengkap · Kirim ke staging helper</button></div> : <div className="task-complete-state"><strong>SO consolidated</strong><span>Barang siap diambil Staging Helper.</span></div>}
          </>}
        </aside>
      </section>}
    </section>
  );
}
