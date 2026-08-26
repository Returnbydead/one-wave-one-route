"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildLockedCsv } from "./assignment-csv";
import { compareActivityTimeDesc, filterHelperCandidates, findExactHelperOrder, getLoadPosition, STAGING_BARCODES } from "./helper-task-core.mjs";
import { formatPickerCoverage, pickerMatchesAnyZone } from "./zone-eligibility.mjs";
import { SoMasterView } from "./so-master-view";
import { ConsolidatePickingView } from "./consolidate-picking-view";
import { supabase } from "@/lib/supabase-browser";

type RouteCode = "SWL - PSG" | "CSA - KLD" | "BSX" | "CPT - PPL" | "RDS - SLP" | "JLB";
type AssignmentMode = "route" | "zone";
type WorkspaceView = "assignment" | "monitor" | "so-master" | "consolidate" | "staging-tasks" | "line-tasks" | "developer";
type HelperRole = "STAGING_HELPER" | "LINE_HELPER";
type CameraScanTarget = "SO" | "LOCATION";
type UserRole = "DEVELOPER" | HelperRole | "CONSOLIDATE_PICKER" | "CONSOLIDATOR";

type AuthUser = {
  staffId: string;
  name: string;
  role: UserRole;
};

type StaffAccount = AuthUser & {
  active: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

const EMPTY_ORDERS: SalesOrder[] = [];
const EMPTY_PICKERS: Picker[] = [];

type DeveloperStatus = {
  configured: boolean;
  accountStore: boolean;
  accountError?: string;
  helperTaskCount?: number;
  snapshotHeads?: Array<{ source: string; operational_date: string; generated_at: string; row_count: number; checksum: string }>;
  latestRuns?: Array<{ source: string; status: string; started_at: string; written_rows: number; error_code?: string | null }>;
};

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

type HelperTaskStatus = "READY" | "CLAIMED_STAGING" | "STAGED_PICKING" | "CLAIMED_LINE" | "STAGED_PACKER";

type HelperTaskRecord = {
  status: HelperTaskStatus;
  stagingHelperId: string;
  lineHelperId: string;
  staging: string;
  packingLine: string;
  updatedAt?: string;
  history: Array<{ type: string; value: string; at: string }>;
};

type HelperTaskRow = {
  so_number: string;
  status: Exclude<HelperTaskStatus, "READY">;
  staging_helper_id: string;
  line_helper_id: string;
  staging: string;
  packing_line: string;
  updated_at?: string;
  history: Array<{ type: string; value: string; at: string }>;
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
  if (!value) return "–";
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

function helperStatusLabel(status: HelperTaskStatus) {
  if (status === "CLAIMED_STAGING") return "Menuju staging picking";
  if (status === "STAGED_PICKING") return "Di staging picking";
  if (status === "CLAIMED_LINE") return "Menuju checker line";
  if (status === "STAGED_PACKER") return "Barang sudah di staging packer";
  return "Belum menjadi task";
}

function helperTaskFromRow(row: HelperTaskRow): HelperTaskRecord {
  return {
    status: row.status,
    stagingHelperId: row.staging_helper_id,
    lineHelperId: row.line_helper_id,
    staging: row.staging,
    packingLine: row.packing_line,
    updatedAt: row.updated_at,
    history: Array.isArray(row.history) ? row.history : [],
  };
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

function downloadLockedCsv(assignments: Assignment[], route?: RouteCode) {
  const blob = new Blob([buildLockedCsv(assignments, route)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const operationalDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
  }).format(new Date());
  anchor.download = `one-wave-${(route ?? "all-route").toLowerCase().replaceAll(" ", "-")}-locked-${operationalDate}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<WorkspaceView>("assignment");
  const [activeRoute, setActiveRoute] = useState<RouteCode | "ALL">("ALL");
  const [manualRoute, setManualRoute] = useState<RouteCode>("SWL - PSG");
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [selectedPickerIds, setSelectedPickerIds] = useState<string[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [bulkPickerIds, setBulkPickerIds] = useState("");
  const [showPickerPool, setShowPickerPool] = useState(false);
  const [showAllPickers, setShowAllPickers] = useState(false);
  const [manualOverrides, setManualOverrides] = useState<ManualOverrides>({});
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("route");
  const [selectedZone, setSelectedZone] = useState("ALL");
  const [liveOrders, setLiveOrders] = useState<SalesOrder[] | null>(null);
  const [livePickers, setLivePickers] = useState<Picker[] | null>(null);
  const [livePicking, setLivePicking] = useState<PickingActivity[]>([]);
  const [monitorStatus, setMonitorStatus] = useState<"ALL" | PickingActivity["status"]>("IN_PROGRESS");
  const [monitorSearch, setMonitorSearch] = useState("");
  const [expandedPicker, setExpandedPicker] = useState("");
  const [sourceStatus, setSourceStatus] = useState<"loading" | "live" | "stale" | "fallback">("loading");
  const [sourceMessage, setSourceMessage] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const [generated, setGenerated] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedAssignmentZone, setExpandedAssignmentZone] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [toast, setToast] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser>({ staffId: "DEV01", name: "Developer", role: "DEVELOPER" });
  const [authReady, setAuthReady] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [helperRole, setHelperRole] = useState<HelperRole>("STAGING_HELPER");
  const [helperSearch, setHelperSearch] = useState("");
  const [helperSuggestionsOpen, setHelperSuggestionsOpen] = useState(false);
  const [selectedHelperSo, setSelectedHelperSo] = useState("");
  const [helperSoScan, setHelperSoScan] = useState("");
  const [helperLocationScan, setHelperLocationScan] = useState("");
  const [verifiedHelperStep, setVerifiedHelperStep] = useState("");
  const [cameraTarget, setCameraTarget] = useState<CameraScanTarget | null>(null);
  const [cameraMessage, setCameraMessage] = useState("");
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraControlsRef = useRef<{ stop: () => void } | null>(null);
  const [developerStatus, setDeveloperStatus] = useState<DeveloperStatus | null>(null);
  const [staffAccounts, setStaffAccounts] = useState<StaffAccount[]>([]);
  const [developerLoading, setDeveloperLoading] = useState(false);
  const [staffForm, setStaffForm] = useState({ staffId: "", name: "", role: "STAGING_HELPER" as UserRole, password: "" });
  const [helperTasks, setHelperTasks] = useState<Record<string, HelperTaskRecord>>({});

  const ordersData = liveOrders ?? EMPTY_ORDERS;
  const pickerRoster = livePickers ?? EMPTY_PICKERS;

  const refreshLiveData = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("owor_get_live_snapshot");
      if (error) throw error;
      const payload = data as {
        ok?: boolean;
        error?: string;
        orders?: SalesOrder[];
        pickers?: Picker[];
        picking?: PickingActivity[];
        generatedAt?: string;
        stale?: boolean;
        sync?: { status?: string; message?: string };
      };
      if (payload.ok !== true || !Array.isArray(payload.orders) || !Array.isArray(payload.pickers)) {
        throw new Error(payload.error || "SNAPSHOT_NOT_READY");
      }
      const orders = payload.orders.filter((order: SalesOrder) =>
        ROUTES.some((route) => route.code === order.route),
      ) as SalesOrder[];
      setLiveOrders(orders);
      setLivePickers(payload.pickers as Picker[]);
      setLivePicking(Array.isArray(payload.picking) ? payload.picking as PickingActivity[] : []);
      setLastSyncedAt(String(payload.generatedAt || ""));
      setSourceMessage(payload.pickers.length
        ? String(payload.sync?.message || "")
        : "Roster picker terjadwal belum tersinkron; assignment ditahan.");
      setSourceStatus(payload.stale || payload.pickers.length === 0 ? "stale" : "live");
      setManualOverrides((current) => {
        const valid = new Set(orders.map((order) => order.soNumber));
        return Object.fromEntries(Object.entries(current).filter(([soNumber]) => valid.has(soNumber)));
      });
    } catch {
      setSourceMessage("");
      setSourceStatus("fallback");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshLiveData(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshLiveData]);

  const refreshHelperTasks = useCallback(async () => {
    const { data, error } = await supabase.from("owor_helper_tasks").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    setHelperTasks(Object.fromEntries((data as HelperTaskRow[]).map((row) => [row.so_number, helperTaskFromRow(row)])));
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!active) return;
      if (!authData.user) {
        router.replace("/login/");
        return;
      }
      const { data: profile, error } = await supabase.rpc("owor_current_profile");
      if (!active) return;
      if (error || !profile) {
        await supabase.auth.signOut();
        router.replace("/login/");
        return;
      }
      const row = profile as { staff_id: string; name: string; role: UserRole };
      const user = { staffId: row.staff_id, name: row.name, role: row.role };
      setAuthUser(user);
      if (user.role === "STAGING_HELPER" || user.role === "LINE_HELPER") {
          setHelperRole(user.role);
          setActiveView(user.role === "STAGING_HELPER" ? "staging-tasks" : "line-tasks");
      } else if (user.role === "CONSOLIDATE_PICKER" || user.role === "CONSOLIDATOR") {
          setActiveView("consolidate");
      }
      await Promise.all([refreshLiveData(), refreshHelperTasks()]);
      if (active) setAuthReady(true);
    })();
    const channel = supabase.channel("owor-helper-tasks-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "owor_helper_tasks" }, () => void refreshHelperTasks())
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [refreshHelperTasks, refreshLiveData, router]);

  const refreshDeveloper = useCallback(async () => {
    setDeveloperLoading(true);
    const { data, error } = await supabase.functions.invoke("owor-admin", { method: "GET" });
    const payload = data as { ok?: boolean; configured?: boolean; accountStore?: boolean; helperTaskCount?: number; snapshotHeads?: DeveloperStatus["snapshotHeads"]; latestRuns?: DeveloperStatus["latestRuns"]; users?: Array<{ staff_id: string; name: string; role: UserRole; active: boolean; updated_at?: string }> } | null;
    setDeveloperStatus(!error && payload?.ok ? {
      configured: true,
      accountStore: true,
      helperTaskCount: payload.helperTaskCount ?? 0,
      snapshotHeads: payload.snapshotHeads ?? [],
      latestRuns: payload.latestRuns ?? [],
    } : { configured: false, accountStore: false, accountError: error?.message || "STATUS_UNAVAILABLE" });
    setStaffAccounts(Array.isArray(payload?.users) ? payload.users.map((row) => ({ staffId: row.staff_id, name: row.name, role: row.role, active: row.active, updatedAt: row.updated_at })) : []);
    setDeveloperLoading(false);
  }, []);

  const autoAssignments = useMemo(
    () =>
      generated
        ? buildAssignments(
            ordersData.filter((order) => !manualOverrides[order.soNumber]),
            livePickers ?? EMPTY_PICKERS,
            assignmentMode,
          )
        : [],
    [assignmentMode, generated, livePickers, manualOverrides, ordersData],
  );

  const assignments = useMemo(
    () => [
      ...autoAssignments,
      ...buildManualAssignments(ordersData, manualOverrides, pickerRoster, assignmentMode),
    ],
    [assignmentMode, autoAssignments, manualOverrides, ordersData, pickerRoster],
  );

  const lockedSoCount = assignments
    .filter(
      (assignment) =>
        assignment.source === "manual" &&
        (activeRoute === "ALL" || assignmentHasRoute(assignment, activeRoute)),
    )
    .reduce((total, assignment) => total + assignment.orders.length, 0);

  const zoneOptions = useMemo(() => {
    const groups = new Map<string, { zone: string; so: number; qty: number; routes: Set<RouteCode> }>();
    ordersData.forEach((order) => {
      const key = normalizedZone(order.zone);
      const current = groups.get(key) ?? { zone: order.zone, so: 0, qty: 0, routes: new Set<RouteCode>() };
      current.so += 1;
      current.qty += order.qty;
      current.routes.add(order.route);
      groups.set(key, current);
    });
    return [...groups.values()]
      .map((current) => {
        const productivity = ZONE_RULES.find(
          (rule) => normalizedZone(rule.zone) === normalizedZone(current.zone),
        )?.productivity ?? 2000;
        return {
          ...current,
          mpRequired: Math.ceil(current.qty / productivity),
        };
      })
      .sort((a, b) => a.zone.localeCompare(b.zone));
  }, [ordersData]);

  const zoneOptionTotals = zoneOptions.reduce(
    (totals, item) => ({
      qty: totals.qty + item.qty,
      mpRequired: totals.mpRequired + item.mpRequired,
    }),
    { qty: 0, mpRequired: 0 },
  );

  const manualRouteOrders = ordersData.filter((order) =>
    assignmentMode === "zone"
      ? selectedZone === "ALL" || normalizedZone(order.zone) === selectedZone
      : order.route === manualRoute,
  );

  const targetPickerZones = new Set(
    (selectedOrders.length
      ? manualRouteOrders.filter((order) => selectedOrders.includes(order.soNumber))
      : manualRouteOrders
    ).map((order) => order.zone),
  );

  const searchedPickers = pickerRoster.filter((picker) => {
    const query = pickerSearch.trim().toLowerCase();
    return (
      !query ||
      picker.staffId.includes(query) ||
      picker.name.toLowerCase().includes(query) ||
      picker.zone.toLowerCase().includes(query)
    );
  });

  const eligiblePickers = searchedPickers.filter((picker) =>
    pickerMatchesAnyZone(picker.zone, targetPickerZones),
  );

  const filteredPickers = (showAllPickers ? searchedPickers : eligiblePickers).sort((a, b) => {
    const aRelevant = pickerMatchesAnyZone(a.zone, targetPickerZones) ? 0 : 1;
    const bRelevant = pickerMatchesAnyZone(b.zone, targetPickerZones) ? 0 : 1;
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
        const orders = ordersData.filter((item) => item.route === route.code);
        const routeAssignments = assignments.filter(
          (item) => assignmentHasRoute(item, route.code),
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
    [assignments, ordersData],
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
    ordersData.forEach((order) => {
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
          .filter((item) => assignmentHasRoute(item, row.route))
          .filter((item) =>
            item.orders.some((order) => order.zone === row.zone),
          )
          .map((item) => item.picker.staffId),
      ).size,
    }));
  }, [assignments, ordersData]);

  const filteredAssignments = assignments.filter((item) => {
    const routeMatch = activeRoute === "ALL" || assignmentHasRoute(item, activeRoute);
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

  const assignmentsByZone = useMemo(() => {
    const groups = new Map<string, Assignment[]>();
    filteredAssignments.forEach((assignment) => {
      const key = normalizedZone(assignment.zone);
      groups.set(key, [...(groups.get(key) ?? []), assignment]);
    });
    return [...groups.entries()]
      .map(([key, items]) => ({
        key,
        zone: items[0]?.zone ?? key,
        items,
        qty: items.reduce((sum, item) => sum + item.totalQty, 0),
        so: items.reduce((sum, item) => sum + item.orders.length, 0),
        routes: [...new Set(items.flatMap((item) => item.orders.map((order) => order.route)))],
        pickerCount: new Set(items.map((item) => item.picker.staffId)).size,
        manualCount: items.filter((item) => item.source === "manual").length,
      }))
      .sort((a, b) => a.zone.localeCompare(b.zone));
  }, [filteredAssignments]);

  const totals = {
    qty: ordersData.reduce((sum, item) => sum + item.qty, 0),
    so: ordersData.length,
    sku: ordersData.reduce((sum, item) => sum + item.sku, 0),
    mp: new Set(assignments.map((item) => item.picker.staffId)).size,
  };

  const pickingMonitor = useMemo(() => {
    const groups = new Map<string, {
      pickerId: string;
      pickerName: string;
      activities: PickingActivity[];
      requestQty: number;
      pickedQty: number;
      remainingQty: number;
      activeSo: number;
      completedSo: number;
      zones: Set<string>;
      routes: Set<RouteCode>;
    }>();
    livePicking.forEach((activity) => {
      const key = activity.pickerId || `UNASSIGNED::${activity.pickerName}`;
      const current = groups.get(key) ?? {
        pickerId: activity.pickerId, pickerName: activity.pickerName, activities: [],
        requestQty: 0, pickedQty: 0, remainingQty: 0, activeSo: 0, completedSo: 0,
        zones: new Set<string>(), routes: new Set<RouteCode>(),
      };
      current.activities.push(activity);
      current.requestQty += activity.requestQty;
      current.pickedQty += activity.pickedQty;
      current.remainingQty += activity.remainingQty;
      current.activeSo += activity.status === "IN_PROGRESS" ? 1 : 0;
      current.completedSo += activity.status === "COMPLETED" ? 1 : 0;
      current.zones.add(activity.zone);
      current.routes.add(activity.route);
      groups.set(key, current);
    });
    const query = monitorSearch.trim().toLowerCase();
    return [...groups.values()]
      .map((group) => ({
        ...group,
        activities: group.activities
          .filter((activity) => monitorStatus === "ALL" || activity.status === monitorStatus)
          .sort((a, b) => compareActivityTimeDesc(a.pickingStartAt, b.pickingStartAt)),
        completionPct: group.requestQty > 0 ? Math.min(100, Math.round((group.pickedQty / group.requestQty) * 100)) : 0,
      }))
      .filter((group) => group.activities.length > 0)
      .filter((group) => !query || group.pickerId.includes(query) || group.pickerName.toLowerCase().includes(query) || group.activities.some((activity) => activity.soNumber.toLowerCase().includes(query) || activity.zone.toLowerCase().includes(query) || activity.route.toLowerCase().includes(query)))
      .sort((a, b) => b.activeSo - a.activeSo || b.remainingQty - a.remainingQty || a.pickerName.localeCompare(b.pickerName));
  }, [livePicking, monitorSearch, monitorStatus]);


  const pickingTotals = useMemo(() => ({
    activePickers: new Set(livePicking.filter((item) => item.status === "IN_PROGRESS" && item.pickerId).map((item) => item.pickerId)).size,
    activeSo: livePicking.filter((item) => item.status === "IN_PROGRESS").length,
    completedSo: livePicking.filter((item) => item.status === "COMPLETED").length,
    pickedQty: livePicking.reduce((sum, item) => sum + item.pickedQty, 0),
    requestQty: livePicking.reduce((sum, item) => sum + item.requestQty, 0),
  }), [livePicking]);

  const currentHelperId = authUser.staffId.trim().toUpperCase();
  const activeHelperCandidates = useMemo(
    () => filterHelperCandidates(ordersData, livePicking, "", Math.max(20, ordersData.length)) as SalesOrder[],
    [livePicking, ordersData],
  );
  const helperSuggestionOrders = useMemo(
    () => filterHelperCandidates(activeHelperCandidates, [], helperSearch, 20) as SalesOrder[],
    [activeHelperCandidates, helperSearch],
  );
  const helperLookupOrder = useMemo(() => {
    return findExactHelperOrder(activeHelperCandidates, helperSearch) as SalesOrder | undefined;
  }, [activeHelperCandidates, helperSearch]);

  const helperBoard = useMemo(() => Object.entries(helperTasks)
    .map(([soNumber, task]) => ({
      task,
      order: ordersData.find((order) => order.soNumber === soNumber),
    }))
    .filter((row): row is { task: HelperTaskRecord; order: SalesOrder } => Boolean(row.order))
    .filter(({ task }) => helperRole === "STAGING_HELPER"
      ? task.stagingHelperId === currentHelperId
      : task.status === "STAGED_PICKING" || task.lineHelperId === currentHelperId)
    .sort((left, right) => compareActivityTimeDesc(left.task.updatedAt, right.task.updatedAt)),
  [currentHelperId, helperRole, helperTasks, ordersData]);

  const selectedHelperOrder = ordersData.find((order) => order.soNumber === selectedHelperSo);
  const selectedHelperPicking = livePicking.find((activity) => activity.soNumber === selectedHelperSo);
  const selectedHelperTask = selectedHelperSo ? helperTasks[selectedHelperSo] : undefined;
  const selectedHelperStatus: HelperTaskStatus = selectedHelperTask?.status ?? "READY";
  const helperVerificationPhase = helperRole === "STAGING_HELPER" ? "STAGING" : "LINE";
  const helperVerificationKey = selectedHelperSo ? `${selectedHelperSo}:${helperRole}` : "";
  const helperTaskTotals = {
    active: helperBoard.filter(({ task }) => task.status === "CLAIMED_STAGING" || task.status === "CLAIMED_LINE").length,
    staged: helperBoard.filter(({ task }) => task.status === "STAGED_PICKING").length,
    located: helperBoard.filter(({ task }) => task.status === "STAGED_PACKER").length,
  };

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  }

  const releaseCameraResources = useCallback(() => {
    cameraControlsRef.current?.stop();
    cameraControlsRef.current = null;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
  }, []);

  const stopCamera = useCallback(() => {
    releaseCameraResources();
    setCameraTarget(null);
    setCameraMessage("");
  }, [releaseCameraResources]);

  function openCamera(target: CameraScanTarget) {
    releaseCameraResources();
    setCameraMessage("Meminta izin kamera belakang…");
    setCameraTarget(target);
  }

  useEffect(() => {
    if (!cameraTarget) return;
    let disposed = false;

    async function startCameraScanner() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error("Kamera web membutuhkan HTTPS dan browser yang mendukung akses kamera.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        const video = cameraVideoRef.current;
        if (!video) throw new Error("Preview kamera belum siap.");
        video.srcObject = stream;
        await video.play();
        setCameraMessage("Arahkan barcode ke dalam kotak. Kamera membaca otomatis.");

        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        cameraControlsRef.current = await reader.decodeFromStream(stream, video, (result, _error, controls) => {
          if (!result || disposed) return;
          const value = result.getText().trim();
          if (!value) return;
          if (cameraTarget === "SO") {
            const normalized = value.toUpperCase();
            const valid = normalized === selectedHelperSo.toUpperCase() || normalized === extractWmsSoId(selectedHelperSo);
            if (valid) {
              setVerifiedHelperStep(helperVerificationKey);
              setHelperSoScan("");
              flash(`SO ${extractWmsSoId(selectedHelperSo)} terverifikasi dari kamera`);
            } else {
              setHelperSoScan(value);
              setVerifiedHelperStep("");
              flash("Barcode SO tidak cocok dengan task aktif");
            }
          } else {
            setHelperLocationScan(value);
            flash(`Barcode lokasi ${value} terbaca`);
          }
          controls.stop();
          releaseCameraResources();
          setCameraTarget(null);
          setCameraMessage("");
        });
      } catch (error) {
        releaseCameraResources();
        if (disposed) return;
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError") setCameraMessage("Izin kamera ditolak. Izinkan Camera pada pengaturan situs Chrome, lalu coba lagi.");
        else if (name === "NotFoundError") setCameraMessage("Kamera belakang tidak ditemukan pada perangkat ini.");
        else setCameraMessage(error instanceof Error ? error.message : "Kamera gagal dibuka. Gunakan input manual.");
      }
    }

    void startCameraScanner();
    return () => {
      disposed = true;
      releaseCameraResources();
    };
  }, [cameraTarget, helperVerificationKey, releaseCameraResources, selectedHelperSo]);

  function chooseHelperSuggestion(order: SalesOrder) {
    setHelperSearch(extractWmsSoId(order.soNumber));
    setHelperSuggestionsOpen(false);
  }

  function openManualRoute(route: RouteCode) {
    setManualRoute(route);
    setActiveRoute(route);
    setAssignmentMode("route");
    setSelectedZone("ALL");
    setSelectedOrders([]);
    setShowAllPickers(false);
  }

  function selectAssignmentMode(mode: AssignmentMode) {
    setAssignmentMode(mode);
    setSelectedOrders([]);
    setShowAllPickers(false);
    if (mode === "zone") setActiveRoute("ALL");
  }

  function selectHelperTask(soNumber: string) {
    stopCamera();
    setSelectedHelperSo(soNumber);
    setHelperSoScan("");
    setHelperLocationScan("");
    setVerifiedHelperStep("");
  }

  async function applyHelperAction(soNumber: string, action: string, barcode = "") {
    const { data, error } = await supabase.rpc("owor_apply_helper_action", {
      p_so_number: soNumber,
      p_action: action,
      p_barcode: barcode,
    });
    if (error) throw error;
    const row = data as HelperTaskRow;
    const next = helperTaskFromRow(row);
    setHelperTasks((current) => ({ ...current, [soNumber]: next }));
    return next;
  }

  async function startStagingTask() {
    if (!helperLookupOrder) {
      flash("Scan atau masukkan nomor SO yang valid");
      return;
    }
    const soNumber = helperLookupOrder.soNumber;
    if (helperTasks[soNumber]) {
      selectHelperTask(soNumber);
      flash("SO ini sudah masuk task helper");
      return;
    }
    try {
      await applyHelperAction(soNumber, "CLAIM_STAGING");
      selectHelperTask(soNumber);
      setHelperSearch("");
      flash(`SO ${extractWmsSoId(soNumber)} masuk task staging`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Task gagal di-claim");
    }
  }

  async function claimLineTask() {
    if (!selectedHelperSo || !selectedHelperTask) return;
    try {
      await applyHelperAction(selectedHelperSo, "CLAIM_LINE");
      flash(`SO ${extractWmsSoId(selectedHelperSo)} diambil untuk checker line`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Task line gagal diambil");
    }
  }

  function verifyHelperSo() {
    if (!selectedHelperSo) return;
    const scanned = helperSoScan.trim().toUpperCase();
    const valid = scanned === selectedHelperSo.toUpperCase() || scanned === extractWmsSoId(selectedHelperSo);
    if (!valid) {
      setVerifiedHelperStep("");
      flash("Barcode SO tidak cocok dengan task aktif");
      return;
    }
    setVerifiedHelperStep(helperVerificationKey);
    setHelperSoScan("");
    flash(`SO terverifikasi untuk ${helperVerificationPhase === "STAGING" ? "staging picking" : "checker line"}`);
  }

  async function submitHelperLocation() {
    if (!selectedHelperSo || !selectedHelperTask) return;
    if (verifiedHelperStep !== helperVerificationKey) {
      flash("Scan barcode SO aktif lebih dulu");
      return;
    }
    try {
      const action = helperRole === "STAGING_HELPER" ? "SCAN_STAGING" : "SCAN_PACKING_LINE";
      const next = await applyHelperAction(selectedHelperSo, action, helperLocationScan);
      setHelperLocationScan("");
      setVerifiedHelperStep("");
      flash(next.status === "STAGED_PACKER" ? `Barang tercatat di ${next.packingLine}` : `Barang tercatat di ${next.staging}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Scan gagal diproses");
    }
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
    const orderedOrders = ordersData.filter((order) =>
      selectedOrders.includes(order.soNumber),
    ).sort((a, b) => b.qty - a.qty);

    setManualOverrides((current) => {
      const next = { ...current };
      orderedOrders.forEach((order) => {
        const selectedStaffId = [...loads.entries()].sort((a, b) => {
          const aPicker = pickerRoster.find((picker) => picker.staffId === a[0]);
          const bPicker = pickerRoster.find((picker) => picker.staffId === b[0]);
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

  async function createStaffAccount() {
    if (!staffForm.staffId.trim() || !staffForm.name.trim() || staffForm.password.length < 8) {
      flash("Lengkapi Staff ID, nama, role, dan password minimal 8 karakter");
      return;
    }
    setDeveloperLoading(true);
    const { data, error } = await supabase.functions.invoke("owor-admin", { method: "POST", body: staffForm });
    const payload = data as { ok?: boolean; error?: string } | null;
    setDeveloperLoading(false);
    if (error || payload?.ok !== true) {
      flash(payload?.error || error?.message || "Akun gagal dibuat");
      return;
    }
    setStaffForm({ staffId: "", name: "", role: "STAGING_HELPER", password: "" });
    flash("Akun staff berhasil disimpan");
    await refreshDeveloper();
  }

  async function setStaffAccountActive(account: StaffAccount) {
    setDeveloperLoading(true);
    const { data, error } = await supabase.functions.invoke("owor-admin", {
      method: "PATCH",
      body: { staffId: account.staffId, active: !account.active },
    });
    const payload = data as { ok?: boolean; error?: string } | null;
    setDeveloperLoading(false);
    if (error || payload?.ok !== true) {
      flash(payload?.error || error?.message || "Status akun gagal diubah");
      return;
    }
    flash(`Akun ${account.staffId} ${account.active ? "dinonaktifkan" : "diaktifkan"}`);
    await refreshDeveloper();
  }

  async function runBackendSync() {
    setDeveloperLoading(true);
    const { data, error } = await supabase.functions.invoke("owor-admin", { method: "POST", body: { action: "sync" } });
    const payload = data as { ok?: boolean; error?: string } | null;
    setDeveloperLoading(false);
    flash(!error && payload?.ok ? "Backend sync berhasil dijalankan" : payload?.error || error?.message || "Backend sync gagal");
    await refreshDeveloper();
  }

  async function resetAllConsolidateTasks() {
    const confirmed = window.confirm(
      "Reset seluruh Picking Task dan Consolidation Task untuk trial SRA L2+? Snapshot SO tetap disimpan, tetapi progress task yang sedang berjalan akan hilang.",
    );
    if (!confirmed) return;
    setDeveloperLoading(true);
    const { data, error } = await supabase.rpc("owor_reset_consolidate_tasks", { p_scope_code: "SRA_L2_UP" });
    const payload = data as { ok?: boolean; deletedBatches?: number } | null;
    setDeveloperLoading(false);
    if (error || payload?.ok !== true) {
      flash(error?.message || "Reset consolidate task gagal");
      return;
    }
    flash(`${number(payload.deletedBatches || 0)} batch dan seluruh task turunannya berhasil direset`);
    await refreshDeveloper();
  }

  async function logout() {
    if (logoutPending) return;
    setLogoutPending(true);
    setAuthReady(false);
    await supabase.auth.signOut();
    window.location.replace("/login/");
  }

  if (!authReady) {
    return <main className="access-loading"><div className="brand-mark">1W</div><strong>Memuat akses workspace…</strong><span>Role dan session sedang diverifikasi.</span></main>;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark">1W</div><span>ONE WAVE</span></div>
        <nav aria-label="Navigasi utama">
          {authReady && authUser.role === "DEVELOPER" && <button className={`nav-menu-item ${activeView === "assignment" ? "active" : ""}`} aria-label="Buka menu assignment" aria-current={activeView === "assignment" ? "page" : undefined} onClick={() => setActiveView("assignment")}><span>⌁</span><b>Assignment</b></button>}
          {authReady && authUser.role === "DEVELOPER" && <button className={`nav-menu-item ${activeView === "monitor" ? "active" : ""}`} aria-label="Buka menu picking monitor" aria-current={activeView === "monitor" ? "page" : undefined} onClick={() => setActiveView("monitor")}><span>▷</span><b>Picking monitor</b></button>}
          {authReady && authUser.role === "DEVELOPER" && <button className={`nav-menu-item ${activeView === "so-master" ? "active" : ""}`} aria-label="Buka menu SO Master" aria-current={activeView === "so-master" ? "page" : undefined} onClick={() => setActiveView("so-master")}><span>≡</span><b>SO Master</b></button>}
          {authReady && (authUser.role === "DEVELOPER" || authUser.role === "CONSOLIDATE_PICKER" || authUser.role === "CONSOLIDATOR") && <button className={`nav-menu-item ${activeView === "consolidate" ? "active" : ""}`} aria-label="Buka menu consolidate picking" aria-current={activeView === "consolidate" ? "page" : undefined} onClick={() => setActiveView("consolidate")}><span>◇</span><b>Consolidate picking</b></button>}
          {authReady && (authUser.role === "DEVELOPER" || authUser.role === "STAGING_HELPER") && <button className={`nav-menu-item ${activeView === "staging-tasks" ? "active" : ""}`} aria-label="Buka menu staging helper" aria-current={activeView === "staging-tasks" ? "page" : undefined} onClick={() => { setHelperRole("STAGING_HELPER"); setSelectedHelperSo(""); setActiveView("staging-tasks"); }}><span>▣</span><b>Staging helper</b></button>}
          {authReady && (authUser.role === "DEVELOPER" || authUser.role === "LINE_HELPER") && <button className={`nav-menu-item ${activeView === "line-tasks" ? "active" : ""}`} aria-label="Buka menu line checker" aria-current={activeView === "line-tasks" ? "page" : undefined} onClick={() => { setHelperRole("LINE_HELPER"); setSelectedHelperSo(""); setActiveView("line-tasks"); }}><span>▤</span><b>Line checker</b></button>}
          {authReady && authUser.role === "DEVELOPER" && <button className={`nav-menu-item ${activeView === "developer" ? "active" : ""}`} aria-label="Buka menu developer" aria-current={activeView === "developer" ? "page" : undefined} onClick={() => { setActiveView("developer"); void refreshDeveloper(); }}><span>⚙</span><b>Developer</b></button>}
        </nav>
        <div className="sidebar-user"><strong>{authUser.name}</strong><span>{authUser.staffId} · {authUser.role.replaceAll("_", " ")}</span><button onClick={() => void logout()}>Keluar</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">CBT · OUTBOUND ORCHESTRATION</p>
            <h1>ONE WAVE <span>ONE ROUTE</span></h1>
          </div>
          <div className="top-actions">
            <div className="source-state" data-status={sourceStatus}>
              <i />
              <div>
                <strong>{sourceStatus === "live" ? "Live Supabase snapshot" : sourceStatus === "stale" ? "Last valid snapshot" : sourceStatus === "loading" ? "Connecting live data" : "Backend unavailable"}</strong>
                <span title={sourceMessage}>{sourceStatus === "live" || sourceStatus === "stale" ? `${formatSyncTime(lastSyncedAt)}${sourceMessage ? ` · ${sourceMessage}` : ""}` : sourceStatus === "loading" ? "checking compact snapshot..." : "operational action ditahan"}</span>
              </div>
            </div>
            <button className="soft-button" onClick={() => { setSourceStatus("loading"); void refreshLiveData(); flash("Memeriksa snapshot live terbaru"); }}>↻ Refresh</button>
            {activeView === "assignment" && <button className="primary-button" onClick={() => { setGenerated(true); flash(Object.keys(manualOverrides).length ? "Auto-assignment diperbarui, manual lock tetap aman" : "Assignment berhasil dihitung ulang"); }}>Generate assignment</button>}
            {(activeView === "staging-tasks" || activeView === "line-tasks") && <span className="pilot-badge">SUPABASE LIVE</span>}
            {activeView === "consolidate" && <span className="pilot-badge">SRA PILOT</span>}
          </div>
        </header>

        <div className="workspace-view" data-workspace-view={activeView}>
        {activeView === "developer" && authUser.role === "DEVELOPER" && (
        <section className="developer-workspace">
          <div className="developer-titlebar">
            <div><p className="eyebrow">SYSTEM ADMINISTRATION</p><h2>Developer control center</h2><p>Konfigurasi koneksi backend dan akses pengguna OWOR dari satu menu terproteksi.</p></div>
            <button className="soft-button" disabled={developerLoading} onClick={() => void refreshDeveloper()}>↻ Refresh status</button>
          </div>

          <div className="developer-grid">
            <section className="developer-panel panel">
              <div className="developer-panel-head"><span>01</span><div><h3>Backend setup</h3><p>Superset → Edge Function → Supabase → static OWOR</p></div><i className={developerStatus?.configured ? "ok" : "warn"}>{developerStatus?.configured ? "CONFIGURED" : "NOT READY"}</i></div>
              <div className="backend-health-grid">
                <article><span>SUPABASE API</span><strong>{developerStatus?.configured ? "Connected" : "Missing"}</strong><small>Browser hanya memakai publishable key + RLS</small></article>
                <article><span>SYNC HEALTH</span><strong>{developerStatus?.latestRuns?.[0]?.status === "success" ? "Healthy" : developerStatus?.latestRuns?.[0]?.status || "Checking"}</strong><small>{developerStatus?.latestRuns?.[0] ? `${developerStatus.latestRuns[0].source} · ${number(developerStatus.latestRuns[0].written_rows)} rows` : developerStatus?.accountError || "Menunggu status backend"}</small></article>
                <article><span>LAST SNAPSHOT</span><strong>{developerStatus?.snapshotHeads?.find((head) => head.source === "orders")?.generated_at ? formatSyncTime(developerStatus.snapshotHeads.find((head) => head.source === "orders")!.generated_at) : "–"}</strong><small>{number(developerStatus?.snapshotHeads?.find((head) => head.source === "orders")?.row_count || 0)} SO · {number(developerStatus?.snapshotHeads?.find((head) => head.source === "pickers")?.row_count || 0)} picker</small></article>
                <article><span>AUTH & TASK STORE</span><strong>{developerStatus?.accountStore ? "Ready" : "Not ready"}</strong><small>{developerStatus?.accountStore ? `Supabase Auth + RLS · ${number(developerStatus.helperTaskCount || 0)} helper task` : "Jalankan migration package Supabase"}</small></article>
              </div>
              <div className="backend-actions"><button className="primary-button" disabled={developerLoading || !developerStatus?.configured} onClick={() => void runBackendSync()}>Run sync now</button><p>Cookie Superset dan sync secret hanya berada di Supabase Secrets. Browser tidak pernah menerima nilainya.</p></div>
              {!developerStatus?.accountStore && <div className="developer-warning"><b>Setup backend akun belum selesai</b><span>Jalankan migration package Supabase, deploy Edge Function OWOR, lalu buat akun developer bootstrap.</span></div>}
            </section>

            <section className="developer-panel panel">
              <div className="developer-panel-head"><span>02</span><div><h3>Staff accounts & roles</h3><p>Akun helper hanya mendapat menu Helper Task.</p></div><i className={developerStatus?.accountStore ? "ok" : "warn"}>{staffAccounts.length} USERS</i></div>
              <div className="staff-account-form">
                <label><span>Staff ID / username</span><input value={staffForm.staffId} onChange={(event) => setStaffForm((current) => ({ ...current, staffId: event.target.value.toUpperCase() }))} placeholder="Contoh: 52016" /></label>
                <label><span>Nama staff</span><input value={staffForm.name} onChange={(event) => setStaffForm((current) => ({ ...current, name: event.target.value }))} placeholder="Nama lengkap" /></label>
                <label><span>Role akses</span><select value={staffForm.role} onChange={(event) => setStaffForm((current) => ({ ...current, role: event.target.value as UserRole }))}><option value="STAGING_HELPER">Staging Helper</option><option value="LINE_HELPER">Line Checker Helper</option><option value="CONSOLIDATE_PICKER">Consolidate Picker</option><option value="CONSOLIDATOR">Consolidator</option><option value="DEVELOPER">Developer</option></select></label>
                <label><span>Password awal</span><input type="password" autoComplete="new-password" value={staffForm.password} onChange={(event) => setStaffForm((current) => ({ ...current, password: event.target.value }))} placeholder="Minimal 8 karakter" /></label>
                <button className="primary-button" disabled={developerLoading || !developerStatus?.accountStore} onClick={() => void createStaffAccount()}>Create / reset account</button>
              </div>
              <div className="role-explainer"><span><b>STAGING HELPER</b> Scan SO dan staging picking</span><span><b>LINE HELPER</b> Staging ke checker line</span><span><b>CONSOLIDATE PICKER</b> Picking lintas SO</span><span><b>CONSOLIDATOR</b> Pisahkan barang per SO</span><span><b>DEVELOPER</b> Semua menu + settings</span></div>
              {!staffAccounts.length ? <div className="empty-state"><strong>Belum ada akun staff di backend</strong><span>Akun developer environment tetap aktif sebagai bootstrap.</span></div> : <div className="staff-account-list">{staffAccounts.map((account) => <article key={account.staffId} data-active={account.active}><div className="staff-avatar">{account.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div><span><strong>{account.name}</strong><small>{account.staffId} · {account.role.replaceAll("_", " ")}</small></span><em>{account.active ? "ACTIVE" : "DISABLED"}</em><button disabled={developerLoading || account.staffId === authUser.staffId} onClick={() => void setStaffAccountActive(account)}>{account.active ? "Disable" : "Enable"}</button></article>)}</div>}
            </section>

            <section className="developer-panel developer-danger-panel panel">
              <div className="developer-panel-head"><span>03</span><div><h3>Consolidate task controls</h3><p>Kontrol recovery untuk task batch picking trial SRA L2+</p></div><i className="warn">DEVELOPER ONLY</i></div>
              <div className="developer-danger-actions"><div><strong>Reset all consolidate tasks</strong><p>Menghapus seluruh Picking Task, progress rack/SKU, dan Consolidation Task pada scope SRA L2+. Snapshot SO tidak dihapus sehingga task baru dapat digenerate kembali.</p></div><button disabled={developerLoading} onClick={() => void resetAllConsolidateTasks()}>{developerLoading ? "Processing…" : "Reset all tasks"}</button></div>
            </section>
          </div>
        </section>
        )}

        {activeView === "so-master" && authUser.role === "DEVELOPER" && <SoMasterView />}

        {activeView === "consolidate" && <ConsolidatePickingView user={authUser} />}

        {activeView === "assignment" && <>
        <section className="hero-grid">
          <div className="hero-copy">
            <div className="status-line"><span>WAVE 1</span><span>10 HUB</span><span>TRIAL V1</span></div>
            <h2>Turn route volume into<br /><em>ready-to-upload</em> assignments.</h2>
            <p>Demand per zone, manpower capacity, and whole-SO balancing in one operational view.</p>
          </div>
          <div className="hero-metrics">
            <article><span>Total request</span><strong>{number(totals.qty)}</strong><small>qty · {number(totals.sku)} SKU</small></article>
            <article><span>Candidate SO</span><strong>{number(totals.so)}</strong><small>10 hub · NEW</small></article>
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
                const locked = ordersData.filter(
                  (order) => order.route === route.code && manualOverrides[order.soNumber],
                ).length;
                return (
                  <button
                    key={route.code}
                    className={manualRoute === route.code ? "active" : ""}
                    onClick={() => openManualRoute(route.code)}
                  >
                    {route.code}<span>{locked}/{ordersData.filter((order) => order.route === route.code).length}</span>
                  </button>
                );
              })}
            </div>
            <div className="assignment-mode-tabs" aria-label="Assignment grouping mode">
              <button className={assignmentMode === "route" ? "active" : ""} onClick={() => selectAssignmentMode("route")}>Assign by route</button>
              <button className={assignmentMode === "zone" ? "active" : ""} onClick={() => selectAssignmentMode("zone")}>Assign by zone</button>
            </div>
          </div>

          {assignmentMode === "zone" && (
            <div className="zone-selector" aria-label="Pilih zone assignment">
              <div>
                <p className="eyebrow">PILIH ZONE LINTAS ROUTE</p>
                <h4>{selectedZone === "ALL" ? "Semua zone" : zoneOptions.find((item) => normalizedZone(item.zone) === selectedZone)?.zone}</h4>
                <span>SO ditampilkan berdasarkan zone tanpa peduli route tujuan</span>
              </div>
              <div className="zone-selector-list">
                <button
                  className={selectedZone === "ALL" ? "active" : ""}
                  onClick={() => { setSelectedZone("ALL"); setSelectedOrders([]); setShowAllPickers(false); }}
                >
                  <strong>Semua zone</strong>
                  <span>{ordersData.length} SO</span>
                  <span className="zone-card-capacity">{number(zoneOptionTotals.qty)} QTY · {zoneOptionTotals.mpRequired} MP</span>
                </button>
                {zoneOptions.map((item) => {
                  const value = normalizedZone(item.zone);
                  return (
                    <button
                      className={selectedZone === value ? "active" : ""}
                      key={value}
                      onClick={() => { setSelectedZone(value); setSelectedOrders([]); setShowAllPickers(false); }}
                    >
                      <strong>{item.zone}</strong>
                      <span>{item.so} SO · {item.routes.size} route</span>
                      <span className="zone-card-capacity">{number(item.qty)} QTY · {item.mpRequired} MP</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="manual-command">
            <div>
              <p className="eyebrow">{assignmentMode === "zone" ? "ACTIVE ZONE" : "ACTIVE ROUTE"}</p>
              <h4>{assignmentMode === "zone" ? (selectedZone === "ALL" ? "Semua zone" : zoneOptions.find((item) => normalizedZone(item.zone) === selectedZone)?.zone) : manualRoute}</h4>
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
                <div><p className="eyebrow">PICKER ROSTER</p><h4>Select manpower manually</h4><span>{eligiblePickers.length} zone match dari {pickerRoster.length} picker · {sourceStatus === "live" || sourceStatus === "stale" ? "schedule snapshot hari ini" : "fallback snapshot"}</span></div>
                <button onClick={() => setShowPickerPool(false)} aria-label="Tutup picker pool">×</button>
              </div>

              <div className="picker-zone-filter" aria-label="Filter picker berdasarkan zona">
                <div>
                  <strong>Target zone</strong>
                  <span>{[...targetPickerZones].join(", ") || "Belum ada SO"}</span>
                </div>
                <div className="picker-zone-toggle">
                  <button className={!showAllPickers ? "active" : ""} onClick={() => setShowAllPickers(false)}>Zone match ({eligiblePickers.length})</button>
                  <button className={showAllPickers ? "active" : ""} onClick={() => setShowAllPickers(true)}>Semua picker ({searchedPickers.length})</button>
                </div>
              </div>

              <div className="picker-entry-tools">
                <label>
                  <span>Search roster</span>
                  <input aria-label="Cari picker dari roster" placeholder="Nama, Staff ID, atau zona..." value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} />
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
                    const picker = pickerRoster.find((item) => item.staffId === staffId);
                    return <button key={staffId} onClick={() => togglePicker(staffId)} title="Hapus dari pilihan"><span>{picker?.name ?? "Manual ID"}</span><b>{staffId}</b><i>×</i></button>;
                  }) : <em>Belum ada picker dipilih</em>}
                </div>
                {selectedPickerIds.length > 0 && <button className="clear-picker-selection" onClick={() => setSelectedPickerIds([])}>Clear all</button>}
              </div>

              <div className="picker-list-head">
                <span>Roster match</span><span>Home zone</span><span>Target prod</span><span>Select</span>
              </div>
              <div className="picker-list">
                {!filteredPickers.length && (
                  <div className="picker-empty">
                    <strong>Tidak ada picker yang cocok dengan zone SO ini</strong>
                    <span>Cek nilai kolom H Schedule Manpower atau tampilkan seluruh roster secara manual.</span>
                    {!showAllPickers && <button onClick={() => setShowAllPickers(true)}>Tampilkan semua picker</button>}
                  </div>
                )}
                {filteredPickers.map((picker) => {
                  const selected = selectedPickerIds.includes(picker.staffId);
                  const relevant = pickerMatchesAnyZone(picker.zone, targetPickerZones);
                  return (
                    <button className={selected ? "selected" : ""} key={picker.staffId} onClick={() => togglePicker(picker.staffId)}>
                      <span className="picker-list-person"><i>{picker.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</i><span><strong>{picker.name}</strong><small>{picker.staffId}</small></span></span>
                      <span><strong>{picker.zone}</strong><small>{relevant ? `Match · ${formatPickerCoverage(picker.zone)}` : formatPickerCoverage(picker.zone)}</small></span>
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
                  aria-label={assignmentMode === "zone" ? `Pilih semua SO zone ${selectedZone}` : `Pilih semua SO route ${manualRoute}`}
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
                flash(`Manual lock ${assignmentMode === "zone" ? "zone" : "route"} dibersihkan`);
              }}
            >Clear {assignmentMode === "zone" ? "zone" : "route"} locks</button>
          </div>
        </section>

        </>}
        {activeView === "monitor" && (
        <section className="monitor-section panel" id="picking-monitor">
          <div className="monitor-head">
            <div className="panel-head"><div><span>04</span><div><h3>Live picking monitor</h3><p>Aktivitas aktual WMS untuk SO One Wave One Route · picking refresh sekitar 30 menit</p></div></div></div>
            <div className="monitor-tools">
              <div className="monitor-tabs" aria-label="Filter status picking">
                {(["IN_PROGRESS", "WAITING", "COMPLETED", "ALL"] as const).map((status) => (
                  <button key={status} className={monitorStatus === status ? "active" : ""} onClick={() => setMonitorStatus(status)}>{status === "IN_PROGRESS" ? "In progress" : status === "ALL" ? "All" : status.toLowerCase()}</button>
                ))}
              </div>
              <input aria-label="Cari monitoring picking" placeholder="Cari picker, SO, zone, route..." value={monitorSearch} onChange={(event) => setMonitorSearch(event.target.value)} />
            </div>
          </div>
          <div className="monitor-kpis">
            <article><span>Active picker</span><strong>{number(pickingTotals.activePickers)}</strong><small>sedang picking</small></article>
            <article><span>SO in progress</span><strong>{number(pickingTotals.activeSo)}</strong><small>belum selesai</small></article>
            <article><span>SO completed</span><strong>{number(pickingTotals.completedSo)}</strong><small>hari ini</small></article>
            <article><span>Picked qty</span><strong>{number(pickingTotals.pickedQty)}</strong><small>of {number(pickingTotals.requestQty)} request</small></article>
          </div>
          {!livePicking.length ? (
            <div className="empty-state"><strong>Snapshot picking belum tersedia</strong><span>Backend assignment tetap aktif. Monitoring muncul setelah resource OWOR PICKING MONITOR tersinkron.</span></div>
          ) : !pickingMonitor.length ? (
            <div className="empty-state"><strong>Tidak ada aktivitas pada filter ini</strong><span>Coba pilih status lain atau kosongkan pencarian.</span></div>
          ) : (
            <div className="monitor-list">
              {pickingMonitor.map((picker) => {
                const key = picker.pickerId || `UNASSIGNED::${picker.pickerName}`;
                const open = expandedPicker === key;
                return (
                  <article className="monitor-picker" key={key} data-open={open}>
                    <button className="monitor-picker-summary" onClick={() => setExpandedPicker(open ? "" : key)} aria-expanded={open}>
                      <span className="picker-avatar">{picker.pickerName.split(" ").slice(0, 2).map((part) => part[0]).join("") || "?"}</span>
                      <span className="monitor-picker-name"><strong>{picker.pickerName}</strong><small>{picker.pickerId || "belum ada picker ID"} · {[...picker.zones].join(", ")}</small></span>
                      <span><strong>{picker.activities.length}</strong><small>SO shown</small></span>
                      <span><strong>{number(picker.remainingQty)}</strong><small>remaining qty</small></span>
                      <span className="monitor-progress"><i><em style={{ width: `${picker.completionPct}%` }} /></i><small>{picker.completionPct}% picked</small></span>
                      <b>{open ? "−" : "+"}</b>
                    </button>
                    {open && (
                      <div className="monitor-detail">
                        <div className="monitor-detail-label"><span>SO / destination</span><span>Zone / route</span><span>Progress</span><span>Timing</span><span>Status</span></div>
                        {picker.activities.map((activity) => (
                          <div className="monitor-so" key={`${activity.soNumber}-${activity.zone}-${activity.pickerId}`}>
                            <span><strong>{extractWmsSoId(activity.soNumber)}</strong><small>{activity.destination} · {activity.sku} SKU</small></span>
                            <span><strong>{activity.zone}</strong><small>{activity.route}</small></span>
                            <span className="monitor-so-progress"><strong>{number(activity.pickedQty)} / {number(activity.requestQty)}</strong><i><em style={{ width: `${activity.completionPct}%` }} /></i><small>{number(activity.remainingQty)} remaining</small></span>
                            <span><strong>{formatClock(activity.pickingStartAt)} → {formatClock(activity.pickingEndAt)}</strong><small>start → end</small></span>
                            <span><em className={`status-chip ${activity.status.toLowerCase()}`}>{activity.status.replace("_", " ")}</em><small>{activity.rawStatus || "WMS"}</small></span>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
        )}

        {(activeView === "staging-tasks" || activeView === "line-tasks") && (
        <section className="helper-workspace" id="helper-task">
          <div className="helper-hero">
            <div>
              <p className="eyebrow">CBT WMS · MOBILE OPERATIONS</p>
              <h2>Helper movement control</h2>
              <p>Dua proses terpisah: barang masuk staging picking, lalu dipindahkan ke checker line.</p>
            </div>
            <div className="helper-session-card">
              <span>LOGGED IN</span>
              <strong>{authUser.name}</strong>
              <small>{authUser.staffId} · {authUser.role.replaceAll("_", " ")}</small>
              <button onClick={() => void logout()}>Keluar</button>
            </div>
          </div>

          <div className="helper-process-banner"><span>{helperRole === "STAGING_HELPER" ? "01" : "02"}</span><div><strong>{helperRole === "STAGING_HELPER" ? "Staging Helper Task" : "Line Checker Task"}</strong><small>{helperRole === "STAGING_HELPER" ? "SO → staging picking" : "Staging picking → checker line"}</small></div></div>

          <div className="helper-kpis" aria-label="Ringkasan helper task">
            <article><span>Sedang dibawa</span><strong>{number(helperTaskTotals.active)}</strong><small>task aktif</small></article>
            <article><span>Di staging</span><strong>{number(helperTaskTotals.staged)}</strong><small>siap line helper</small></article>
            <article><span>Line diketahui</span><strong>{number(helperTaskTotals.located)}</strong><small>staging packer</small></article>
          </div>

          {helperRole === "STAGING_HELPER" && (
            <section className="helper-lookup panel">
              <div><span>SCAN / INPUT SO</span><h3>Pilih SO yang akan dikerjakan</h3><p>Daftar completed picking tidak ditampilkan. Helper memulai task dari SO yang dipilih sendiri.</p></div>
              <div className="helper-lookup-control">
                <input
                  aria-label="Scan atau cari SO untuk helper staging"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="helper-iwir-suggestions"
                  aria-expanded={helperSuggestionsOpen && helperSuggestionOrders.length > 0}
                  value={helperSearch}
                  onFocus={() => setHelperSuggestionsOpen(true)}
                  onBlur={() => setHelperSuggestionsOpen(false)}
                  onChange={(event) => { setHelperSearch(event.target.value); setHelperSuggestionsOpen(true); }}
                  onKeyDown={(event) => { if (event.key === "Enter") void startStagingTask(); }}
                  placeholder="Scan barcode atau cari SO IWIR"
                />
                <button onClick={startStagingTask} disabled={!helperLookupOrder}>Mulai task</button>
                {helperSuggestionsOpen && helperSuggestionOrders.length > 0 && (
                  <div id="helper-iwir-suggestions" className="helper-suggestion-list" role="listbox" aria-label="Daftar SO IWIR aktif">
                    <div className="helper-suggestion-head"><b>{helperSuggestionOrders.length} SO IWIR</b><span>{helperSearch ? "sesuai pencarian" : `dari ${activeHelperCandidates.length} aktif`} · completed disembunyikan</span></div>
                    {helperSuggestionOrders.map((order) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={helperLookupOrder?.soNumber === order.soNumber}
                        key={order.soNumber}
                        onMouseDown={(event) => { event.preventDefault(); chooseHelperSuggestion(order); }}
                      >
                        <span><strong>{extractWmsSoId(order.soNumber)}</strong><small>{order.destination} · {order.route}</small></span>
                        <span><b>{order.zone}</b><small>{number(order.qty)} qty · {order.sku} SKU</small></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {helperSearch && (
                <div className={`helper-lookup-result ${helperLookupOrder ? "found" : "missing"}`}>
                  {helperLookupOrder
                    ? <><b>SO {extractWmsSoId(helperLookupOrder.soNumber)} dipilih</b><span>{helperLookupOrder.destination} · {helperLookupOrder.zone} · {number(helperLookupOrder.qty)} qty · {helperLookupOrder.sku} SKU</span></>
                    : helperSuggestionOrders.length
                      ? <><b>{helperSuggestionOrders.length} kandidat IWIR ditemukan</b><span>Pilih salah satu SO dari dropdown untuk mengaktifkan tombol Mulai Task.</span></>
                      : <><b>SO belum ditemukan</b><span>SO completed tidak ditampilkan. Periksa nomor atau tunggu snapshot berikutnya.</span></>}
                </div>
              )}
            </section>
          )}

          <div className="helper-layout">
            <section className="helper-queue panel">
              <div className="helper-panel-head">
                <div><span>ACTIVE</span><div><h3>{helperRole === "STAGING_HELPER" ? "SO yang sedang gue kerjakan" : "Queue dari staging picking"}</h3><p>{helperRole === "STAGING_HELPER" ? "Hanya task yang dipilih akun ini." : "Hanya SO yang sudah ditempatkan staging helper."}</p></div></div>
              </div>
              {!helperBoard.length ? (
                <div className="empty-state"><strong>Belum ada task aktif</strong><span>{helperRole === "STAGING_HELPER" ? "Scan SO di atas untuk memulai." : "Task muncul setelah staging helper scan lokasi staging."}</span></div>
              ) : (
                <div className="helper-task-list">
                  {helperBoard.map(({ order, task }) => {
                    return (
                      <button key={order.soNumber} className={selectedHelperSo === order.soNumber ? "active" : ""} onClick={() => selectHelperTask(order.soNumber)}>
                        <span className="helper-task-route"><b>{order.destination}</b><small>{order.route}</small></span>
                        <span><strong>{extractWmsSoId(order.soNumber)}</strong><small>{order.zone} · {number(order.qty)} qty · {order.sku} SKU</small></span>
                        <span className="helper-position"><b>{getLoadPosition(order.route, order.destination)}</b><small>load position</small></span>
                        <span className={`helper-status ${task.status.toLowerCase()}`}><b>{helperStatusLabel(task.status)}</b><small>{task.packingLine || task.staging || task.lineHelperId || task.stagingHelperId}</small></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <aside className="helper-scanner panel">
              {!selectedHelperOrder ? (
                <div className="helper-scan-empty"><span>▦</span><strong>Pilih card SO</strong><p>Detail isi SO dan scanner proses tampil di sini.</p></div>
              ) : (
                <>
                  <div className="helper-active-task">
                    <div><span>ACTIVE SO</span><strong>{extractWmsSoId(selectedHelperOrder.soNumber)}</strong><small>{selectedHelperOrder.soNumber}</small></div>
                    <b>{getLoadPosition(selectedHelperOrder.route, selectedHelperOrder.destination)}</b>
                  </div>
                  <dl className="helper-task-meta">
                    <div><dt>Destination</dt><dd>{selectedHelperOrder.destination}</dd></div>
                    <div><dt>Route</dt><dd>{selectedHelperOrder.route}</dd></div>
                    <div><dt>Zone</dt><dd>{selectedHelperOrder.zone}</dd></div>
                    <div><dt>Status</dt><dd>{helperStatusLabel(selectedHelperStatus)}</dd></div>
                  </dl>

                  <div className="helper-item-summary">
                    <div><span>REQUEST QTY</span><strong>{number(selectedHelperOrder.qty)}</strong></div>
                    <div><span>UNIQUE SKU</span><strong>{number(selectedHelperOrder.sku)}</strong></div>
                    <div><span>PICKED QTY</span><strong>{number(selectedHelperPicking?.pickedQty ?? 0)}</strong></div>
                    <p>Detail V1 memakai ringkasan SO live. Baris SKU akan dimuat on-demand setelah endpoint detail Superset diaktifkan.</p>
                  </div>

                  {helperRole === "LINE_HELPER" && selectedHelperStatus === "STAGED_PICKING" ? (
                    <div className="helper-claim-card">
                      <span>STEP 1</span>
                      <h3>Ambil dari staging</h3>
                      <p>SO berada di <strong>{selectedHelperTask?.staging}</strong>. Task akan ditandai untuk {authUser.name}.</p>
                      <button className="primary-button" onClick={claimLineTask}>Ambil task ke checker line</button>
                    </div>
                  ) : selectedHelperStatus === "CLAIMED_STAGING" || selectedHelperStatus === "CLAIMED_LINE" ? (
                    <div className="helper-scan-flow">
                      <div className="helper-step-line">
                        <span className="done">1</span><i />
                        <span className="active">2</span><i />
                        <span>3</span>
                      </div>
                      <div className="helper-instruction">
                        <span>{helperVerificationPhase === "STAGING" ? "STAGING PICKING" : "CHECKER LINE"}</span>
                        <h3>{helperVerificationPhase === "STAGING" ? "Verifikasi SO dan scan staging" : "Verifikasi SO dan scan line"}</h3>
                        <p>{helperVerificationPhase === "STAGING" ? "Pilih staging Mezzanine atau SPR sesuai area barang." : "Scan barcode line checker tujuan."}</p>
                      </div>

                      <label className="helper-scan-field">
                        <span>1 · Scan barcode SO</span>
                        <div><input autoComplete="off" aria-label="Scan barcode SO helper task" value={helperSoScan} onChange={(event) => setHelperSoScan(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") verifyHelperSo(); }} placeholder={`Scan ${extractWmsSoId(selectedHelperOrder.soNumber)}`} /><button type="button" className="camera-scan-button" aria-label="Buka kamera scan barcode SO" onClick={() => openCamera("SO")}>Kamera</button><button type="button" onClick={verifyHelperSo}>Verify</button></div>
                        <small className={verifiedHelperStep === helperVerificationKey ? "verified" : ""}>{verifiedHelperStep === helperVerificationKey ? "✓ SO cocok dan siap scan lokasi" : "Menerima nomor SO penuh atau 7 digit SO ID"}</small>
                      </label>

                      <label className="helper-scan-field">
                        <span>2 · {helperVerificationPhase === "STAGING" ? "Scan staging picking" : "Scan checker line"}</span>
                        <div><input autoComplete="off" aria-label="Scan lokasi helper task" value={helperLocationScan} onChange={(event) => setHelperLocationScan(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitHelperLocation(); }} placeholder={helperVerificationPhase === "STAGING" ? "STG-MEZZANINE / STG-SPR" : "Contoh LINE-01"} /><button type="button" className="camera-scan-button" aria-label="Buka kamera scan lokasi" onClick={() => openCamera("LOCATION")}>Kamera</button><button type="button" onClick={submitHelperLocation}>Simpan</button></div>
                        {helperVerificationPhase === "STAGING" && <div className="staging-shortcuts">{STAGING_BARCODES.map((barcode) => <button key={barcode} onClick={() => setHelperLocationScan(barcode)}>{barcode}</button>)}</div>}
                      </label>
                      {cameraTarget && (
                        <section className="mobile-barcode-camera" aria-label={cameraTarget === "SO" ? "Kamera barcode SO" : "Kamera barcode lokasi"}>
                          <div className="mobile-barcode-camera-head">
                            <div><span>CAMERA SCANNER</span><strong>{cameraTarget === "SO" ? "Scan barcode SO" : "Scan lokasi checker / staging"}</strong></div>
                            <button type="button" aria-label="Tutup kamera" onClick={stopCamera}>Tutup</button>
                          </div>
                          <div className="mobile-barcode-camera-preview"><video ref={cameraVideoRef} autoPlay muted playsInline /><i aria-hidden="true" /></div>
                          <p>{cameraMessage}</p>
                        </section>
                      )}
                    </div>
                  ) : (
                    <div className="helper-current-location">
                      <span>POSISI TERKINI</span>
                      <strong>{selectedHelperTask?.packingLine || selectedHelperTask?.staging || "Belum tercatat"}</strong>
                      <small>{selectedHelperTask?.updatedAt ? formatSyncTime(selectedHelperTask.updatedAt) : "baru diperbarui"}</small>
                    </div>
                  )}
                </>
              )}
            </aside>
          </div>
          <div className="pilot-note"><b>Device pilot:</b> login sudah server-side. State task masih tersimpan di perangkat ini sampai database task Supabase dihubungkan untuk sinkron lintas HP/SEUIC.</div>
        </section>
        )}

        {activeView === "assignment" && (
        <section className="assignment-section panel">
          <div className="assignment-head">
            <div className="panel-head"><div><span>05</span><div><h3>Assignment preview</h3><p>{assignmentMode === "zone" ? "Cross-route balancing by zone" : "Balanced by route and picker capacity"} · manual locks take priority</p></div></div></div>
            <div className="assignment-tools">
              <input aria-label="Cari assignment" placeholder="Search picker, zone, SO..." value={search} onChange={(event) => setSearch(event.target.value)} />
              <button
                className="soft-button locked-download"
                disabled={!lockedSoCount}
                onClick={() => downloadLockedCsv(assignments, activeRoute === "ALL" ? undefined : activeRoute)}
              >
                ↓ Download manual locked CSV ({lockedSoCount})
              </button>
            </div>
          </div>
          {!assignments.length ? (
            <div className="empty-state"><strong>Assignment belum dibuat</strong><span>Klik Generate assignment untuk membagi candidate SO.</span></div>
          ) : (
            <div className="assignment-zone-list">
              {assignmentsByZone.map((group, zoneIndex) => {
                const expanded = expandedAssignmentZone === group.key || Boolean(search.trim());
                return (
                  <section className="assignment-zone-group" key={group.key}>
                    <button
                      className="assignment-zone-toggle"
                      aria-expanded={expanded}
                      aria-controls={`assignment-zone-${group.key}`}
                      onClick={() => setExpandedAssignmentZone(expandedAssignmentZone === group.key ? "" : group.key)}
                    >
                      <span className="assignment-zone-number">{String(zoneIndex + 1).padStart(2, "0")}</span>
                      <div><small>PICKING ZONE</small><strong>{group.zone}</strong><em>{group.routes.join(" · ")}</em></div>
                      <div><small>TOTAL LOAD</small><strong>{number(group.qty)}</strong><em>{group.so} SO</em></div>
                      <div><small>MANPOWER</small><strong>{group.pickerCount} MP</strong><em>{group.manualCount ? `${group.manualCount} manual lock` : "auto balanced"}</em></div>
                      <b>{expanded ? "Tutup MP ↑" : "Lihat MP ↓"}</b>
                    </button>
                    {expanded && (
                      <div className="assignment-list" id={`assignment-zone-${group.key}`}>
                        {group.items.map((assignment, index) => {
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
                  </section>
                );
              })}
            </div>
          )}
          <div className="assignment-footer">
            <div><span className="safe-dot" /> All rows have valid <code>so_id</code> + <code>staff_id</code> · {Object.keys(manualOverrides).length} manual locks</div>
            <div className="footer-actions"><button onClick={() => { setGenerated(false); setManualOverrides({}); setSelectedOrders([]); flash("Semua assignment direset"); }}>Reset all</button></div>
          </div>
        </section>
        )}
        </div>
      </section>

      {showRules && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowRules(false); }}>
          <section className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
            <button className="modal-close" onClick={() => setShowRules(false)} aria-label="Tutup">×</button>
            <p className="eyebrow">V1 CALCULATION CONTRACT</p>
            <h2 id="rules-title">Assignment rules</h2>
            <div className="rule-block"><span>1</span><div><strong>Eligibility</strong><p>SO status NEW dan destination termasuk SWL / PSG / CSA / KLD / BSX / CPT / PPL / RDS / SLP / JLB.</p></div></div>
            <div className="rule-block"><span>2</span><div><strong>Manpower need</strong><p><code>CEILING(zone request qty / productivity per MP zone)</code></p></div></div>
            <div className="rule-block"><span>3</span><div><strong>Picker roster</strong><p>Job Title = Picker, schedule aktif pada operational date, staff ID valid, bukan OFF DAY/cuti/izin.</p></div></div>
            <div className="rule-block"><span>4</span><div><strong>WMS output</strong><p><code>error_message;so_id;staff_id</code> · satu SO hanya memiliki satu staff ID.</p></div></div>
            <div className="rule-block"><span>5</span><div><strong>Atomic zone</strong><p>Zone berasal dari <code>origin_rack_name</code>. SO dengan lebih dari satu zone masuk <code>ZONE_CONFLICT</code> dan tidak ikut auto-assignment.</p></div></div>
            <h3>Zone productivity draft</h3>
            <div className="rule-grid">{ZONE_RULES.map((rule) => <div key={rule.zone}><span>{rule.zone}</span><strong>{number(rule.productivity)}</strong><small>qty / MP</small></div>)}</div>
            <div className="modal-note">Nilai V1 saat ini — verifikasi bersama operation sebelum bulk export final.</div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}
