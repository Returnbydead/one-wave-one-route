"use client";

import { useMemo, useState } from "react";
import { PICKER_ROSTER } from "./picker-roster";

type RouteCode = "SWL - PSG" | "SMN - MRY" | "BSX";

type SalesOrder = {
  soNumber: string;
  destination: "SWL" | "PSG" | "SMN" | "MRY" | "BSX";
  route: RouteCode;
  zone: string;
  qty: number;
  sku: number;
};

type Picker = {
  staffId: string;
  name: string;
  zone: string;
  productivity: number;
  shift: string;
};

type Assignment = {
  route: RouteCode;
  zone: string;
  picker: Picker;
  orders: SalesOrder[];
  totalQty: number;
  source: "auto" | "manual";
};

type ManualOverrides = Record<string, string>;

type ZoneRule = {
  zone: string;
  productivity: number;
};

const ROUTES: Array<{
  code: RouteCode;
  destinations: string[];
  routeNo: number;
  color: string;
}> = [
  {
    code: "SWL - PSG",
    destinations: ["SWL", "PSG"],
    routeNo: 1,
    color: "#f36c3d",
  },
  {
    code: "SMN - MRY",
    destinations: ["SMN", "MRY"],
    routeNo: 2,
    color: "#7c63e6",
  },
  { code: "BSX", destinations: ["BSX"], routeNo: 5, color: "#2f9e85" },
];

const ZONE_RULES: ZoneRule[] = [
  { zone: "MZE", productivity: 1800 },
  { zone: "MZF", productivity: 1800 },
  { zone: "MZC 2", productivity: 2300 },
  { zone: "MZD 1", productivity: 2300 },
  { zone: "SPR A1-1", productivity: 3200 },
  { zone: "SPR C1-1", productivity: 3000 },
];

const AUTO_PICKERS: Picker[] = [
  { staffId: "52016", name: "Muhammad Faris Gumay", zone: "MZE", productivity: 2400, shift: "05:00–14:00" },
  { staffId: "49605", name: "Faizal Arifin", zone: "MZF", productivity: 2400, shift: "05:00–14:00" },
  { staffId: "48113", name: "Jonathan Syah", zone: "MZC 2", productivity: 2800, shift: "05:00–14:00" },
  { staffId: "52018", name: "Irpan Muryadi", zone: "MZC 2", productivity: 2800, shift: "13:00–22:00" },
  { staffId: "43194", name: "Ahmad Dhoefan", zone: "MZD 1", productivity: 2300, shift: "05:00–14:00" },
  { staffId: "48408", name: "Abdul Aziz Yulianto", zone: "SPR C1-1", productivity: 3000, shift: "05:00–14:00" },
  { staffId: "48387", name: "Fahrul Nugroho", zone: "SPR C1-1", productivity: 3000, shift: "05:00–14:00" },
  { staffId: "51027", name: "Rizky Ramadhan", zone: "SPR A1-1", productivity: 3200, shift: "05:00–14:00" },
  { staffId: "51188", name: "Asep Firmansyah", zone: "MZE", productivity: 1800, shift: "05:00–14:00" },
  { staffId: "51402", name: "Dimas Saputra", zone: "MZF", productivity: 1800, shift: "05:00–14:00" },
  { staffId: "51546", name: "Rangga Pratama", zone: "MZD 1", productivity: 2300, shift: "05:00–14:00" },
  { staffId: "51721", name: "Bagus Setiawan", zone: "SPR A1-1", productivity: 3200, shift: "05:00–14:00" },
];

const SO_DATA: SalesOrder[] = [
  { soNumber: "INV/SO/20260812/301/6131021", destination: "SWL", route: "SWL - PSG", zone: "MZE", qty: 680, sku: 42 },
  { soNumber: "INV/SO/20260812/301/6131027", destination: "SWL", route: "SWL - PSG", zone: "MZE", qty: 540, sku: 31 },
  { soNumber: "INV/SO/20260812/301/6131035", destination: "PSG", route: "SWL - PSG", zone: "MZF", qty: 790, sku: 55 },
  { soNumber: "INV/SO/20260812/301/6131041", destination: "PSG", route: "SWL - PSG", zone: "MZF", qty: 610, sku: 38 },
  { soNumber: "INV/SO/20260812/301/6131054", destination: "SWL", route: "SWL - PSG", zone: "MZC 2", qty: 920, sku: 64 },
  { soNumber: "INV/SO/20260812/301/6131068", destination: "PSG", route: "SWL - PSG", zone: "MZC 2", qty: 730, sku: 48 },
  { soNumber: "INV/SO/20260812/301/6131072", destination: "SWL", route: "SWL - PSG", zone: "SPR A1-1", qty: 870, sku: 19 },
  { soNumber: "INV/SO/20260812/301/6131089", destination: "PSG", route: "SWL - PSG", zone: "SPR A1-1", qty: 882, sku: 23 },
  { soNumber: "INV/SO/20260812/302/6131110", destination: "SMN", route: "SMN - MRY", zone: "MZE", qty: 980, sku: 73 },
  { soNumber: "INV/SO/20260812/302/6131123", destination: "MRY", route: "SMN - MRY", zone: "MZE", qty: 820, sku: 54 },
  { soNumber: "INV/SO/20260812/302/6131139", destination: "SMN", route: "SMN - MRY", zone: "MZF", qty: 1130, sku: 61 },
  { soNumber: "INV/SO/20260812/302/6131144", destination: "MRY", route: "SMN - MRY", zone: "MZF", qty: 970, sku: 46 },
  { soNumber: "INV/SO/20260812/302/6131158", destination: "SMN", route: "SMN - MRY", zone: "MZC 2", qty: 1280, sku: 82 },
  { soNumber: "INV/SO/20260812/302/6131166", destination: "MRY", route: "SMN - MRY", zone: "MZC 2", qty: 1050, sku: 70 },
  { soNumber: "INV/SO/20260812/302/6131175", destination: "SMN", route: "SMN - MRY", zone: "SPR C1-1", qty: 1320, sku: 35 },
  { soNumber: "INV/SO/20260812/302/6131181", destination: "MRY", route: "SMN - MRY", zone: "SPR C1-1", qty: 1292, sku: 29 },
  { soNumber: "INV/SO/20260812/305/6131205", destination: "BSX", route: "BSX", zone: "MZE", qty: 1240, sku: 68 },
  { soNumber: "INV/SO/20260812/305/6131217", destination: "BSX", route: "BSX", zone: "MZE", qty: 1160, sku: 62 },
  { soNumber: "INV/SO/20260812/305/6131224", destination: "BSX", route: "BSX", zone: "MZF", qty: 1420, sku: 81 },
  { soNumber: "INV/SO/20260812/305/6131233", destination: "BSX", route: "BSX", zone: "MZF", qty: 1280, sku: 59 },
  { soNumber: "INV/SO/20260812/305/6131246", destination: "BSX", route: "BSX", zone: "MZD 1", qty: 1580, sku: 77 },
  { soNumber: "INV/SO/20260812/305/6131251", destination: "BSX", route: "BSX", zone: "MZD 1", qty: 1370, sku: 72 },
  { soNumber: "INV/SO/20260812/305/6131260", destination: "BSX", route: "BSX", zone: "SPR A1-1", qty: 1327, sku: 25 },
  { soNumber: "INV/SO/20260812/305/6131278", destination: "BSX", route: "BSX", zone: "SPR A1-1", qty: 1230, sku: 21 },
];

const number = (value: number) => value.toLocaleString("id-ID");

function extractWmsSoId(soNumber: string) {
  return soNumber.replace(/\D/g, "").slice(-7).padStart(7, "0");
}

function buildAssignments(orders: SalesOrder[], pickers: Picker[]) {
  const result: Assignment[] = [];
  const groups = new Map<string, SalesOrder[]>();

  orders.forEach((order) => {
    const key = `${order.route}::${order.zone}`;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  });

  groups.forEach((zoneOrders) => {
    const route = zoneOrders[0].route;
    const zone = zoneOrders[0].zone;
    const rule = ZONE_RULES.find((item) => item.zone === zone);
    const totalQty = zoneOrders.reduce((sum, item) => sum + item.qty, 0);
    const required = Math.max(
      1,
      Math.ceil(totalQty / Math.max(1, rule?.productivity ?? 2000)),
    );
    const candidates = pickers
      .filter((picker) => picker.zone === zone)
      .sort((a, b) => b.productivity - a.productivity)
      .slice(0, required);
    const fallback = pickers
      .filter((picker) => !candidates.some((item) => item.staffId === picker.staffId))
      .sort((a, b) => b.productivity - a.productivity);
    const selected = [...candidates];
    while (selected.length < required && fallback.length) {
      selected.push(fallback.shift()!);
    }

    const buckets = selected.map((picker) => ({
      route,
      zone,
      picker,
      orders: [] as SalesOrder[],
      totalQty: 0,
      source: "auto" as const,
    }));

    [...zoneOrders]
      .sort((a, b) => b.qty - a.qty)
      .forEach((order) => {
        buckets.sort(
          (a, b) =>
            a.totalQty / Math.max(1, a.picker.productivity) -
            b.totalQty / Math.max(1, b.picker.productivity),
        );
        buckets[0].orders.push(order);
        buckets[0].totalQty += order.qty;
      });

    result.push(...buckets.filter((bucket) => bucket.orders.length));
  });

  return result.sort(
    (a, b) =>
      ROUTES.findIndex((route) => route.code === a.route) -
        ROUTES.findIndex((route) => route.code === b.route) ||
      a.zone.localeCompare(b.zone),
  );
}

function buildManualAssignments(
  orders: SalesOrder[],
  overrides: ManualOverrides,
) {
  const groups = new Map<string, SalesOrder[]>();

  orders.forEach((order) => {
    const staffId = overrides[order.soNumber];
    if (!staffId) return;
    const key = `${order.route}::${staffId}`;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  });

  return [...groups.entries()].map(([key, assignedOrders]) => {
    const staffId = key.split("::")[1];
    const rosterPicker = PICKER_ROSTER.find(
      (picker) => picker.staffId === staffId,
    );
    const zones = [...new Set(assignedOrders.map((order) => order.zone))];
    const productivity = rosterPicker?.productivity ?? assignedOrders.reduce(
      (sum, order) =>
        sum +
        (ZONE_RULES.find((rule) => rule.zone === order.zone)?.productivity ??
          2000),
      0,
    );

    return {
      route: assignedOrders[0].route,
      zone: zones.length === 1 ? zones[0] : `${zones.length} zones`,
      picker: rosterPicker ?? {
        staffId,
        name: "Manual staff",
        zone: zones.join(", "),
        productivity,
        shift: "Manual input",
      },
      orders: assignedOrders,
      totalQty: assignedOrders.reduce((sum, order) => sum + order.qty, 0),
      source: "manual" as const,
    };
  });
}

function downloadCsv(assignments: Assignment[], route?: RouteCode) {
  const selected = route
    ? assignments.filter((item) => item.route === route)
    : assignments;
  const rows = ["error_message;so_id;staff_id"];
  selected.forEach((assignment) => {
    assignment.orders.forEach((order) => {
      rows.push(`;${extractWmsSoId(order.soNumber)};${assignment.picker.staffId}`);
    });
  });

  const blob = new Blob(["\ufeff" + rows.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `one-wave-${(route ?? "all-route").toLowerCase().replaceAll(" ", "-")}-2026-08-12.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [activeRoute, setActiveRoute] = useState<RouteCode | "ALL">("ALL");
  const [manualRoute, setManualRoute] = useState<RouteCode>("SWL - PSG");
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [selectedPickerIds, setSelectedPickerIds] = useState<string[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [bulkPickerIds, setBulkPickerIds] = useState("");
  const [showPickerPool, setShowPickerPool] = useState(false);
  const [manualOverrides, setManualOverrides] = useState<ManualOverrides>({});
  const [generated, setGenerated] = useState(true);
  const [search, setSearch] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [toast, setToast] = useState("");

  const autoAssignments = useMemo(
    () =>
      generated
        ? buildAssignments(
            SO_DATA.filter((order) => !manualOverrides[order.soNumber]),
            AUTO_PICKERS,
          )
        : [],
    [generated, manualOverrides],
  );

  const assignments = useMemo(
    () => [
      ...autoAssignments,
      ...buildManualAssignments(SO_DATA, manualOverrides),
    ],
    [autoAssignments, manualOverrides],
  );

  const manualRouteOrders = SO_DATA.filter(
    (order) => order.route === manualRoute,
  );

  const manualRouteZones = new Set(
    manualRouteOrders.map((order) => order.zone),
  );

  const filteredPickers = PICKER_ROSTER.filter((picker) => {
    const query = pickerSearch.trim().toLowerCase();
    return (
      !query ||
      picker.staffId.includes(query) ||
      picker.name.toLowerCase().includes(query) ||
      picker.zone.toLowerCase().includes(query)
    );
  }).sort((a, b) => {
    const aRelevant = manualRouteZones.has(a.zone) ? 0 : 1;
    const bRelevant = manualRouteZones.has(b.zone) ? 0 : 1;
    return aRelevant - bRelevant || a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name);
  });

  const autoAssigneeBySo = useMemo(() => {
    const assignees: Record<string, string> = {};
    autoAssignments.forEach((assignment) => {
      assignment.orders.forEach((order) => {
        assignees[order.soNumber] = assignment.picker.staffId;
      });
    });
    return assignees;
  }, [autoAssignments]);

  const routeStats = useMemo(
    () =>
      ROUTES.map((route) => {
        const orders = SO_DATA.filter((item) => item.route === route.code);
        const routeAssignments = assignments.filter(
          (item) => item.route === route.code,
        );
        return {
          ...route,
          so: orders.length,
          qty: orders.reduce((sum, item) => sum + item.qty, 0),
          sku: orders.reduce((sum, item) => sum + item.sku, 0),
          mp: new Set(routeAssignments.map((item) => item.picker.staffId)).size,
          zones: new Set(orders.map((item) => item.zone)).size,
        };
      }),
    [assignments],
  );

  const zoneStats = useMemo(() => {
    const rows = new Map<
      string,
      {
        route: RouteCode;
        zone: string;
        qty: number;
        so: number;
        productivity: number;
        required: number;
        assigned: number;
      }
    >();
    SO_DATA.forEach((order) => {
      const key = `${order.route}::${order.zone}`;
      const current = rows.get(key) ?? {
        route: order.route,
        zone: order.zone,
        qty: 0,
        so: 0,
        productivity:
          ZONE_RULES.find((item) => item.zone === order.zone)?.productivity ??
          2000,
        required: 0,
        assigned: 0,
      };
      current.qty += order.qty;
      current.so += 1;
      rows.set(key, current);
    });
    return [...rows.values()].map((row) => ({
      ...row,
      required: Math.ceil(row.qty / row.productivity),
      assigned: new Set(
        assignments
          .filter((item) => item.route === row.route)
          .filter((item) =>
            item.orders.some((order) => order.zone === row.zone),
          )
          .map((item) => item.picker.staffId),
      ).size,
    }));
  }, [assignments]);

  const filteredAssignments = assignments.filter((item) => {
    const routeMatch = activeRoute === "ALL" || item.route === activeRoute;
    const query = search.trim().toLowerCase();
    const searchMatch =
      !query ||
      item.picker.name.toLowerCase().includes(query) ||
      item.picker.staffId.includes(query) ||
      item.zone.toLowerCase().includes(query) ||
      item.orders.some((order) =>
        order.soNumber.toLowerCase().includes(query),
      );
    return routeMatch && searchMatch;
  });

  const totals = {
    qty: SO_DATA.reduce((sum, item) => sum + item.qty, 0),
    so: SO_DATA.length,
    sku: SO_DATA.reduce((sum, item) => sum + item.sku, 0),
    mp: new Set(assignments.map((item) => item.picker.staffId)).size,
  };

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  }

  function openManualRoute(route: RouteCode) {
    setManualRoute(route);
    setActiveRoute(route);
    setSelectedOrders([]);
  }

  function toggleOrder(soNumber: string) {
    setSelectedOrders((current) =>
      current.includes(soNumber)
        ? current.filter((item) => item !== soNumber)
        : [...current, soNumber],
    );
  }

  function togglePicker(staffId: string) {
    setSelectedPickerIds((current) =>
      current.includes(staffId)
        ? current.filter((item) => item !== staffId)
        : [...current, staffId],
    );
  }

  function addBulkPickerIds() {
    const ids = bulkPickerIds.match(/\d{4,8}/g) ?? [];
    if (!ids.length) {
      flash("Paste minimal satu Staff ID valid");
      return;
    }
    setSelectedPickerIds((current) => [...new Set([...current, ...ids])]);
    setBulkPickerIds("");
    flash(`${ids.length} Staff ID ditambahkan ke picker pool`);
  }

  function assignSelectedManually() {
    if (!selectedPickerIds.length) {
      flash("Pilih atau masukkan minimal satu picker");
      return;
    }
    if (!selectedOrders.length) {
      flash("Pilih minimal satu SO");
      return;
    }

    const loads = new Map(
      selectedPickerIds.map((staffId) => [staffId, 0]),
    );
    const orderedOrders = SO_DATA.filter((order) =>
      selectedOrders.includes(order.soNumber),
    ).sort((a, b) => b.qty - a.qty);

    setManualOverrides((current) => {
      const next = { ...current };
      orderedOrders.forEach((order) => {
        const selectedStaffId = [...loads.entries()].sort((a, b) => {
          const aPicker = PICKER_ROSTER.find((picker) => picker.staffId === a[0]);
          const bPicker = PICKER_ROSTER.find((picker) => picker.staffId === b[0]);
          const aCapacity = Math.max(1, aPicker?.productivity || 2000);
          const bCapacity = Math.max(1, bPicker?.productivity || 2000);
          return a[1] / aCapacity - b[1] / bCapacity;
        })[0][0];
        next[order.soNumber] = selectedStaffId;
        loads.set(selectedStaffId, (loads.get(selectedStaffId) ?? 0) + order.qty);
      });
      return next;
    });
    flash(`${selectedOrders.length} SO dibagi ke ${selectedPickerIds.length} picker`);
    setSelectedOrders([]);
  }

  function clearManualAssignment(soNumber: string) {
    setManualOverrides((current) => {
      const next = { ...current };
      delete next[soNumber];
      return next;
    });
    flash("Manual assignment dilepas");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">1W</div>
        <nav aria-label="Navigasi utama">
          <button className="nav-icon active" aria-label="Assignment board">⌁</button>
          <button className="nav-icon" aria-label="Data SO">▤</button>
          <button className="nav-icon" aria-label="Manpower">♙</button>
          <button className="nav-icon" aria-label="Riwayat">◷</button>
        </nav>
        <button className="nav-icon bottom" aria-label="Pengaturan" onClick={() => setShowRules(true)}>⚙</button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">CBT · OUTBOUND ORCHESTRATION</p>
            <h1>ONE WAVE <span>ONE ROUTE</span></h1>
          </div>
          <div className="top-actions">
            <div className="source-state">
              <i />
              <div><strong>Demo snapshot</strong><span>12 Agu 2026 · 16:48</span></div>
            </div>
            <button className="soft-button" onClick={() => flash("Snapshot demo sudah paling baru")}>↻ Refresh</button>
            <button className="primary-button" onClick={() => { setGenerated(true); flash(Object.keys(manualOverrides).length ? "Auto-assignment diperbarui, manual lock tetap aman" : "Assignment berhasil dihitung ulang"); }}>Generate assignment</button>
          </div>
        </header>

        <section className="hero-grid">
          <div className="hero-copy">
            <div className="status-line"><span>WAVE 1</span><span>5 DESTINATION</span><span>TRIAL V1</span></div>
            <h2>Turn route volume into<br /><em>ready-to-upload</em> assignments.</h2>
            <p>Demand per zone, manpower capacity, and whole-SO balancing in one operational view.</p>
          </div>
          <div className="hero-metrics">
            <article><span>Total request</span><strong>{number(totals.qty)}</strong><small>qty · {number(totals.sku)} SKU</small></article>
            <article><span>Candidate SO</span><strong>{number(totals.so)}</strong><small>5 destination · NEW</small></article>
            <article className="accent"><span>MP required</span><strong>{number(totals.mp)}</strong><small>across {zoneStats.length} zone loads</small></article>
          </div>
        </section>

        <section className="route-section">
          <div className="section-heading">
            <div><span>01</span><div><h3>Route demand</h3><p>Trial destinations from PLAN CBT AUG 2026</p></div></div>
            <button className="text-button" onClick={() => setShowRules(true)}>View calculation rules ↗</button>
          </div>
          <div className="route-grid">
            {routeStats.map((route) => (
              <button
                key={route.code}
                className={`route-card ${activeRoute === route.code ? "selected" : ""}`}
                onClick={() => openManualRoute(route.code)}
                aria-pressed={manualRoute === route.code}
                style={{ "--route-color": route.color } as React.CSSProperties}
              >
                <div className="route-top"><span>ROUTE {String(route.routeNo).padStart(2, "0")}</span><i>WAVE 1</i></div>
                <h4>{route.code}</h4>
                <p>{route.destinations.join("  ·  ")}</p>
                <div className="route-data"><div><strong>{number(route.qty)}</strong><span>REQUEST QTY</span></div><div><strong>{route.so}</strong><span>SO</span></div><div><strong>{route.mp}</strong><span>MP</span></div></div>
                <div className="route-foot"><span>{route.zones} active zones</span><span>View & assign {route.so} SO →</span></div>
              </button>
            ))}
          </div>
        </section>

        <section className="manual-section panel">
          <div className="manual-head">
            <div className="panel-head">
              <div><span>02</span><div><h3>Manual SO assignment</h3><p>Pilih route, centang SO, lalu lock ke Staff ID pilihan</p></div></div>
            </div>
            <div className="manual-route-tabs" aria-label="Pilih route untuk manual assignment">
              {ROUTES.map((route) => {
                const locked = SO_DATA.filter(
                  (order) => order.route === route.code && manualOverrides[order.soNumber],
                ).length;
                return (
                  <button
                    key={route.code}
                    className={manualRoute === route.code ? "active" : ""}
                    onClick={() => openManualRoute(route.code)}
                  >
                    {route.code}<span>{locked}/{SO_DATA.filter((order) => order.route === route.code).length}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="manual-command">
            <div>
              <p className="eyebrow">ACTIVE ROUTE</p>
              <h4>{manualRoute}</h4>
              <span>{manualRouteOrders.length} candidate SO · {selectedOrders.length} selected</span>
            </div>
            <div className="picker-pool-trigger-wrap">
              <span>Picker pool · Schedule Manpower 2025</span>
              <button
                className={`picker-pool-trigger ${selectedPickerIds.length ? "has-selection" : ""}`}
                onClick={() => setShowPickerPool((current) => !current)}
                aria-expanded={showPickerPool}
              >
                <span>{selectedPickerIds.length ? `${selectedPickerIds.length} picker selected` : "Choose multiple pickers"}</span>
                <b>{showPickerPool ? "−" : "+"}</b>
              </button>
            </div>
            <button className="primary-button manual-assign-button" onClick={assignSelectedManually}>
              Assign {selectedOrders.length || "selected"} SO to {selectedPickerIds.length || "picker"}
            </button>
          </div>

          {showPickerPool && (
            <div className="picker-drawer">
              <div className="picker-drawer-head">
                <div><p className="eyebrow">PICKER ROSTER</p><h4>Select manpower manually</h4><span>{PICKER_ROSTER.length} picker · snapshot dari Schedule Manpower 2025</span></div>
                <button onClick={() => setShowPickerPool(false)} aria-label="Tutup picker pool">×</button>
              </div>

              <div className="picker-entry-tools">
                <label>
                  <span>Search roster</span>
                  <input aria-label="Cari picker dari roster" placeholder="Nama, Staff ID, atau zona…" value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} />
                </label>
                <label>
                  <span>Paste multiple Staff ID</span>
                  <div><input aria-label="Masukkan banyak Staff ID" inputMode="numeric" placeholder="52016, 49605, 48113" value={bulkPickerIds} onChange={(event) => setBulkPickerIds(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addBulkPickerIds(); }} /><button onClick={addBulkPickerIds}>Add IDs</button></div>
                </label>
              </div>

              <div className="selected-picker-strip">
                <div><strong>Selected manpower</strong><span>{selectedPickerIds.length} picker ready for balancing</span></div>
                <div className="picker-chips">
                  {selectedPickerIds.length ? selectedPickerIds.map((staffId) => {
                    const picker = PICKER_ROSTER.find((item) => item.staffId === staffId);
                    return <button key={staffId} onClick={() => togglePicker(staffId)} title="Hapus dari pilihan"><span>{picker?.name ?? "Manual ID"}</span><b>{staffId}</b><i>×</i></button>;
                  }) : <em>Belum ada picker dipilih</em>}
                </div>
                {selectedPickerIds.length > 0 && <button className="clear-picker-selection" onClick={() => setSelectedPickerIds([])}>Clear all</button>}
              </div>

              <div className="picker-list-head">
                <span>Roster match</span><span>Home zone</span><span>Target prod</span><span>Select</span>
              </div>
              <div className="picker-list">
                {filteredPickers.map((picker) => {
                  const selected = selectedPickerIds.includes(picker.staffId);
                  const relevant = manualRouteZones.has(picker.zone);
                  return (
                    <button className={selected ? "selected" : ""} key={picker.staffId} onClick={() => togglePicker(picker.staffId)}>
                      <span className="picker-list-person"><i>{picker.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</i><span><strong>{picker.name}</strong><small>{picker.staffId}</small></span></span>
                      <span><strong>{picker.zone}</strong>{relevant && <small>Route zone</small>}</span>
                      <span><strong>{picker.productivity ? number(picker.productivity) : "—"}</strong><small>qty / shift</small></span>
                      <span className="picker-select-mark">{selected ? "✓" : "+"}</span>
                    </button>
                  );
                })}
              </div>
              <div className="picker-drawer-foot"><span>Manual selection tidak mengambil manpower lain secara otomatis.</span><button onClick={() => setShowPickerPool(false)}>Done · {selectedPickerIds.length} selected</button></div>
            </div>
          )}

          <div className="so-table-wrap">
            <div className="so-table-row so-table-labels">
              <span className="so-check">
                <input
                  type="checkbox"
                  aria-label={`Pilih semua SO route ${manualRoute}`}
                  checked={selectedOrders.length === manualRouteOrders.length}
                  onChange={() =>
                    setSelectedOrders(
                      selectedOrders.length === manualRouteOrders.length
                        ? []
                        : manualRouteOrders.map((order) => order.soNumber),
                    )
                  }
                />
              </span>
              <span>SO ID</span><span>Destination</span><span>Zone</span><span>Request</span><span>Assignee</span><span>Action</span>
            </div>
            {manualRouteOrders.map((order) => {
              const manualStaff = manualOverrides[order.soNumber];
              const autoStaff = autoAssigneeBySo[order.soNumber];
              return (
                <div className={`so-table-row ${manualStaff ? "manual-locked" : ""}`} key={order.soNumber}>
                  <span className="so-check"><input type="checkbox" aria-label={`Pilih SO ${extractWmsSoId(order.soNumber)}`} checked={selectedOrders.includes(order.soNumber)} onChange={() => toggleOrder(order.soNumber)} /></span>
                  <span className="so-number"><strong>{extractWmsSoId(order.soNumber)}</strong><small>{order.soNumber}</small></span>
                  <span><b className="destination-badge">{order.destination}</b></span>
                  <span><strong>{order.zone}</strong><small>{order.sku} SKU</small></span>
                  <span><strong>{number(order.qty)}</strong><small>qty</small></span>
                  <span className="assignee-status">
                    <strong>{manualStaff ?? autoStaff ?? "Unassigned"}</strong>
                    <small>{manualStaff ? "Manual lock" : autoStaff ? "Auto plan" : "Waiting"}</small>
                  </span>
                  <span>
                    {manualStaff ? (
                      <button className="clear-lock" onClick={() => clearManualAssignment(order.soNumber)}>Release</button>
                    ) : (
                      <span className="auto-mark">AUTO</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="manual-foot">
            <span><i /> Manual lock selalu menang atas auto-assignment dan langsung digunakan pada CSV.</span>
            <button
              disabled={!manualRouteOrders.some((order) => manualOverrides[order.soNumber])}
              onClick={() => {
                setManualOverrides((current) => {
                  const next = { ...current };
                  manualRouteOrders.forEach((order) => delete next[order.soNumber]);
                  return next;
                });
                flash(`Manual lock route ${manualRoute} dibersihkan`);
              }}
            >Clear route locks</button>
          </div>
        </section>

        <section className="operations-grid">
          <div className="zone-panel panel">
            <div className="panel-head"><div><span>03</span><div><h3>Manpower by zone</h3><p>Required MP = request qty ÷ zone productivity</p></div></div><span className="pill">{zoneStats.length} LOADS</span></div>
            <div className="zone-table">
              <div className="table-row table-labels"><span>Route / zone</span><span>Demand</span><span>Prod / MP</span><span>Need</span><span>Coverage</span></div>
              {zoneStats
                .filter((row) => activeRoute === "ALL" || row.route === activeRoute)
                .map((row) => {
                  const percentage = Math.min(100, Math.round((row.assigned / row.required) * 100));
                  return (
                    <div className="table-row" key={`${row.route}-${row.zone}`}>
                      <span><strong>{row.zone}</strong><small>{row.route}</small></span>
                      <span><strong>{number(row.qty)}</strong><small>{row.so} SO</small></span>
                      <span><strong>{number(row.productivity)}</strong><small>qty / shift</small></span>
                      <span className="need"><b>{row.required}</b><small>MP</small></span>
                      <span className="coverage"><i><em style={{ width: `${percentage}%` }} /></i><small>{row.assigned}/{row.required} assigned</small></span>
                    </div>
                  );
                })}
            </div>
          </div>

          <aside className="readiness-panel panel">
            <div className="readiness-orbit"><strong>{totals.mp}</strong><span>MP READY</span></div>
            <h3>Capacity is covered</h3>
            <p>All zone demand has a scheduled picker with a valid staff ID.</p>
            <dl><div><dt>Schedule source</dt><dd>12-Aug-2026</dd></div><div><dt>Shift priority</dt><dd>05:00–14:00</dd></div><div><dt>SO split policy</dt><dd>Whole SO</dd></div></dl>
            <button onClick={() => setShowRules(true)}>Inspect source mapping</button>
          </aside>
        </section>

        <section className="assignment-section panel">
          <div className="assignment-head">
            <div className="panel-head"><div><span>04</span><div><h3>Assignment preview</h3><p>Balanced by picker capacity · manual locks take priority</p></div></div></div>
            <div className="assignment-tools">
              <input aria-label="Cari assignment" placeholder="Search picker, zone, SO…" value={search} onChange={(event) => setSearch(event.target.value)} />
              <button className="soft-button" onClick={() => downloadCsv(assignments, activeRoute === "ALL" ? undefined : activeRoute)}>↓ Download CSV</button>
            </div>
          </div>
          {!assignments.length ? (
            <div className="empty-state"><strong>Assignment belum dibuat</strong><span>Klik Generate assignment untuk membagi candidate SO.</span></div>
          ) : (
            <div className="assignment-list">
              {filteredAssignments.map((assignment, index) => {
                const load = Math.round((assignment.totalQty / assignment.picker.productivity) * 100);
                return (
                  <article className="assignment-card" data-source={assignment.source} key={`${assignment.source}-${assignment.route}-${assignment.zone}-${assignment.picker.staffId}`}>
                    <div className="assignment-index">{String(index + 1).padStart(2, "0")}</div>
                    <div className="picker-avatar">{assignment.picker.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div>
                    <div className="picker-info"><strong>{assignment.picker.name} {assignment.source === "manual" && <em>MANUAL</em>}</strong><span>{assignment.picker.staffId} · {assignment.picker.shift}</span></div>
                    <div className="assignment-route"><strong>{assignment.zone}</strong><span>{assignment.route}</span></div>
                    <div className="assignment-load"><div><strong>{number(assignment.totalQty)}</strong><span>{assignment.source === "manual" ? "manual locked qty" : `/ ${number(assignment.picker.productivity)} qty`}</span></div><i><em className={load > 100 && assignment.source === "auto" ? "over" : ""} style={{ width: assignment.source === "manual" ? "100%" : `${Math.min(100, load)}%` }} /></i></div>
                    <div className="assignment-so"><strong>{assignment.orders.length}</strong><span>SO</span></div>
                    <div className="load-badge" data-over={load > 100 && assignment.source === "auto"}>{assignment.source === "manual" ? "LOCKED" : `${load}%`}</div>
                  </article>
                );
              })}
            </div>
          )}
          <div className="assignment-footer">
            <div><span className="safe-dot" /> All rows have valid <code>so_id</code> + <code>staff_id</code> · {Object.keys(manualOverrides).length} manual locks</div>
            <div className="footer-actions"><button onClick={() => { setGenerated(false); setManualOverrides({}); setSelectedOrders([]); flash("Semua assignment direset"); }}>Reset all</button><button onClick={() => downloadCsv(assignments)}>Download all routes <span>↓</span></button></div>
          </div>
        </section>
      </section>

      {showRules && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowRules(false); }}>
          <section className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
            <button className="modal-close" onClick={() => setShowRules(false)} aria-label="Tutup">×</button>
            <p className="eyebrow">V1 CALCULATION CONTRACT</p>
            <h2 id="rules-title">Assignment rules</h2>
            <div className="rule-block"><span>1</span><div><strong>Eligibility</strong><p>SO status NEW, picker kosong, destination termasuk SWL / PSG / SMN / MRY / BSX.</p></div></div>
            <div className="rule-block"><span>2</span><div><strong>Manpower need</strong><p><code>CEILING(zone request qty / productivity per MP zone)</code></p></div></div>
            <div className="rule-block"><span>3</span><div><strong>Picker roster</strong><p>Job Title = Picker, schedule aktif pada operational date, staff ID valid, bukan OFF DAY/cuti/izin.</p></div></div>
            <div className="rule-block"><span>4</span><div><strong>WMS output</strong><p><code>error_message;so_id;staff_id</code> · satu SO hanya memiliki satu staff ID.</p></div></div>
            <h3>Zone productivity draft</h3>
            <div className="rule-grid">{ZONE_RULES.map((rule) => <div key={rule.zone}><span>{rule.zone}</span><strong>{number(rule.productivity)}</strong><small>qty / MP</small></div>)}</div>
            <div className="modal-note">Demo values — replace with the final productivity-per-zone source before live trial.</div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}
