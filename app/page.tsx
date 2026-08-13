"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PICKER_ROSTER } from "./picker-roster";

type RouteCode = "SWL - PSG" | "CSA - KLD" | "BSX" | "CPT - PPL" | "RDS - SLP" | "JLB";
type AssignmentMode = "route" | "zone";

type SalesOrder = {
  soNumber: string;
  destination: "SWL" | "PSG" | "CSA" | "KLD" | "BSX" | "CPT" | "PPL" | "RDS" | "SLP" | "JLB";
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
  route: RouteCode | "MULTI ROUTE";
  zone: string;
  picker: Picker;
  orders: SalesOrder[];
  totalQty: number;
  source: "auto" | "manual";
};

type ManualOverrides = Record<string, string>;

type PickingActivity = {
  pickerId: string;
  pickerName: string;
  soNumber: string;
  destination: string;
  route: RouteCode;
  zone: string;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED";
  rawStatus: string;
  requestQty: number;
  pickedQty: number;
  remainingQty: number;
  completionPct: number;
  sku: number;
  pickingStartAt: string;
  pickingEndAt: string;
};

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
    code: "CSA - KLD",
    destinations: ["CSA", "KLD"],
    routeNo: 2,
    color: "#7c63e6",
  },
  { code: "BSX", destinations: ["BSX"], routeNo: 5, color: "#2f9e85" },
  { code: "CPT - PPL", destinations: ["CPT", "PPL"], routeNo: 6, color: "#d4972f" },
  { code: "RDS - SLP", destinations: ["RDS", "SLP"], routeNo: 7, color: "#2783c5" },
  { code: "JLB", destinations: ["JLB"], routeNo: 8, color: "#cf5a87" },
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
  { staffId: "52016", name: "Muhammad Faris Gumay", zone: "MZE", productivity: 2400, shift: "05:00â€“14:00" },
  { staffId: "49605", name: "Faizal Arifin", zone: "MZF", productivity: 2400, shift: "05:00â€“14:00" },
  { staffId: "48113", name: "Jonathan Syah", zone: "MZC 2", productivity: 2800, shift: "05:00â€“14:00" },
  { staffId: "52018", name: "Irpan Muryadi", zone: "MZC 2", productivity: 2800, shift: "13:00â€“22:00" },
  { staffId: "43194", name: "Ahmad Dhoefan", zone: "MZD 1", productivity: 2300, shift: "05:00â€“14:00" },
  { staffId: "48408", name: "Abdul Aziz Yulianto", zone: "SPR C1-1", productivity: 3000, shift: "05:00â€“14:00" },
  { staffId: "48387", name: "Fahrul Nugroho", zone: "SPR C1-1", productivity: 3000, shift: "05:00â€“14:00" },
  { staffId: "51027", name: "Rizky Ramadhan", zone: "SPR A1-1", productivity: 3200, shift: "05:00â€“14:00" },
  { staffId: "51188", name: "Asep Firmansyah", zone: "MZE", productivity: 1800, shift: "05:00â€“14:00" },
  { staffId: "51402", name: "Dimas Saputra", zone: "MZF", productivity: 1800, shift: "05:00â€“14:00" },
  { staffId: "51546", name: "Rangga Pratama", zone: "MZD 1", productivity: 2300, shift: "05:00â€“14:00" },
  { staffId: "51721", name: "Bagus Setiawan", zone: "SPR A1-1", productivity: 3200, shift: "05:00â€“14:00" },
];

const DEMO_SO_DATA: SalesOrder[] = [
  { soNumber: "INV/SO/20260812/301/6131021", destination: "SWL", route: "SWL - PSG", zone: "MZE", qty: 680, sku: 42 },
  { soNumber: "INV/SO/20260812/301/6131027", destination: "SWL", route: "SWL - PSG", zone: "MZE", qty: 540, sku: 31 },
  { soNumber: "INV/SO/20260812/301/6131035", destination: "PSG", route: "SWL - PSG", zone: "MZF", qty: 790, sku: 55 },
  { soNumber: "INV/SO/20260812/301/6131041", destination: "PSG", route: "SWL - PSG", zone: "MZF", qty: 610, sku: 38 },
  { soNumber: "INV/SO/20260812/301/6131054", destination: "SWL", route: "SWL - PSG", zone: "MZC 2", qty: 920, sku: 64 },
  { soNumber: "INV/SO/20260812/301/6131068", destination: "PSG", route: "SWL - PSG", zone: "MZC 2", qty: 730, sku: 48 },
  { soNumber: "INV/SO/20260812/301/6131072", destination: "SWL", route: "SWL - PSG", zone: "SPR A1-1", qty: 870, sku: 19 },
  { soNumber: "INV/SO/20260812/301/6131089", destination: "PSG", route: "SWL - PSG", zone: "SPR A1-1", qty: 882, sku: 23 },
  { soNumber: "INV/SO/20260812/302/6131110", destination: "CSA", route: "CSA - KLD", zone: "MZE", qty: 980, sku: 73 },
  { soNumber: "INV/SO/20260812/302/6131123", destination: "KLD", route: "CSA - KLD", zone: "MZE", qty: 820, sku: 54 },
  { soNumber: "INV/SO/20260812/302/6131139", destination: "CSA", route: "CSA - KLD", zone: "MZF", qty: 1130, sku: 61 },
  { soNumber: "INV/SO/20260812/302/6131144", destination: "KLD", route: "CSA - KLD", zone: "MZF", qty: 970, sku: 46 },
  { soNumber: "INV/SO/20260812/302/6131158", destination: "CSA", route: "CSA - KLD", zone: "MZC 2", qty: 1280, sku: 82 },
  { soNumber: "INV/SO/20260812/302/6131166", destination: "KLD", route: "CSA - KLD", zone: "MZC 2", qty: 1050, sku: 70 },
  { soNumber: "INV/SO/20260812/302/6131175", destination: "CSA", route: "CSA - KLD", zone: "SPR C1-1", qty: 1320, sku: 35 },
  { soNumber: "INV/SO/20260812/302/6131181", destination: "KLD", route: "CSA - KLD", zone: "SPR C1-1", qty: 1292, sku: 29 },
  { soNumber: "INV/SO/20260812/305/6131205", destination: "BSX", route: "BSX", zone: "MZE", qty: 1240, sku: 68 },
  { soNumber: "INV/SO/20260812/305/6131217", destination: "BSX", route: "BSX", zone: "MZE", qty: 1160, sku: 62 },
  { soNumber: "INV/SO/20260812/305/6131224", destination: "BSX", route: "BSX", zone: "MZF", qty: 1420, sku: 81 },
  { soNumber: "INV/SO/20260812/305/6131233", destination: "BSX", route: "BSX", zone: "MZF", qty: 1280, sku: 59 },
  { soNumber: "INV/SO/20260812/305/6131246", destination: "BSX", route: "BSX", zone: "MZD 1", qty: 1580, sku: 77 },
  { soNumber: "INV/SO/20260812/305/6131251", destination: "BSX", route: "BSX", zone: "MZD 1", qty: 1370, sku: 72 },
  { soNumber: "INV/SO/20260812/305/6131260", destination: "BSX", route: "BSX", zone: "SPR A1-1", qty: 1327, sku: 25 },
  { soNumber: "INV/SO/20260812/305/6131278", destination: "BSX", route: "BSX", zone: "SPR A1-1", qty: 1230, sku: 21 },
  { soNumber: "INV/SO/20260812/306/6131281", destination: "CPT", route: "CPT - PPL", zone: "MZA1", qty: 840, sku: 38 },
  { soNumber: "INV/SO/20260812/306/6131287", destination: "PPL", route: "CPT - PPL", zone: "MZA1", qty: 760, sku: 34 },
  { soNumber: "INV/SO/20260812/307/6131292", destination: "RDS", route: "RDS - SLP", zone: "SRA1", qty: 910, sku: 41 },
  { soNumber: "INV/SO/20260812/307/6131298", destination: "SLP", route: "RDS - SLP", zone: "SRA1", qty: 690, sku: 29 },
  { soNumber: "INV/SO/20260812/308/6131304", destination: "JLB", route: "JLB", zone: "MZB1", qty: 1020, sku: 47 },
];

const number = (value: number) => value.toLocaleString("id-ID");

function formatSyncTime(value: string) {
  if (!value) return "connecting backend...";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatClock(value: string) {
  if (!value) return "â€“";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function extractWmsSoId(soNumber: string) {
  return soNumber.replace(/\D/g, "").slice(-7).padStart(7, "0");
}

function normalizedZone(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function assignmentHasRoute(assignment: Assignment, route: RouteCode) {
  return assignment.orders.some((order) => order.route === route);
}

function buildAssignments(orders: SalesOrder[], pickers: Picker[], mode: AssignmentMode) {
  const result: Assignment[] = [];
  const groups = new Map<string, SalesOrder[]>();

  orders.forEach((order) => {
    const key = mode === "zone" ? normalizedZone(order.zone) : `${order.route}::${normalizedZone(order.zone)}`;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  });

  groups.forEach((zoneOrders) => {
    const routes = [...new Set(zoneOrders.map((order) => order.route))];
    const route: Assignment["route"] = routes.length === 1 ? routes[0] : "MULTI ROUTE";
    const zone = zoneOrders[0].zone;
    const rule = ZONE_RULES.find((item) => item.zone === zone);
    const totalQty = zoneOrders.reduce((sum, item) => sum + item.qty, 0);
    const required = Math.max(
      1,
      Math.ceil(totalQty / Math.max(1, rule?.productivity ?? 2000)),
    );
    const candidates = pickers
      .filter((picker) => normalizedZone(picker.zone) === normalizedZone(zone))
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
  roster: Picker[],
  mode: AssignmentMode,
) {
  const groups = new Map<string, SalesOrder[]>();

  orders.forEach((order) => {
    const staffId = overrides[order.soNumber];
    if (!staffId) return;
    const key = mode === "zone"
      ? `${normalizedZone(order.zone)}::${staffId}`
      : `${order.route}::${staffId}`;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  });

  return [...groups.entries()].map(([key, assignedOrders]) => {
    const staffId = key.split("::").at(-1)!;
    const rosterPicker = roster.find(
      (picker) => picker.staffId === staffId,
    );
    const zones = [...new Set(assignedOrders.map((order) => order.zone))];
    const routes = [...new Set(assignedOrders.map((order) => order.route))];
    const productivity = rosterPicker?.productivity ?? assignedOrders.reduce(
      (sum, order) =>
        sum +
        (ZONE_RULES.find((rule) => rule.zone === order.zone)?.productivity ??
          2000),
      0,
    );

    const route: Assignment["route"] = routes.length === 1 ? routes[0] : "MULTI ROUTE";

    return {
      route,
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

function downloadCsv(
  assignments: Assignment[],
  route?: RouteCode,
  source?: Assignment["source"],
) {
  const selected = assignments.filter((item) => (!source || item.source === source));
  const rows = ["error_message;so_id;staff_id"];
  selected.forEach((assignment) => {

    assignment.orders.filter((order) => !route || order.route === route).forEach((order) => {
      rows.push(`;${extractWmsSoId(order.soNumber)};${assignment.picker.staffId}`);
    });
  });

  const blob = new Blob(["\ufeff" + rows.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const kind = source === "manual" ? "-locked" : "";
  anchor.download = `one-wave-${(route ?? "all-route").toLowerCase().replaceAll(" ", "-")}${kind}-2026-08-12.csv`;
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
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("route");
  const [selectedZone, setSelectedZone] = useState("ALL");
  const [liveOrders, setLiveOrders] = useState<SalesOrder[] | null>(null);
  const [livePickers, setLivePickers] = useState<Picker[] | null>(null);
  const [livePicking, setLivePicking] = useState<PickingActivity[]>([]);
  const [monitorStatus, setMonitorStatus] = useState<"ALL" | PickingActivity["status"]>("IN_PROGRESS");
  const [monitorSearch, setMonitorSearch] = useState("");
  const [expandedPicker, setExpandedPicker] = useState("");
  const [sourceStatus, setSourceStatus] = useState<"loading" | "live" | "fallback">("loading");
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const [generated, setGenerated] = useState(true);
  const [search, setSearch] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [toast, setToast] = useState("");

  const ordersData = liveOrders ?? DEMO_SO_DATA;
  const pickerRoster = livePickers ?? PICKER_ROSTER;

  const refreshLiveData = useCallback(async () => {
    try {
      const response = await fetch(`/api/live?t=${Date.now()}`, { cache: "no-store" });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        orders?: SalesOrder[];
        pickers?: Picker[];
        picking?: PickingActivity[];
        generatedAt?: string;
      };
      if (!response.ok || payload.ok !== true || !Array.isArray(payload.orders) || !Array.isArray(payload.pickers)) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const orders = payload.orders.filter((order: SalesOrder) =>
        ROUTES.some((route) => route.code === ordó=¶‰ËkºwµçY•ÉÉ¥‘•Ím½É‘•È¹Í½9Õµ‰•Étì(€€€€€€€€€€€€€½¹ÍĞ…ÕÑ½MÑ…™˜€ô…ÕÑ½ÍÍ¥¹••	åM½m½É‘•È¹Í½9Õµ‰•Étì(€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”õíÍ¼µÑ…‰±”µÉ½Ü€‘íµ…¹Õ…±MÑ…™˜€ü€‰µ…¹Õ…°µ±½­•ˆ€è€ˆ‰õô­•äõí½É‘•È¹Í½9Õµ‰•Éôø(€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Í¼µ¡•¬ˆøñ¥¹ÁÕĞÑåÁ”ô‰¡•­‰½àˆ…É¥„µ±…‰•°õíA¥±¥ M<€‘í•áÑÉ…Ñ]µÍM½%¡½É‘•È¹Í½9Õµ‰•È¥õô¡•­•õíÍ•±•Ñ•‘=É‘•ÉÌ¹¥¹±Õ‘•Ì¡½É‘•È¹Í½9Õµ‰•È¥ô½¹¡…¹”õì ¤€ôøÑ½±•=É‘•È¡½É‘•È¹Í½9Õµ‰•È¥ô€¼øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Í¼µ¹Õµ‰•ÈˆøñÍÑÉ½¹œùí•áÑÉ…Ñ]µÍM½%¡½É‘•È¹Í½9Õµ‰•È¥ôğ½ÍÑÉ½¹œøñÍµ…±°ùí½É‘•È¹Í½9Õµ‰•Éôğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñˆ±…ÍÍ9…µ”ô‰‘•ÍÑ¥¹…Ñ¥½¸µ‰…‘”ˆùí½É‘•È¹‘•ÍÑ¥¹…Ñ¥½¹ôğ½ˆøğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñÍÑÉ½¹œùí½É‘•È¹é½¹•ôğ½ÍÑÉ½¹œøñÍµ…±°ùí½É‘•È¹Í­ÕôM-Tğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñÍÑÉ½¹œùí¹Õµ‰•È¡½É‘•È¹ÅÑä¥ôğ½ÍÑÉ½¹œøñÍµ…±°ùÅÑäğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰…ÍÍ¥¹•”µÍÑ…ÑÕÌˆø(€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œùíµ…¹Õ…±MÑ…™˜€üü…ÕÑ½MÑ…™˜€üü€‰U¹…ÍÍ¥¹•‰ôğ½ÍÑÉ½¹œø(€€€€€€€€€€€€€€€€€€€€ñÍµ…±°ùíµ…¹Õ…±MÑ…™˜€ü€‰5…¹Õ…°±½¬ˆ€è…ÕÑ½MÑ…™˜€ü€‰ÕÑ¼Á±…¸ˆ€è€‰]…¥Ñ¥¹œ‰ôğ½Íµ…±°ø(€€€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€ñÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€íµ…¹Õ…±MÑ…™˜€ü€ (€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰±•…Èµ±½¬ˆ½¹±¥¬õì ¤€ôø±•…É5…¹Õ…±ÍÍ¥¹µ•¹Ğ¡½É‘•È¹Í½9Õµ‰•È¥ôùI•±•…Í”ğ½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€¤€è€ (€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰…ÕÑ¼µµ…É¬ˆùUQ<ğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€ô¥ô(€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ…¹Õ…°µ™½½Ğˆø(€€€€€€€€€€€€ñÍÁ…¸øñ¤€¼ø5…¹Õ…°±½¬Í•±…±Ôµ•¹…¹œ…Ñ…Ì…ÕÑ¼µ…ÍÍ¥¹µ•¹Ğ‘…¸±…¹ÍÕ¹œ‘¥Õ¹…­…¸Á…‘„MX¸ğ½ÍÁ…¸ø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€‘¥Í…‰±•õì…µ…¹Õ…±I½ÕÑ•=É‘•ÉÌ¹Í½µ” ¡½É‘•È¤€ôøµ…¹Õ…±=Ù•ÉÉ¥‘•Ím½É‘•È¹Í½9Õµ‰•Ét¥ô(€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøì(€€€€€€€€€€€€€€€Í•Ñ5…¹Õ…±=Ù•ÉÉ¥‘•Ì ¡ÕÉÉ•¹Ğ¤€ôøì(€€€€€€€€€€€€€€€€€½¹ÍĞ¹•áĞ€ôì€¸¸¹ÕÉÉ•¹Ğôì(€€€€€€€€€€€€€€€€€µ…¹Õ…±I½ÕÑ•=É‘•ÉÌ¹™½É…  ¡½É‘•È¤€ôø‘•±•Ñ”¹•áÑm½É‘•È¹Í½9Õµ‰•Ét¤ì(€€€€€€€€€€€€€€€€€É•ÑÕÉ¸¹•áĞì(€€€€€€€€€€€€€€€ô¤ì(€€€€€€€€€€€€€€€™±…Í ¡5…¹Õ…°±½¬€‘í…ÍÍ¥¹µ•¹Ñ5½‘”€ôôô€‰é½¹”ˆ€ü€‰é½¹”ˆ€è€‰É½ÕÑ”‰ô‘¥‰•ÉÍ¥¡­…¹€¤ì(€€€€€€€€€€€€€õô(€€€€€€€€€€€€ù±•…Èí…ÍÍ¥¹µ•¹Ñ5½‘”€ôôô€‰é½¹”ˆ€ü€‰é½¹”ˆ€è€‰É½ÕÑ”‰ô±½­Ìğ½‰ÕÑÑ½¸ø(€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€ğ½Í•Ñ¥½¸ø((€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰½Á•É…Ñ¥½¹ÌµÉ¥ˆø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰é½¹”µÁ…¹•°Á…¹•°ˆø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µ¡•…ˆøñ‘¥ØøñÍÁ…¸øÀÌğ½ÍÁ…¸øñ‘¥Øøñ Ìù5…¹Á½İ•È‰äé½¹”ğ½ ÌøñÀùI•ÅÕ¥É•5@€ôÉ•ÅÕ•ÍĞÅÑäƒÜé½¹”ÁÉ½‘ÕÑ¥Ù¥Ñäğ½Àøğ½‘¥Øøğ½‘¥ØøñÍÁ…¸±…ÍÍ9…µ”ô‰Á¥±°ˆùíé½¹•MÑ…ÑÌ¹±•¹Ñ¡ô1=Lğ½ÍÁ…¸øğ½‘¥Øø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰é½¹”µÑ…‰±”ˆø(€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ…‰±”µÉ½ÜÑ…‰±”µ±…‰•±ÌˆøñÍÁ…¸ùI½ÕÑ”€¼é½¹”ğ½ÍÁ…¸øñÍÁ…¸ù•µ…¹ğ½ÍÁ…¸øñÍÁ…¸ùAÉ½€¼5@ğ½ÍÁ…¸øñÍÁ…¸ù9••ğ½ÍÁ…¸øñÍÁ…¸ù½Ù•É…”ğ½ÍÁ…¸øğ½‘¥Øø(€€€€€€€€€€€€€íé½¹•MÑ…ÑÌ(€€€€€€€€€€€€€€€€¹™¥±Ñ•È ¡É½Ü¤€ôø…Ñ¥Ù•I½ÕÑ”€ôôô€‰10ˆñğÉ½Ü¹É½ÕÑ”€ôôô…Ñ¥Ù•I½ÕÑ”¤(€€€€€€€€€€€€€€€€¹µ…À ¡É½Ü¤€ôøì(€€€€€€€€€€€€€€€€€½¹ÍĞÁ•É•¹Ñ…”€ô5…Ñ ¹µ¥¸ ÄÀÀ°5…Ñ ¹É½Õ¹ ¡É½Ü¹…ÍÍ¥¹•€¼É½Ü¹É•ÅÕ¥É•¤€¨€ÄÀÀ¤¤ì(€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ…‰±”µÉ½Üˆ­•äõí€‘íÉ½Ü¹É½ÕÑ•ô´‘íÉ½Ü¹é½¹•õôø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñÍÑÉ½¹œùíÉ½Ü¹é½¹•ôğ½ÍÑÉ½¹œøñÍµ…±°ùíÉ½Ü¹É½ÕÑ•ôğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñÍÑÉ½¹œùí¹Õµ‰•È¡É½Ü¹ÅÑä¥ôğ½ÍÑÉ½¹œøñÍµ…±°ùíÉ½Ü¹Í½ôM<ğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñÍÑÉ½¹œùí¹Õµ‰•È¡É½Ü¹ÁÉ½‘ÕÑ¥Ù¥Ñä¥ôğ½ÍÑÉ½¹œøñÍµ…±°ùÅÑä€¼Í¡¥™Ğğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰¹••ˆøñˆùíÉ½Ü¹É•ÅÕ¥É•‘ôğ½ˆøñÍµ…±°ù5@ğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰½Ù•É…”ˆøñ¤øñ•´ÍÑå±”õíìİ¥‘Ñ è€‘íÁ•É•¹Ñ…•ô•€õô€¼øğ½¤øñÍµ…±°ùíÉ½Ü¹…ÍÍ¥¹•‘ô½íÉ½Ü¹É•ÅÕ¥É•‘ô…ÍÍ¥¹•ğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€€€ô¥ô(€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€ğ½‘¥Øø((€€€€€€€€€€ñ…Í¥‘”±…ÍÍ9…µ”ô‰É•…‘¥¹•ÍÌµÁ…¹•°Á…¹•°ˆø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰É•…‘¥¹•ÍÌµ½É‰¥ĞˆøñÍÑÉ½¹œùíÑ½Ñ…±Ì¹µÁôğ½ÍÑÉ½¹œøñÍÁ…¸ù5@Idğ½ÍÁ…¸øğ½‘¥Øø(€€€€€€€€€€€€ñ Ìù…Á…¥Ñä¥Ì½Ù•É•ğ½ Ìø(€€€€€€€€€€€€ñÀù±°é½¹”‘•µ…¹¡…Ì„Í¡•‘Õ±•Á¥­•Èİ¥Ñ „Ù…±¥ÍÑ…™˜%¸ğ½Àø(€€€€€€€€€€€€ñ‘°øñ‘¥Øøñ‘ĞùM¡•‘Õ±”Í½ÕÉ”ğ½‘Ğøñ‘øÄÈµÕœ´ÈÀÈØğ½‘øğ½‘¥Øøñ‘¥Øøñ‘ĞùM¡¥™ĞÁÉ¥½É¥Ñäğ½‘Ğøñ‘øÀÔèÀÃŠLÄĞèÀÀğ½‘øğ½‘¥Øøñ‘¥Øøñ‘ĞùM<ÍÁ±¥ĞÁ½±¥äğ½‘Ğøñ‘ù]¡½±”M<ğ½‘øğ½‘¥Øøğ½‘°ø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôøÍ•ÑM¡½İIÕ±•Ì¡ÑÉÕ”¥ôù%¹ÍÁ•ĞÍ½ÕÉ”µ…ÁÁ¥¹œğ½‰ÕÑÑ½¸ø(€€€€€€€€€€ğ½…Í¥‘”ø(€€€€€€€€ğ½Í•Ñ¥½¸ø((€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰µ½¹¥Ñ½ÈµÍ•Ñ¥½¸Á…¹•°ˆ¥ô‰Á¥­¥¹œµµ½¹¥Ñ½Èˆø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½¹¥Ñ½Èµ¡•…ˆø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µ¡•…ˆøñ‘¥ØøñÍÁ…¸øÀĞğ½ÍÁ…¸øñ‘¥Øøñ Ìù1¥Ù”Á¥­¥¹œµ½¹¥Ñ½Èğ½ ÌøñÀù­Ñ¥Ù¥Ñ…Ì…­ÑÕ…°]5LÕ¹ÑÕ¬M<=¹”]…Ù”=¹”I½ÕÑ”ƒ
ÜÉ•™É•Í Í•Ñ¥…À€Ôµ•¹¥Ğğ½Àøğ½‘¥Øøğ½‘¥Øøğ½‘¥Øø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½¹¥Ñ½ÈµÑ½½±Ìˆø(€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½¹¥Ñ½ÈµÑ…‰Ìˆ…É¥„µ±…‰•°ô‰¥±Ñ•ÈÍÑ…ÑÕÌÁ¥­¥¹œˆø(€€€€€€€€€€€€€€€ì¡l‰%9}AI=IMLˆ°€‰]%Q%9ˆ°€‰=5A1Qˆ°€‰10‰t…Ì½¹ÍĞ¤¹µ…À ¡ÍÑ…ÑÕÌ¤€ôø€ (€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸­•äõíÍÑ…ÑÕÍô±…ÍÍ9…µ”õíµ½¹¥Ñ½ÉMÑ…ÑÕÌ€ôôôÍÑ…ÑÕÌ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô½¹±¥¬õì ¤€ôøÍ•Ñ5½¹¥Ñ½ÉMÑ…ÑÕÌ¡ÍÑ…ÑÕÌ¥ôùíÍÑ…ÑÕÌ€ôôô€‰%9}AI=IMLˆ€ü€‰%¸ÁÉ½É•ÍÌˆ€èÍÑ…ÑÕÌ€ôôô€‰10ˆ€ü€‰±°ˆ€èÍÑ…ÑÕÌ¹Ñ½1½İ•É…Í” ¥ôğ½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€€€ñ¥¹ÁÕĞ…É¥„µ±…‰•°ô‰…É¤µ½¹¥Ñ½É¥¹œÁ¥­¥¹œˆÁ±…•¡½±‘•Èô‰…É¤Á¥­•È°M<°é½¹”°É½ÕÑ”¸¸¸ˆÙ…±Õ”õíµ½¹¥Ñ½ÉM•…É¡ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•Ñ5½¹¥Ñ½ÉM•…É ¡•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”¥ô€¼ø(€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½¹¥Ñ½Èµ­Á¥Ìˆø(€€€€€€€€€€€€ñ…ÉÑ¥±”øñÍÁ…¸ùÑ¥Ù”Á¥­•Èğ½ÍÁ…¸øñÍÑÉ½¹œùí¹Õµ‰•È¡Á¥­¥¹Q½Ñ…±Ì¹…Ñ¥Ù•A¥­•ÉÌ¥ôğ½ÍÑÉ½¹œøñÍµ…±°ùÍ•‘…¹œÁ¥­¥¹œğ½Íµ…±°øğ½…ÉÑ¥±”ø(€€€€€€€€€€€€ñ…ÉÑ¥±”øñÍÁ…¸ùM<¥¸ÁÉ½É•ÍÌğ½ÍÁ…¸øñÍÑÉ½¹œùí¹Õµ‰•È¡Á¥­¥¹Q½Ñ…±Ì¹…Ñ¥Ù•M¼¥ôğ½ÍÑÉ½¹œøñÍµ…±°ù‰•±Õ´Í•±•Í…¤ğ½Íµ…±°øğ½…ÉÑ¥±”ø(€€€€€€€€€€€€ñ…ÉÑ¥±”øñÍÁ…¸ùM<½µÁ±•Ñ•ğ½ÍÁ…¸øñÍÑÉ½¹œùí¹Õµ‰•È¡Á¥­¥¹Q½Ñ…±Ì¹½µÁ±•Ñ•‘M¼¥ôğ½ÍÑÉ½¹œøñÍµ…±°ù¡…É¤¥¹¤ğ½Íµ…±°øğ½…ÉÑ¥±”ø(€€€€€€€€€€€€ñ…ÉÑ¥±”øñÍÁ…¸ùA¥­•ÅÑäğ½ÍÁ…¸øñÍÑÉ½¹œùí¹Õµ‰•È¡Á¥­¥¹Q½Ñ…±Ì¹Á¥­•‘EÑä¥ôğ½ÍÑÉ½¹œøñÍµ…±°ù½˜í¹Õµ‰•È¡Á¥­¥¹Q½Ñ…±Ì¹É•ÅÕ•ÍÑEÑä¥ôÉ•ÅÕ•ÍĞğ½Íµ…±°øğ½…ÉÑ¥±”ø(€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€ì…±¥Ù•A¥­¥¹œ¹±•¹Ñ €ü€ (€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰•µÁÑäµÍÑ…Ñ”ˆøñÍÑÉ½¹œùM¹…ÁÍ¡½ĞÁ¥­¥¹œ‰•±Õ´Ñ•ÉÍ•‘¥„ğ½ÍÑÉ½¹œøñÍÁ…¸ù	…­•¹…ÍÍ¥¹µ•¹ĞÑ•Ñ…À…­Ñ¥˜¸5½¹¥Ñ½É¥¹œµÕ¹Õ°Í•Ñ•±… É•Í½ÕÉ”=]=HA%-%95=9%Q=HÑ•ÉÍ¥¹­É½¸¸ğ½ÍÁ…¸øğ½‘¥Øø(€€€€€€€€€€¤€è€…Á¥­¥¹5½¹¥Ñ½È¹±•¹Ñ €ü€ (€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰•µÁÑäµÍÑ…Ñ”ˆøñÍÑÉ½¹œùQ¥‘…¬…‘„…­Ñ¥Ù¥Ñ…ÌÁ…‘„™¥±Ñ•È¥¹¤ğ½ÍÑÉ½¹œøñÍÁ…¸ù½‰„Á¥±¥ ÍÑ…ÑÕÌ±…¥¸…Ñ…Ô­½Í½¹­…¸Á•¹…É¥…¸¸ğ½ÍÁ…¸øğ½‘¥Øø(€€€€€€€€€€¤€è€ (€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½¹¥Ñ½Èµ±¥ÍĞˆø(€€€€€€€€€€€€€íÁ¥­¥¹5½¹¥Ñ½È¹µ…À ¡Á¥­•È¤€ôøì(€€€€€€€€€€€€€€€½¹ÍĞ­•ä€ôÁ¥­•È¹Á¥­•É%ñğU9MM%9èè‘íÁ¥­•È¹Á¥­•É9…µ•õ€ì(€€€€€€€€€€€€€€€½¹ÍĞ½Á•¸€ô•áÁ…¹‘•‘A¥­•È€ôôô­•äì(€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€ñ…ÉÑ¥±”±…ÍÍ9…µ”ô‰µ½¹¥Ñ½ÈµÁ¥­•Èˆ­•äõí­•åô‘…Ñ„µ½Á•¸õí½Á•¹ôø(€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰µ½¹¥Ñ½ÈµÁ¥­•ÈµÍÕµµ…Éäˆ½¹±¥¬õì ¤€ôøÍ•ÑáÁ…¹‘•‘A¥­•È¡½Á•¸€ü€ˆˆ€è­•ä¥ô…É¥„µ•áÁ…¹‘•õí½Á•¹ôø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Á¥­•Èµ…Ù…Ñ…ÈˆùíÁ¥­•È¹Á¥­•É9…µ”¹ÍÁ±¥Ğ ˆ€ˆ¤¹Í±¥” À°€È¤¹µ…À ¡Á…ÉĞ¤€ôøÁ…ÉÑlÁt¤¹©½¥¸ ˆˆ¤ñğ€ˆü‰ôğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰µ½¹¥Ñ½ÈµÁ¥­•Èµ¹…µ”ˆøñÍÑÉ½¹œùíÁ¥­•È¹Á¥­•É9…µ•ôğ½ÍÑÉ½¹œøñÍµ…±°ùíÁ¥­•È¹Á¥­•É%ñğ€‰‰•±Õ´…‘„Á¥­•È%‰ôƒ
Üíl¸¸¹Á¥­•È¹é½¹•Ít¹©½¥¸ ˆ°€ˆ¥ôğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñÍÑÉ½¹œùíÁ¥­•È¹…Ñ¥Ù¥Ñ¥•Ì¹±•¹Ñ¡ôğ½ÍÑÉ½¹œøñÍµ…±°ùM<Í¡½İ¸ğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñÍÑÉ½¹œùí¹Õµ‰•È¡Á¥­•È¹É•µ…¥¹¥¹EÑä¥ôğ½ÍÑÉ½¹œøñÍµ…±°ùÉ•µ…¥¹¥¹œÅÑäğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰µ½¹¥Ñ½ÈµÁÉ½É•ÍÌˆøñ¤øñ•´ÍÑå±”õíìİ¥‘Ñ è€‘íÁ¥­•È¹½µÁ±•Ñ¥½¹AÑô•€õô€¼øğ½¤øñÍµ…±°ùíÁ¥­•È¹½µÁ±•Ñ¥½¹AÑô”Á¥­•ğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñˆùí½Á•¸€ü€‹Š"Hˆ€è€ˆ¬‰ôğ½ˆø(€€€€€€€€€€€€€€€€€€€€ğ½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€í½Á•¸€˜˜€ (€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½¹¥Ñ½Èµ‘•Ñ…¥°ˆø(€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½¹¥Ñ½Èµ‘•Ñ…¥°µ±…‰•°ˆøñÍÁ…¸ùM<€¼‘•ÍÑ¥¹…Ñ¥½¸ğ½ÍÁ…¸øñÍÁ…¸ùi½¹”€¼É½ÕÑ”ğ½ÍÁ…¸øñÍÁ…¸ùAÉ½É•ÍÌğ½ÍÁ…¸øñÍÁ…¸ùQ¥µ¥¹œğ½ÍÁ…¸øñÍÁ…¸ùMÑ…ÑÕÌğ½ÍÁ…¸øğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€íÁ¥­•È¹…Ñ¥Ù¥Ñ¥•Ì¹µ…À ¡…Ñ¥Ù¥Ñä¤€ôø€ (€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½¹¥Ñ½ÈµÍ¼ˆ­•äõí€‘í…Ñ¥Ù¥Ñä¹Í½9Õµ‰•Éô´‘í…Ñ¥Ù¥Ñä¹é½¹•ô´‘í…Ñ¥Ù¥Ñä¹Á¥­•É%‘õôø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñÍÑÉ½¹œùí•áÑÉ…Ñ]µÍM½%¡…Ñ¥Ù¥Ñä¹Í½9Õµ‰•È¥ôğ½ÍÑÉ½¹œøñÍµ…±°ùí…Ñ¥Ù¥Ñä¹‘•ÍÑ¥¹…Ñ¥½¹ôƒ
Üí…Ñ¥Ù¥Ñä¹Í­ÕôM-Tğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñÍÑÉ½¹œùí…Ñ¥Ù¥Ñä¹é½¹•ôğ½ÍÑÉ½¹œøñÍµ…±°ùí…Ñ¥Ù¥Ñä¹É½ÕÑ•ôğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰µ½¹¥Ñ½ÈµÍ¼µÁÉ½É•ÍÌˆøñÍÑÉ½¹œùí¹Õµ‰•È¡…Ñ¥Ù¥Ñä¹Á¥­•‘EÑä¥ô€¼í¹Õµ‰•È¡…Ñ¥Ù¥Ñä¹É•ÅÕ•ÍÑEÑä¥ôğ½ÍÑÉ½¹œøñ¤øñ•´ÍÑå±”õíìİ¥‘Ñ è€‘í…Ñ¥Ù¥Ñä¹½µÁ±•Ñ¥½¹AÑô•€õô€¼øğ½¤øñÍµ…±°ùí¹Õµ‰•È¡…Ñ¥Ù¥Ñä¹É•µ…¥¹¥¹EÑä¥ôÉ•µ…¥¹¥¹œğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñÍÑÉ½¹œùí™½Éµ…Ñ±½¬¡…Ñ¥Ù¥Ñä¹Á¥­¥¹MÑ…ÉÑĞ¥ôƒŠHí™½Éµ…Ñ±½¬¡…Ñ¥Ù¥Ñä¹Á¥­¥¹¹‘Ğ¥ôğ½ÍÑÉ½¹œøñÍµ…±°ùÍÑ…ÉĞƒŠH•¹ğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸øñ•´±…ÍÍ9…µ”õíÍÑ…ÑÕÌµ¡¥À€‘í…Ñ¥Ù¥Ñä¹ÍÑ…ÑÕÌ¹Ñ½1½İ•É…Í” ¥õôùí…Ñ¥Ù¥Ñä¹ÍÑ…ÑÕÌ¹É•Á±…” ‰|ˆ°€ˆ€ˆ¥ôğ½•´øñÍµ…±°ùí…Ñ¥Ù¥Ñä¹É…İMÑ…ÑÕÌñğ€‰]5L‰ôğ½Íµ…±°øğ½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€€€€€¤¥ô(€€€€€€€€€€€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€€€€€ğ½…ÉÑ¥±”ø(€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€ô¥ô(€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€¥ô(€€€€€€€€ğ½Í•Ñ¥½¸ø((€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰…ÍÍ¥¹µ•¹ĞµÍ•Ñ¥½¸Á…¹•°ˆø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…ÍÍ¥¹µ•¹Ğµ¡•…ˆø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á…¹•°µ¡•…ˆøñ‘¥ØøñÍÁ…¸øÀÔğ½ÍÁ…¸øñ‘¥Øøñ ÌùÍÍ¥¹µ•¹ĞÁÉ•Ù¥•Üğ½ ÌøñÀùí…ÍÍ¥¹µ•¹Ñ5½‘”€ôôô€‰é½¹”ˆ€ü€‰É½ÍÌµÉ½ÕÑ”‰…±…¹¥¹œ‰äé½¹”ˆ€è€‰	…±…¹•‰äÉ½ÕÑ”…¹Á¥­•È…Á…¥Ñä‰ôƒ
Üµ…¹Õ…°±½­ÌÑ…­”ÁÉ¥½É¥Ñäğ½Àøğ½‘¥Øøğ½‘¥Øøğ½‘¥Øø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…ÍÍ¥¹µ•¹ĞµÑ½½±Ìˆø(€€€€€€€€€€€€€€ñ¥¹ÁÕĞ…É¥„µ±…‰•°ô‰…É¤…ÍÍ¥¹µ•¹ĞˆÁ±…•¡½±‘•Èô‰M•…É Á¥­•È°é½¹”°M<¸¸¸ˆÙ…±Õ”õíÍ•…É¡ô½¹¡…¹”õì¡•Ù•¹Ğ¤€ôøÍ•ÑM•…É ¡•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”¥ô€¼ø(€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰Í½™Ğµ‰ÕÑÑ½¸±½­•µ‘½İ¹±½…ˆ(€€€€€€€€€€€€€€€‘¥Í…‰±•õì…±½­•‘M½½Õ¹Ñô(€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôø‘½İ¹±½…‘ÍØ¡…ÍÍ¥¹µ•¹ÑÌ°…Ñ¥Ù•I½ÕÑ”€ôôô€‰10ˆ€üÕ¹‘•™¥¹•€è…Ñ¥Ù•I½ÕÑ”°€‰µ…¹Õ…°ˆ¥ô(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€ƒŠL1½­•½¹±ä€¡í±½­•‘M½½Õ¹Ñô¤(€€€€€€€€€€€€€€ğ½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰Í½™Ğµ‰ÕÑÑ½¸ˆ½¹±¥¬õì ¤€ôø‘½İ¹±½…‘ÍØ¡…ÍÍ¥¹µ•¹ÑÌ°…Ñ¥Ù•I½ÕÑ”€ôôô€‰10ˆ€üÕ¹‘•™¥¹•€è…Ñ¥Ù•I½ÕÑ”¥ôûŠL½İ¹±½…MXğ½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€ì……ÍÍ¥¹µ•¹ÑÌ¹±•¹Ñ €ü€ (€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰•µÁÑäµÍÑ…Ñ”ˆøñÍÑÉ½¹œùÍÍ¥¹µ•¹Ğ‰•±Õ´‘¥‰Õ…Ğğ½ÍÑÉ½¹œøñÍÁ…¸ù-±¥¬•¹•É…Ñ”…ÍÍ¥¹µ•¹ĞÕ¹ÑÕ¬µ•µ‰…¤…¹‘¥‘…Ñ”M<¸ğ½ÍÁ…¸øğ½‘¥Øø(€€€€€€€€€€¤€è€ (€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…ÍÍ¥¹µ•¹Ğµ±¥ÍĞˆø(€€€€€€€€€€€€€í™¥±Ñ•É•‘ÍÍ¥¹µ•¹ÑÌ¹µ…À ¡…ÍÍ¥¹µ•¹Ğ°¥¹‘•à¤€ôøì(€€€€€€€€€€€€€€€½¹ÍĞ±½…€ô5…Ñ ¹É½Õ¹ ¡…ÍÍ¥¹µ•¹Ğ¹Ñ½Ñ…±EÑä€¼…ÍÍ¥¹µ•¹Ğ¹Á¥­•È¹ÁÉ½‘ÕÑ¥Ù¥Ñä¤€¨€ÄÀÀ¤ì(€€€€€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€€€€€ñ…ÉÑ¥±”±…ÍÍ9…µ”ô‰…ÍÍ¥¹µ•¹Ğµ…Éˆ‘…Ñ„µÍ½ÕÉ”õí…ÍÍ¥¹µ•¹Ğ¹Í½ÕÉ•ô­•äõí€‘í…ÍÍ¥¹µ•¹Ğ¹Í½ÕÉ•ô´‘í…ÍÍ¥¹µ•¹Ğ¹É½ÕÑ•ô´‘í…ÍÍ¥¹µ•¹Ğ¹é½¹•ô´‘í…ÍÍ¥¹µ•¹Ğ¹Á¥­•È¹ÍÑ…™™%‘õôø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…ÍÍ¥¹µ•¹Ğµ¥¹‘•àˆùíMÑÉ¥¹œ¡¥¹‘•à€¬€Ä¤¹Á…‘MÑ…ÉĞ È°€ˆÀˆ¥ôğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á¥­•Èµ…Ù…Ñ…Èˆùí…ÍÍ¥¹µ•¹Ğ¹Á¥­•È¹¹…µ”¹ÍÁ±¥Ğ ˆ€ˆ¤¹Í±¥” À°€È¤¹µ…À ¡Á…ÉĞ¤€ôøÁ…ÉÑlÁt¤¹©½¥¸ ˆˆ¥ôğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Á¥­•Èµ¥¹™¼ˆøñÍÑÉ½¹œùí…ÍÍ¥¹µ•¹Ğ¹Á¥­•È¹¹…µ•ôí…ÍÍ¥¹µ•¹Ğ¹Í½ÕÉ”€ôôô€‰µ…¹Õ…°ˆ€˜˜€ñ•´ù59U0ğ½•´ùôğ½ÍÑÉ½¹œøñÍÁ…¸ùí…ÍÍ¥¹µ•¹Ğ¹Á¥­•È¹ÍÑ…™™%‘ôƒ
Üí…ÍÍ¥¹µ•¹Ğ¹Á¥­•È¹Í¡¥™Ñôğ½ÍÁ…¸øğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…ÍÍ¥¹µ•¹ĞµÉ½ÕÑ”ˆøñÍÑÉ½¹œùí…ÍÍ¥¹µ•¹Ğ¹é½¹•ôğ½ÍÑÉ½¹œøñÍÁ…¸ùí…ÍÍ¥¹µ•¹Ğ¹É½ÕÑ•ôğ½ÍÁ…¸øğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…ÍÍ¥¹µ•¹Ğµ±½…ˆøñ‘¥ØøñÍÑÉ½¹œùí¹Õµ‰•È¡…ÍÍ¥¹µ•¹Ğ¹Ñ½Ñ…±EÑä¥ôğ½ÍÑÉ½¹œøñÍÁ…¸ùí…ÍÍ¥¹µ•¹Ğ¹Í½ÕÉ”€ôôô€‰µ…¹Õ…°ˆ€ü€‰µ…¹Õ…°±½­•ÅÑäˆ€è€¼€‘í¹Õµ‰•È¡…ÍÍ¥¹µ•¹Ğ¹Á¥­•È¹ÁÉ½‘ÕÑ¥Ù¥Ñä¥ôÅÑåôğ½ÍÁ…¸øğ½‘¥Øøñ¤øñ•´±…ÍÍ9…µ”õí±½…€ø€ÄÀÀ€˜˜…ÍÍ¥¹µ•¹Ğ¹Í½ÕÉ”€ôôô€‰…ÕÑ¼ˆ€ü€‰½Ù•Èˆ€è€ˆ‰ôÍÑå±”õíìİ¥‘Ñ è…ÍÍ¥¹µ•¹Ğ¹Í½ÕÉ”€ôôô€‰µ…¹Õ…°ˆ€ü€ˆÄÀÀ”ˆ€è€‘í5…Ñ ¹µ¥¸ ÄÀÀ°±½…¥ô•€õô€¼øğ½¤øğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…ÍÍ¥¹µ•¹ĞµÍ¼ˆøñÍÑÉ½¹œùí…ÍÍ¥¹µ•¹Ğ¹½É‘•ÉÌ¹±•¹Ñ¡ôğ½ÍÑÉ½¹œøñÍÁ…¸ùM<ğ½ÍÁ…¸øğ½‘¥Øø(€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰±½…µ‰…‘”ˆ‘…Ñ„µ½Ù•Èõí±½…€ø€ÄÀÀ€˜˜…ÍÍ¥¹µ•¹Ğ¹Í½ÕÉ”€ôôô€‰…ÕÑ¼‰ôùí…ÍÍ¥¹µ•¹Ğ¹Í½ÕÉ”€ôôô€‰µ…¹Õ…°ˆ€ü€‰1=-ˆ€è€‘í±½…‘ô•ôğ½‘¥Øø(€€€€€€€€€€€€€€€€€€ğ½…ÉÑ¥±”ø(€€€€€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€ô¥ô(€€€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€€€¥ô(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…ÍÍ¥¹µ•¹Ğµ™½½Ñ•Èˆø(€€€€€€€€€€€€ñ‘¥ØøñÍÁ…¸±…ÍÍ9…µ”ô‰Í…™”µ‘½Ğˆ€¼ø±°É½İÌ¡…Ù”Ù…±¥€ñ½‘”ùÍ½}¥ğ½½‘”ø€¬€ñ½‘”ùÍÑ…™™}¥ğ½½‘”øƒ
Üí=‰©•Ğ¹­•åÌ¡µ…¹Õ…±=Ù•ÉÉ¥‘•Ì¤¹±•¹Ñ¡ôµ…¹Õ…°±½­Ìğ½‘¥Øø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰™½½Ñ•Èµ…Ñ¥½¹Ìˆøñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôøìÍ•Ñ•¹•É…Ñ•¡™…±Í”¤ìÍ•Ñ5…¹Õ…±=Ù•ÉÉ¥‘•Ì¡íô¤ìÍ•ÑM•±•Ñ•‘=É‘•ÉÌ¡mt¤ì™±…Í  ‰M•µÕ„…ÍÍ¥¹µ•¹Ğ‘¥É•Í•Ğˆ¤ìõôùI•Í•Ğ…±°ğ½‰ÕÑÑ½¸øñ‰ÕÑÑ½¸½¹±¥¬õì ¤€ôø‘½İ¹±½…‘ÍØ¡…ÍÍ¥¹µ•¹ÑÌ¥ôù½İ¹±½……±°É½ÕÑ•Ì€ñÍÁ…¸ûŠLğ½ÍÁ…¸øğ½‰ÕÑÑ½¸øğ½‘¥Øø(€€€€€€€€€€ğ½‘¥Øø(€€€€€€€€ğ½Í•Ñ¥½¸ø(€€€€€€ğ½Í•Ñ¥½¸ø((€€€€€íÍ¡½İIÕ±•Ì€˜˜€ (€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µ‰…­‘É½ÀˆÉ½±”ô‰ÁÉ•Í•¹Ñ…Ñ¥½¸ˆ½¹5½ÕÍ•½İ¸õì¡•Ù•¹Ğ¤€ôøì¥˜€¡•Ù•¹Ğ¹Ñ…É•Ğ€ôôô•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ¤Í•ÑM¡½İIÕ±•Ì¡™…±Í”¤ìõôø(€€€€€€€€€€ñÍ•Ñ¥½¸±…ÍÍ9…µ”ô‰ÉÕ±•Ìµµ½‘…°ˆÉ½±”ô‰‘¥…±½œˆ…É¥„µµ½‘…°ô‰ÑÉÕ”ˆ…É¥„µ±…‰•±±•‘‰äô‰ÉÕ±•ÌµÑ¥Ñ±”ˆø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰µ½‘…°µ±½Í”ˆ½¹±¥¬õì ¤€ôøÍ•ÑM¡½İIÕ±•Ì¡™…±Í”¥ô…É¥„µ±…‰•°ô‰QÕÑÕÀˆû\ğ½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ñÀ±…ÍÍ9…µ”ô‰•å•‰É½ÜˆùXÄ1U1Q%=8=9QIPğ½Àø(€€€€€€€€€€€€ñ È¥ô‰ÉÕ±•ÌµÑ¥Ñ±”ˆùÍÍ¥¹µ•¹ĞÉÕ±•Ìğ½ Èø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÉÕ±”µ‰±½¬ˆøñÍÁ…¸øÄğ½ÍÁ…¸øñ‘¥ØøñÍÑÉ½¹œù±¥¥‰¥±¥Ñäğ½ÍÑÉ½¹œøñÀùM<ÍÑ…ÑÕÌ9\‘…¸‘•ÍÑ¥¹…Ñ¥½¸Ñ•Éµ…ÍÕ¬M]0€¼AM€¼M€¼-1€¼	M`€¼AP€¼AA0€¼IL€¼M1@€¼)1¸ğ½Àøğ½‘¥Øøğ½‘¥Øø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÉÕ±”µ‰±½¬ˆøñÍÁ…¸øÈğ½ÍÁ…¸øñ‘¥ØøñÍÑÉ½¹œù5…¹Á½İ•È¹••ğ½ÍÑÉ½¹œøñÀøñ½‘”ù%1%9¡é½¹”É•ÅÕ•ÍĞÅÑä€¼ÁÉ½‘ÕÑ¥Ù¥ÑäÁ•È5@é½¹”¤ğ½½‘”øğ½Àøğ½‘¥Øøğ½‘¥Øø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÉÕ±”µ‰±½¬ˆøñÍÁ…¸øÌğ½ÍÁ…¸øñ‘¥ØøñÍÑÉ½¹œùA¥­•ÈÉ½ÍÑ•Èğ½ÍÑÉ½¹œøñÀù)½ˆQ¥Ñ±”€ôA¥­•È°Í¡•‘Õ±”…­Ñ¥˜Á…‘„½Á•É…Ñ¥½¹…°‘…Ñ”°ÍÑ…™˜%Ù…±¥°‰Õ­…¸=d½ÕÑ¤½¥é¥¸¸ğ½Àøğ½‘¥Øøğ½‘¥Øø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÉÕ±”µ‰±½¬ˆøñÍÁ…¸øĞğ½ÍÁ…¸øñ‘¥ØøñÍÑÉ½¹œù]5L½ÕÑÁÕĞğ½ÍÑÉ½¹œøñÀøñ½‘”ù•ÉÉ½É}µ•ÍÍ…”íÍ½}¥íÍÑ…™™}¥ğ½½‘”øƒ
ÜÍ…ÑÔM<¡…¹å„µ•µ¥±¥­¤Í…ÑÔÍÑ…™˜%¸ğ½Àøğ½‘¥Øøğ½‘¥Øø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÉÕ±”µ‰±½¬ˆøñÍÁ…¸øÔğ½ÍÁ…¸øñ‘¥ØøñÍÑÉ½¹œùÑ½µ¥Œé½¹”ğ½ÍÑÉ½¹œøñÀùi½¹”‰•É…Í…°‘…É¤€ñ½‘”ù½É¥¥¹}É…­}¹…µ”ğ½½‘”ø¸M<‘•¹…¸±•‰¥ ‘…É¤Í…ÑÔé½¹”µ…ÍÕ¬€ñ½‘”ùi=9}=91%Pğ½½‘”ø‘…¸Ñ¥‘…¬¥­ÕĞ…ÕÑ¼µ…ÍÍ¥¹µ•¹Ğ¸ğ½Àøğ½‘¥Øøğ½‘¥Øø(€€€€€€€€€€€€ñ Ìùi½¹”ÁÉ½‘ÕÑ¥Ù¥Ñä‘É…™Ğğ½ Ìø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰ÉÕ±”µÉ¥ˆùíi=9}IU1L¹µ…À ¡ÉÕ±”¤€ôø€ñ‘¥Ø­•äõíÉÕ±”¹é½¹•ôøñÍÁ…¸ùíÉÕ±”¹é½¹•ôğ½ÍÁ…¸øñÍÑÉ½¹œùí¹Õµ‰•È¡ÉÕ±”¹ÁÉ½‘ÕÑ¥Ù¥Ñä¥ôğ½ÍÑÉ½¹œøñÍµ…±°ùÅÑä€¼5@ğ½Íµ…±°øğ½‘¥Øø¥ôğ½‘¥Øø(€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘…°µ¹½Ñ”ˆù•µ¼Ù…±Õ•ÌƒŠPÉ•Á±…”İ¥Ñ Ñ¡”™¥¹…°ÁÉ½‘ÕÑ¥Ù¥ÑäµÁ•Èµé½¹”Í½ÕÉ”‰•™½É”±¥Ù”ÑÉ¥…°¸ğ½‘¥Øø(€€€€€€€€€€ğ½Í•Ñ¥½¸ø(€€€€€€€€ğ½‘¥Øø(€€€€€€¥ô((€€€€€íÑ½…ÍĞ€˜˜€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ½…ÍĞˆÉ½±”ô‰ÍÑ…ÑÕÌˆûŠrLíÑ½…ÍÑôğ½‘¥Øùô(€€€€ğ½µ…¥¸ø(€€¤ì)ô4(