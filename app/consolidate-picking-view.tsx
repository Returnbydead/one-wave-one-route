"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type Allocation = {
  soNumber: string;
  hubCode: string;
  waveNumber: number;
  requestQty: number;
};

type PickItem = {
  pickingAreaName: string;
  zoneFamily: string;
  floorNumber: number;
  originRackName: string;
  skuNumber: string;
  productName: string;
  expiryDate?: string | null;
  totalQty: number;
  soCount: number;
  waves: number[];
  allocations: Allocation[];
};

type ConsolidateSnapshot = {
  ok: boolean;
  generatedAt?: string | null;
  operationalDate?: string | null;
  stale?: boolean;
  scope?: { code: string; zoneFamily: string; minLevel: number; excludedWaves: number[] } | null;
  totals?: { pickRows: number; soCount: number; totalQty: number };
  picklist?: PickItem[];
};

const number = (value: number) => new Intl.NumberFormat("id-ID").format(Number(value || 0));

function shortSo(value: string) {
  const parts = String(value || "").split("/").filter(Boolean);
  return parts.at(-1) || value;
}

function freshness(value?: string | null) {
  if (!value) return "Belum ada snapshot";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function ConsolidatePickingView() {
  const [snapshot, setSnapshot] = useState<ConsolidateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("ALL");
  const [expanded, setExpanded] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("owor_get_consolidate_picklist", { p_scope_code: "SRA_L2_UP" });
    if (error) {
      setSnapshot(null);
      setMessage(error.message || "Picklist belum bisa dibaca");
    } else {
      setSnapshot(data as ConsolidateSnapshot);
      setMessage("");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function runSync() {
    setSyncing(true);
    setMessage("Mengambil batch picklist terbaru dari Superset…");
    const { data, error } = await supabase.functions.invoke("owor-admin", {
      method: "POST",
      body: { action: "sync_consolidate", scope: "SRA_L2_UP" },
    });
    const payload = data as { ok?: boolean; error?: string; diagnostics?: { unmappedWave?: number } } | null;
    if (error || payload?.ok !== true) {
      setMessage(payload?.error || error?.message || "Sync consolidate gagal");
      setSyncing(false);
      return;
    }
    setMessage(payload.diagnostics?.unmappedWave ? `${payload.diagnostics.unmappedWave} row tidak punya mapping wave dan dilewati.` : "Snapshot terbaru berhasil diterbitkan.");
    await load();
    setSyncing(false);
  }

  const rows = useMemo(() => snapshot?.picklist ?? [], [snapshot?.picklist]);
  const areas = useMemo(() => [...new Set(rows.map((row) => row.pickingAreaName))].sort(), [rows]);
  const filtered = useMemo(() => {
    const query = search.trim().toUpperCase();
    return rows.filter((row) => {
      if (area !== "ALL" && row.pickingAreaName !== area) return false;
      if (!query) return true;
      return [row.pickingAreaName, row.originRackName, row.skuNumber, row.productName, ...row.allocations.flatMap((item) => [item.soNumber, item.hubCode])]
        .some((value) => String(value || "").toUpperCase().includes(query));
    });
  }, [area, rows, search]);

  const visibleQty = filtered.reduce((total, row) => total + Number(row.totalQty || 0), 0);
  const visibleSo = new Set(filtered.flatMap((row) => row.allocations.map((item) => item.soNumber))).size;

  return (
    <section className="consolidate-workspace" aria-labelledby="consolidate-title">
      <div className="consolidate-hero">
        <div>
          <p className="eyebrow">CBT · BATCH PICKING PILOT</p>
          <h2 id="consolidate-title">Consolidate <em>picking</em></h2>
          <p>Ambil barang lintas SO berdasarkan rack dan SKU, lalu pecah kembali sesuai allocation SO.</p>
        </div>
        <div className="consolidate-scope-card">
          <span>ACTIVE SCOPE</span>
          <strong>SRA · LEVEL 2+</strong>
          <small>Wave 2–4 · Wave 1 dikecualikan</small>
        </div>
      </div>

      <div className="consolidate-status" aria-live="polite">
        <span data-state={snapshot?.ok ? (snapshot.stale ? "stale" : "live") : "empty"}><i />{snapshot?.ok ? (snapshot.stale ? "Last valid snapshot" : "Live picklist") : "Snapshot belum tersedia"}</span>
        <small>{freshness(snapshot?.generatedAt)}{snapshot?.operationalDate ? ` · operational ${snapshot.operationalDate}` : ""}</small>
        <div>
          <button className="soft-button" disabled={loading || syncing} onClick={() => void load()}>↻ Refresh view</button>
          <button className="primary-button" disabled={syncing} onClick={() => void runSync()}>{syncing ? "Syncing…" : "Sync Superset"}</button>
        </div>
      </div>
      {message && <div className="consolidate-message" role="status">{message}</div>}

      <div className="consolidate-kpis" aria-label="Ringkasan consolidate picking">
        <article><span>PICK ROWS</span><strong>{number(snapshot?.totals?.pickRows || 0)}</strong><small>rack × SKU × expiry</small></article>
        <article><span>TOTAL QTY</span><strong>{number(snapshot?.totals?.totalQty || 0)}</strong><small>trial SRA L2+</small></article>
        <article><span>SALES ORDER</span><strong>{number(snapshot?.totals?.soCount || 0)}</strong><small>allocation tujuan</small></article>
        <article className="accent"><span>VISIBLE QTY</span><strong>{number(visibleQty)}</strong><small>{number(visibleSo)} SO pada filter</small></article>
      </div>

      <section className="consolidate-panel">
        <div className="consolidate-panel-head">
          <div><span>01</span><div><h3>Batch picklist</h3><p>Urutan kerja: picking area → rack → SKU</p></div></div>
          <div className="consolidate-filters">
            <label><span className="sr-only">Filter picking area</span><select value={area} onChange={(event) => setArea(event.target.value)}><option value="ALL">Semua picking area</option>{areas.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span className="sr-only">Cari picklist</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari rack, SKU, SO, hub…" /></label>
          </div>
        </div>

        {loading ? <div className="consolidate-empty"><strong>Memuat picklist…</strong><span>Membaca snapshot Supabase.</span></div> : !snapshot?.ok ? (
          <div className="consolidate-empty"><strong>Picklist belum diterbitkan</strong><span>Klik Sync Superset untuk membuat snapshot pertama SRA level 2+.</span></div>
        ) : !filtered.length ? (
          <div className="consolidate-empty"><strong>Tidak ada row pada filter ini</strong><span>Ubah picking area atau kata pencarian.</span></div>
        ) : (
          <div className="consolidate-list">
            <div className="consolidate-list-label"><span>Area / rack</span><span>SKU / product</span><span>Wave</span><span>Qty</span><span>SO</span><span /></div>
            {filtered.map((row) => {
              const key = [row.pickingAreaName, row.originRackName, row.skuNumber, row.expiryDate || ""].join("::");
              const open = expanded === key;
              return <article className="consolidate-row" key={key} data-open={open}>
                <div className="consolidate-row-main">
                  <span className="consolidate-rack"><b>{row.pickingAreaName}</b><strong>{row.originRackName}</strong><small>Floor {row.floorNumber}</small></span>
                  <span className="consolidate-product"><strong>{row.skuNumber}</strong><b>{row.productName || "Product name unavailable"}</b><small>{row.expiryDate ? `Expiry ${row.expiryDate}` : "Expiry tidak tersedia"}</small></span>
                  <span className="consolidate-waves">{row.waves.map((wave) => <i key={wave}>W{wave}</i>)}</span>
                  <span className="consolidate-qty"><strong>{number(row.totalQty)}</strong><small>qty</small></span>
                  <span className="consolidate-so"><strong>{number(row.soCount)}</strong><small>SO</small></span>
                  <button aria-expanded={open} aria-label={`${open ? "Tutup" : "Buka"} allocation SKU ${row.skuNumber}`} onClick={() => setExpanded(open ? "" : key)}>{open ? "−" : "+"}</button>
                </div>
                {open && <div className="consolidate-allocations">
                  <div className="consolidate-allocation-head"><span>SO ID</span><span>Hub</span><span>Wave</span><span>Request qty</span></div>
                  {row.allocations.map((item) => <div key={`${item.soNumber}-${item.hubCode}-${item.waveNumber}`}><span><strong>{shortSo(item.soNumber)}</strong><small>{item.soNumber}</small></span><b>{item.hubCode}</b><i>WAVE {item.waveNumber}</i><strong>{number(item.requestQty)}</strong></div>)}
                </div>}
              </article>;
            })}
          </div>
        )}
      </section>
    </section>
  );
}
