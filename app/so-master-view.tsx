"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

type SoMasterRow = {
  so_number: string;
  destinations: string;
  zones: string;
  statuses: string;
  request_qty: number | string;
  sku_count: number | string;
  fragment_count: number;
};

type SoMasterPayload = {
  ok: boolean;
  operationalDate?: string;
  generatedAt?: string;
  stale?: boolean;
  rowCount: number;
  soCount: number;
  filteredCount: number;
  page: number;
  pageSize: number;
  rows: SoMasterRow[];
  destinations: string[];
  statuses: string[];
  zones: string[];
};

type SoMasterFragment = {
  destination_name: string;
  zone: string;
  status: string;
  request_qty: number | string;
  sku_count: number;
};

const PAGE_SIZE = 50;

function idNumber(value: number | string | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString("id-ID") : "0";
}

function formatTimestamp(value?: string) {
  if (!value) return "Belum ada snapshot";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [selectedSo, setSelectedSo] = useState("");
  const [details, setDetails] = useState<SoMasterFragment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("owor_search_so_master", {
      p_query: query.trim(),
      p_destination: destination,
      p_status: status,
      p_zone: zone,
      p_page: page,
      p_page_size: PAGE_SIZE,
    });
    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }
    const next = data as SoMasterPayload;
    setPayload(next);
    if (!next.ok) setError("Snapshot SO lengkap belum tersedia. Tunggu sync berikutnya.");
    setLoading(false);
  }, [destination, page, query, status, zone]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  async function openDetail(soNumber: string) {
    if (selectedSo === soNumber) {
      setSelectedSo("");
      setDetails([]);
      return;
    }
    setSelectedSo(soNumber);
    setDetailLoading(true);
    const { data, error: rpcError } = await supabase.rpc("owor_get_so_master_detail", {
      p_so_number: soNumber,
    });
    const result = data as { fragments?: SoMasterFragment[] } | null;
    setDetails(!rpcError && Array.isArray(result?.fragments) ? result.fragments : []);
    setDetailLoading(false);
  }

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(Number(payload?.filteredCount ?? 0) / PAGE_SIZE)),
    [payload?.filteredCount],
  );

  function resetFilters() {
    setQuery("");
    setDestination("");
    setStatus("");
    setZone("");
    setPage(1);
  }

  return (
    <section className="so-master-workspace">
      <div className="so-master-titlebar">
        <div>
          <p className="eyebrow">ALL CBT DESTINATIONS · CURRENT DAY</p>
          <h2>SO Master</h2>
          <p>Dataset lengkap terpisah dari kandidat IWIR. Status CANCELLED tidak dimuat.</p>
        </div>
        <div className="so-master-freshness" data-stale={payload?.stale === true}>
          <span>{payload?.stale ? "LAST VALID" : "LIVE"}</span>
          <strong>{formatTimestamp(payload?.generatedAt)}</strong>
          <small>{payload?.operationalDate ?? "–"}</small>
        </div>
      </div>

      <div className="so-master-metrics">
        <article><span>Total SO</span><strong>{idNumber(payload?.soCount)}</strong><small>semua destination CBT</small></article>
        <article><span>Baris compact</span><strong>{idNumber(payload?.rowCount)}</strong><small>SO × destination × zone × status</small></article>
        <article><span>Sesuai filter</span><strong>{idNumber(payload?.filteredCount)}</strong><small>hasil dihitung server-side</small></article>
      </div>

      <section className="so-master-panel panel">
        <div className="so-master-filterbar">
          <label className="so-master-search"><span>Cari SO / destination / zone</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Scan nomor SO atau ketik destination..." /></label>
          <label><span>Destination</span><select value={destination} onChange={(event) => { setDestination(event.target.value); setPage(1); }}><option value="">Semua</option>{(payload?.destinations ?? []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Semua</option>{(payload?.statuses ?? []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>Zone</span><select value={zone} onChange={(event) => { setZone(event.target.value); setPage(1); }}><option value="">Semua</option>{(payload?.zones ?? []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <button onClick={resetFilters}>Reset</button>
        </div>

        {error && <div className="so-master-error"><b>SO Master belum siap</b><span>{error}</span></div>}
        {!error && loading && <div className="so-master-empty">Memuat halaman SO dari Supabase…</div>}
        {!error && !loading && !(payload?.rows ?? []).length && <div className="so-master-empty">Tidak ada SO yang cocok dengan filter ini.</div>}

        {!error && !loading && Boolean(payload?.rows?.length) && (
          <div className="so-master-table-wrap">
            <div className="so-master-table-head"><span>SO Number</span><span>Destination</span><span>Zone</span><span>Status</span><span>Request Qty</span><span>SKU</span><span /></div>
            {payload!.rows.map((row) => (
              <div className="so-master-row-group" key={row.so_number}>
                <div className="so-master-table-row">
                  <strong>{row.so_number}</strong>
                  <span>{row.destinations}</span>
                  <span>{row.zones}</span>
                  <span><i>{row.statuses}</i></span>
                  <b>{idNumber(row.request_qty)}</b>
                  <b>{idNumber(row.sku_count)}</b>
                  <button onClick={() => void openDetail(row.so_number)}>{selectedSo === row.so_number ? "Tutup" : "Detail"}</button>
                </div>
                {selectedSo === row.so_number && (
                  <div className="so-master-detail">
                    {detailLoading ? <span>Memuat pecahan SO…</span> : details.map((item, index) => (
                      <article key={`${item.destination_name}-${item.zone}-${item.status}-${index}`}>
                        <div><small>DESTINATION</small><strong>{item.destination_name}</strong></div>
                        <div><small>ZONE</small><strong>{item.zone}</strong></div>
                        <div><small>STATUS</small><strong>{item.status}</strong></div>
                        <div><small>REQUEST QTY</small><strong>{idNumber(item.request_qty)}</strong></div>
                        <div><small>SKU</small><strong>{idNumber(item.sku_count)}</strong></div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <footer className="so-master-pagination">
          <span>Halaman {page} dari {pageCount} · maksimal {PAGE_SIZE} SO per halaman</span>
          <div><button disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>← Sebelumnya</button><button disabled={page >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>Berikutnya →</button></div>
        </footer>
      </section>
    </section>
  );
}
