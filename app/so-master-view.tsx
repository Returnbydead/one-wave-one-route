"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type SoMasterRow = { so_number: string; destinations: string; zones: string; statuses: string; request_qty: number | string; sku_count: number | string; fragment_count: number };
type SoMasterPayload = { ok: boolean; operationalDate?: string; generatedAt?: string; stale?: boolean; rowCount: number; soCount: number; filteredCount: number; page: number; pageSize: number; rows: SoMasterRow[]; destinations: string[]; statuses: string[]; zones: string[] };
type SoMasterFragment = { destination_name: string; zone: string; status: string; request_qty: number | string; sku_count: number };
type DetailTab = "basic" | "fragments";

const PAGE_SIZE = 50;

function idNumber(value: number | string | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString("id-ID") : "0";
}

function formatTimestamp(value?: string) {
  if (!value) return "Belum ada snapshot";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function statusTone(value: string) {
  const current = value.toUpperCase();
  if (current.includes("COMPLET") || current.includes("DONE")) return "done";
  if (current.includes("PICK")) return "picking";
  if (current.includes("PACK")) return "packing";
  return "new";
}

export function SoMasterView() {
  const [payload, setPayload] = useState<SoMasterPayload | null>(null);
  const [query, setQuery] = useState("");
  const [destination, setDestination] = useState("");
  const [status, setStatus] = useState("");
  const [zone, setZone] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRow, setSelectedRow] = useState<SoMasterRow | null>(null);
  const [details, setDetails] = useState<SoMasterFragment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("basic");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("owor_search_so_master", { p_query: query.trim(), p_destination: destination, p_status: status, p_zone: zone, p_page: page, p_page_size: PAGE_SIZE });
    if (rpcError) { setError(rpcError.message); setLoading(false); return; }
    const next = data as SoMasterPayload;
    setPayload(next);
    if (!next.ok) setError("Snapshot SO lengkap belum tersedia. Tunggu sync berikutnya.");
    setLoading(false);
  }, [destination, page, query, status, zone]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  async function openDetail(row: SoMasterRow) {
    setSelectedRow(row);
    setDetailTab("basic");
    setDetailLoading(true);
    const { data, error: rpcError } = await supabase.rpc("owor_get_so_master_detail", { p_so_number: row.so_number });
    const result = data as { fragments?: SoMasterFragment[] } | null;
    setDetails(!rpcError && Array.isArray(result?.fragments) ? result.fragments : []);
    setDetailLoading(false);
  }

  const pageCount = useMemo(() => Math.max(1, Math.ceil(Number(payload?.filteredCount ?? 0) / PAGE_SIZE)), [payload?.filteredCount]);
  const detailTotals = useMemo(() => ({ qty: details.reduce((sum, item) => sum + Number(item.request_qty || 0), 0), sku: details.reduce((sum, item) => sum + Number(item.sku_count || 0), 0) }), [details]);

  function resetFilters() { setQuery(""); setDestination(""); setStatus(""); setZone(""); setPage(1); }

  if (selectedRow) {
    return (
      <section className="so-master-workspace so-detail-workspace">
        <button className="so-detail-back" onClick={() => { setSelectedRow(null); setDetails([]); }}>← Kembali ke SO Master</button>
        <div className="so-detail-titlebar">
          <div><p className="eyebrow">SUPPLY ORDER · LIVE DETAIL</p><h2>Detail SO</h2><p>{selectedRow.so_number}</p></div>
          <span className="so-status-pill" data-tone={statusTone(selectedRow.statuses)}>{selectedRow.statuses}</span>
        </div>
        <div className="so-detail-layout">
          <nav className="so-detail-tabs" aria-label="Bagian detail SO">
            <button className={detailTab === "basic" ? "active" : ""} aria-current={detailTab === "basic" ? "page" : undefined} onClick={() => setDetailTab("basic")}><b>Detail dasar</b><span>Ringkasan operasional SO</span></button>
            <button className={detailTab === "fragments" ? "active" : ""} aria-current={detailTab === "fragments" ? "page" : undefined} onClick={() => setDetailTab("fragments")}><b>Detail distribusi</b><span>Destination, zone, dan status</span></button>
          </nav>
          <section className="so-detail-content">
            {detailTab === "basic" ? (
              <>
                <div className="so-detail-card">
                  <div className="so-detail-card-head"><div><span>OVERVIEW</span><h3>Detail dasar</h3></div><div className="airo-orbit" aria-hidden="true"><i /><b>1W</b></div></div>
                  <dl className="so-detail-definition">
                    <div><dt>Nomor Supply Order</dt><dd>{selectedRow.so_number}</dd></div>
                    <div><dt>Status terkini</dt><dd><span className="so-status-pill" data-tone={statusTone(selectedRow.statuses)}>{selectedRow.statuses}</span></dd></div>
                    <div><dt>Destination</dt><dd>{selectedRow.destinations}</dd></div>
                    <div><dt>Picking zone</dt><dd>{selectedRow.zones}</dd></div>
                    <div><dt>Tanggal operasional</dt><dd>{payload?.operationalDate ?? "–"}</dd></div>
                    <div><dt>Snapshot diperbarui</dt><dd>{formatTimestamp(payload?.generatedAt)}</dd></div>
                  </dl>
                </div>
                <div className="so-detail-callout"><span>AIRO OPS NOTE</span><b>Satu SO tetap dibaca utuh.</b><p>Pecahan di bawah hanya menunjukkan distribusi data Superset per destination, zone, dan status—bukan memecah task assignment.</p></div>
              </>
            ) : (
              <div className="so-detail-card so-fragment-card">
                <div className="so-detail-card-head"><div><span>LIVE DISTRIBUTION</span><h3>Detail distribusi SO</h3></div><b>{details.length} baris</b></div>
                {detailLoading ? <div className="so-master-empty">Memuat detail SO…</div> : details.map((item, index) => (
                  <article key={`${item.destination_name}-${item.zone}-${item.status}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><small>DESTINATION</small><strong>{item.destination_name}</strong></div><div><small>ZONE</small><strong>{item.zone}</strong></div><div><small>STATUS</small><strong>{item.status}</strong></div><div><small>REQUEST QTY</small><strong>{idNumber(item.request_qty)}</strong></div><div><small>SKU</small><strong>{idNumber(item.sku_count)}</strong></div></article>
                ))}
              </div>
            )}
          </section>
          <aside className="so-detail-summary">
            <div><span>RANGKUMAN SO</span><h3>Load summary</h3><dl><div><dt>Total request</dt><dd>{idNumber(detailTotals.qty || selectedRow.request_qty)}</dd></div><div><dt>Total SKU</dt><dd>{idNumber(detailTotals.sku || selectedRow.sku_count)}</dd></div><div><dt>Data fragment</dt><dd>{idNumber(selectedRow.fragment_count)}</dd></div></dl></div>
            <div><span>DATA SOURCE</span><h3>Superset snapshot</h3><p>{payload?.stale ? "Menampilkan snapshot valid terakhir." : "Sinkron dan siap dipakai operasional."}</p></div>
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className="so-master-workspace">
      <div className="so-master-titlebar"><div><p className="eyebrow">ALL CBT DESTINATIONS · CURRENT DAY</p><h2>Supply Order</h2><p>Kelola dan pantau SO operasional CBT. Status CANCELLED tidak dimuat. Klik satu baris untuk membuka detail.</p></div><div className="so-master-freshness" data-stale={payload?.stale === true}><span>{payload?.stale ? "LAST VALID" : "LIVE"}</span><strong>{formatTimestamp(payload?.generatedAt)}</strong><small>{payload?.operationalDate ?? "–"}</small></div></div>
      <div className="so-master-metrics"><article><span>Total SO</span><strong>{idNumber(payload?.soCount)}</strong><small>semua destination CBT</small></article><article><span>Baris compact</span><strong>{idNumber(payload?.rowCount)}</strong><small>SO × destination × zone × status</small></article><article><span>Sesuai filter</span><strong>{idNumber(payload?.filteredCount)}</strong><small>hasil dihitung server-side</small></article></div>
      <section className="so-master-panel panel">
        <div className="so-master-filterbar">
          <label className="so-master-search"><span>Cari SO / destination / zone</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Scan nomor SO atau ketik destination..." /></label>
          <label><span>Destination</span><select value={destination} onChange={(event) => { setDestination(event.target.value); setPage(1); }}><option value="">Semua</option>{(payload?.destinations ?? []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>Zone</span><select value={zone} onChange={(event) => { setZone(event.target.value); setPage(1); }}><option value="">Semua</option>{(payload?.zones ?? []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <button onClick={resetFilters}>Reset filter</button>
        </div>
        <div className="so-master-status-tabs" role="tablist" aria-label="Filter status SO"><button role="tab" aria-selected={!status} className={!status ? "active" : ""} onClick={() => { setStatus(""); setPage(1); }}>Semua</button>{(payload?.statuses ?? []).map((item) => <button role="tab" aria-selected={status === item} className={status === item ? "active" : ""} key={item} onClick={() => { setStatus(item); setPage(1); }}>{item}</button>)}</div>
        {error && <div className="so-master-error"><b>SO Master belum siap</b><span>{error}</span></div>}
        {!error && loading && <div className="so-master-empty">Memuat halaman SO dari Supabase…</div>}
        {!error && !loading && !(payload?.rows ?? []).length && <div className="so-master-empty">Tidak ada SO yang cocok dengan filter ini.</div>}
        {!error && !loading && Boolean(payload?.rows?.length) && (
          <div className="so-master-table-wrap"><div className="so-master-table-head"><span>Nomor SO</span><span>Destination</span><span>Zone</span><span>Status</span><span>Request Qty</span><span>SKU</span><span /></div>{payload!.rows.map((row) => (
            <button className="so-master-table-row" key={row.so_number} onClick={() => void openDetail(row)} aria-label={`Buka detail SO ${row.so_number}`}><strong>{row.so_number}<small>SUPPLY ORDER</small></strong><span>{row.destinations}</span><span>{row.zones}</span><span><i data-tone={statusTone(row.statuses)}>{row.statuses}</i></span><b>{idNumber(row.request_qty)}</b><b>{idNumber(row.sku_count)}</b><em>Detail →</em></button>
          ))}</div>
        )}
        <footer className="so-master-pagination"><span>Halaman {page} dari {pageCount} · maksimal {PAGE_SIZE} SO per halaman</span><div><button disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>← Sebelumnya</button><button disabled={page >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>Berikutnya →</button></div></footer>
      </section>
    </section>
  );
}
