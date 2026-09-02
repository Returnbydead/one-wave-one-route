"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import { taskContainsRice5Kg } from "./koli-audit-core.mjs";

type User = { staffId: string; name: string; roles: string[] };
type Line = { lineId: number; sku: string; productName: string; expectedQty: number; auditedQty: number | null; confirmedAt?: string | null };
type Task = { taskId: string; koliCode: string; soNumber: string; hubCode: string; destinationName: string; sourceStatus: string; status: "READY" | "IN_PROGRESS" | "COMPLETED"; auditorId: string; discrepancyConfirmed: boolean; startedAt?: string | null; completedAt?: string | null; updatedAt?: string | null; lines: Line[] };

const n = (v: number) => Number(v || 0).toLocaleString("id-ID");

export function KoliAuditView({ user }: { user: User }) {
  const isDeveloper = user.roles.includes("DEVELOPER");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [hub, setHub] = useState("ALL");
  const [productFilter, setProductFilter] = useState<"ALL" | "RICE_5KG">("ALL");
const [busy, setBusy] = useState(false);
  const [qtyDrafts, setQtyDrafts] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraTarget, setCameraTarget] = useState<"KOLI" | "SKU">("KOLI");
  const [verifiedSku, setVerifiedSku] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<{ stop: () => void } | null>(null);
  const qtyTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const selected = tasks.find((t) => t.taskId === selectedId) || null;

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("owor_get_koli_audit_tasks", { p_search: "" });
    if (error) { setMessage(error.message); return; }
    setTasks((data || []) as Task[]);
    setSelectedId((current) => current || data?.[0]?.taskId || "");
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => () => { readerRef.current?.stop(); streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  const hubs = useMemo(() => [...new Set(tasks.map((task) => task.hubCode).filter(Boolean))].sort(), [tasks]);
  const filtered = useMemo(() => tasks.filter((task) =>
    (hub === "ALL" || task.hubCode === hub)
    && (productFilter === "ALL" || taskContainsRice5Kg(task))
    && `${task.koliCode} ${task.soNumber} ${task.destinationName} ${task.hubCode}`.toLowerCase().includes(search.toLowerCase())
  ), [hub, productFilter, search, tasks]);
  const discrepancy = Boolean(selected?.lines.some((line) => line.auditedQty !== null && Number(line.auditedQty) !== Number(line.expectedQty)));
  const complete = Boolean(selected && selected.lines.length > 0 && selected.lines.every((line) => line.auditedQty !== null));

  async function claim() {
    if (!selected) return; setBusy(true); const { error } = await supabase.rpc("owor_claim_koli_audit", { p_task_id: selected.taskId }); setBusy(false); if (error) setMessage(error.message); else { setMessage("Task audit diambil"); await load(); }
  }
  function confirm(line: Line, value: string) {
    const existing = qtyTimers.current[line.lineId];
    if (existing) clearTimeout(existing);
    if (!selected || value === "") return;
    qtyTimers.current[line.lineId] = setTimeout(async () => {
      const qty = Number(value); if (!Number.isFinite(qty) || qty < 0) return;
      if (verifiedSku && verifiedSku !== line.sku) { setMessage(`SKU yang discan ${verifiedSku} tidak cocok dengan baris ${line.sku}`); return; }
      setBusy(true); const { error } = await supabase.rpc("owor_confirm_koli_audit_line", { p_task_id: selected.taskId, p_line_id: line.lineId, p_qty: qty }); setBusy(false); if (error) setMessage(error.message); else { setQtyDrafts((current) => { const next = { ...current }; delete next[line.lineId]; return next; }); setMessage(`SKU ${line.sku} tersimpan`); await load(); }
    }, 650);
  }
  async function finish() {
    if (!selected) return; let note = ""; if (discrepancy) { note = window.prompt("Ada selisih. Tulis catatan temuan auditor:", "") || ""; if (!note.trim()) return; }
    setBusy(true); const { error } = await supabase.rpc("owor_complete_koli_audit", { p_task_id: selected.taskId, p_discrepancy_confirmed: discrepancy, p_note: note }); setBusy(false); if (error) setMessage(error.message); else { setMessage("Audit koli selesai dan tersimpan"); await load(); }
  }
  async function syncToday() {
    setBusy(true); setMessage("Mengambil semua koli hari ini dari Superset…");
    const { data, error } = await supabase.functions.invoke("owor-admin", { method: "POST", body: { action: "sync_koli_audit" } });
    const payload = data as { ok?: boolean; error?: string } | null;
    let errorMessage = payload?.error || error?.message || "Sync audit koli gagal";
    if (error && "context" in error) {
      try {
        const response = (error as { context?: Response }).context;
        const detail = response ? await response.clone().json() as { error?: string; message?: string } : null;
        errorMessage = detail?.error || detail?.message || errorMessage;
      } catch {
        // Keep the SDK fallback when the response is not JSON.
      }
    }
    if (error || payload?.ok !== true) setMessage(errorMessage);
    else { setMessage("Semua koli hari ini sudah diperbarui."); await load(); }
    setBusy(false);
  }
  function exportCsv() {
    const rows = tasks.flatMap((task) => task.lines.map((line) => [task.koliCode, task.soNumber, task.hubCode, task.destinationName, task.status, task.auditorId, task.startedAt ?? "", task.completedAt ?? "", task.updatedAt ?? "", line.sku, line.productName, line.expectedQty, line.auditedQty ?? "", line.confirmedAt ?? "", Number(line.auditedQty ?? 0) - Number(line.expectedQty)]));
    const csv = [["koli_code","so_number","hub","destination","task_status","auditor_id","started_at","completed_at","updated_at","sku","product_name","expected_qty","audited_qty","confirmed_at","difference"], ...rows].map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `audit-koli-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  async function startCamera(target: "KOLI" | "SKU") {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setMessage("Kamera butuh HTTPS dan izin browser"); return; }
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      setCameraTarget(target); setCameraOpen(true);
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (!videoRef.current) return;
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      const deviceId = devices.find((device) => /back|environment|rear/i.test(device.label))?.deviceId || devices[0]?.deviceId;
      const controls = await reader.decodeFromVideoDevice(deviceId, videoRef.current, (result) => {
        if (!result) return;
        const value = result.getText().trim();
        if (target === "KOLI") {
          setSearch(value);
          const match = tasks.find((task) => task.koliCode.trim().toUpperCase() === value.toUpperCase());
          if (match) { setSelectedId(match.taskId); setMessage(`Koli ${value} terverifikasi`); controls.stop(); setCameraOpen(false); }
          else setMessage(`Barcode koli ${value} tidak ada di task audit`);
        } else { setVerifiedSku(value); setMessage(`SKU ${value} discan. Masukkan qty audit pada baris yang sesuai.`); controls.stop(); setCameraOpen(false); }
      });
      readerRef.current = controls;
    } catch { setCameraOpen(false); setMessage("Kamera/scanner tidak bisa dibuka. Cek izin kamera HP/SEUIC."); }
  }
  return <section className="koli-audit-workspace">
    <div className="koli-audit-hero"><div><p className="eyebrow">OUTBOUND QUALITY CONTROL</p><h2>Audit <em>koli</em></h2><p>Scan koli, cocokkan SKU dan qty, lalu simpan histori selisih.</p></div><div>{isDeveloper && <button className="secondary-button" disabled={busy} onClick={() => void syncToday()}>↻ Sync koli hari ini</button>}<button className="secondary-button" onClick={exportCsv}>↓ Download hasil audit</button></div></div>
    <div className="koli-audit-grid"><section className="koli-audit-panel koli-task-panel"><div className="koli-audit-panel-head"><div><span>01</span><h3>Task audit koli</h3></div><div className="koli-audit-filters"><select aria-label="Filter hub" value={hub} onChange={(e) => setHub(e.target.value)}><option value="ALL">Semua hub</option>{hubs.map((item) => <option key={item} value={item}>{item}</option>)}</select><select aria-label="Filter produk audit" value={productFilter} onChange={(e) => setProductFilter(e.target.value as "ALL" | "RICE_5KG")}><option value="ALL">Semua produk</option><option value="RICE_5KG">Khusus beras 5 KG</option></select><div className="koli-search-box"><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari koli, SO, tujuan…" /><button type="button" aria-label="Scan koli untuk pencarian" onClick={() => void startCamera("KOLI")}>▣</button></div></div></div><div className="koli-task-list">{filtered.map((task) => <button key={task.taskId} className={selectedId === task.taskId ? "active" : ""} onClick={() => setSelectedId(task.taskId)}><span><b>{task.koliCode}</b><small>{task.hubCode || "Hub -"} · SO {task.soNumber} · {task.destinationName || "-"}</small></span><strong>{task.lines.length} SKU<br /><small>{task.status}</small></strong></button>)}{!filtered.length && <div className="koli-empty">Tidak ada koli yang cocok dengan filter hari ini.</div>}</div></section>
      <section className="koli-audit-panel koli-detail-panel">{!selected ? <div className="koli-empty">Pilih task koli untuk mulai audit.</div> : <><div className="koli-detail-head"><div><span>02 · {selected.status}</span><h3>{selected.koliCode}</h3><p>SO {selected.soNumber} · {selected.destinationName || "Tujuan belum tersedia"}</p></div>{selected.status === "READY" && <button className="primary-button" disabled={busy} onClick={() => void claim()}>Ambil task</button>}</div>{selected.status !== "READY" && <div className="koli-scan-tools"><button onClick={() => void startCamera("KOLI")}>▣ Scan koli</button><span>Auditor: {selected.auditorId || user.staffId}</span></div>}<div className="koli-line-list">{selected.lines.map((line) => <article key={line.lineId} className={line.auditedQty !== null ? (Number(line.auditedQty) === Number(line.expectedQty) ? "matched" : "different") : ""}><div><b>{line.sku}</b><strong>{line.productName || "Nama produk belum tersedia"}</strong></div><span>Expected <b>{n(line.expectedQty)}</b></span><label>Qty audit<input inputMode="numeric" type="text" pattern="[0-9]*" autoComplete="off" enterKeyHint="done" value={Object.prototype.hasOwnProperty.call(qtyDrafts, line.lineId) ? qtyDrafts[line.lineId] : (line.auditedQty ?? "")} disabled={selected.status !== "IN_PROGRESS" || busy} onChange={(e) => { const value = e.target.value.replace(/[^0-9]/g, ""); setQtyDrafts((current) => ({ ...current, [line.lineId]: value })); confirm(line, value); }} onBlur={() => confirm(line, qtyDrafts[line.lineId] ?? String(line.auditedQty ?? ""))} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label><button className="sku-scan-button" disabled={selected.status !== "IN_PROGRESS"} onClick={() => void startCamera("SKU")}>Scan SKU</button></article>)}</div>{selected.status === "IN_PROGRESS" && <button className="primary-button koli-complete-button" disabled={!complete || busy} onClick={() => void finish()}>Selesaikan audit{discrepancy ? " · Konfirmasi selisih" : ""}</button>}</>}</section></div>
    {message && <div className="koli-audit-message" role="status">{message}</div>}{cameraOpen && <div className="koli-camera-modal" role="dialog"><div><video ref={videoRef} muted playsInline /><p>Scanner {cameraTarget === "KOLI" ? "koli" : "SKU"} aktif. Arahkan barcode ke kamera.</p><button onClick={() => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setCameraOpen(false); }}>Tutup kamera</button></div></div>}
  </section>;
}
