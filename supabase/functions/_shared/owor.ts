export const OWOR_DESTINATIONS = ["SWL", "PSG", "CSA", "KLD", "BSX", "CPT", "PPL", "RDS", "SLP", "JLB"] as const;

export const OWOR_ROUTES: Record<string, string> = {
  SWL: "SWL - PSG",
  PSG: "SWL - PSG",
  CSA: "CSA - KLD",
  KLD: "CSA - KLD",
  BSX: "BSX",
  CPT: "CPT - PPL",
  PPL: "CPT - PPL",
  RDS: "RDS - SLP",
  SLP: "RDS - SLP",
  JLB: "JLB",
};

export type OworOrder = {
  so_number: string;
  destination: string;
  route: string;
  zone: string;
  request_qty: number;
  sku_count: number;
};

export type OworConflict = {
  so_number: string;
  destinations: string;
  zones: string;
  request_qty: number;
  reason: "DESTINATION_CONFLICT" | "ZONE_CONFLICT" | "ZONE_UNMAPPED";
};

export type OworPicking = {
  so_number: string;
  picker_id: string;
  picker_name: string;
  destination: string;
  route: string;
  zone: string;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED";
  raw_status: string;
  request_qty: number;
  picked_qty: number;
  remaining_qty: number;
  completion_pct: number;
  sku_count: number;
  picking_start_at: string | null;
  picking_end_at: string | null;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}
function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function timestamp(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const withZone = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? `${raw.replace(" ", "T")}+07:00`
    : raw;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function operationalDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

export function normalizeOrders(rows: Record<string, unknown>[]): {
  orders: OworOrder[];
  conflicts: OworConflict[];
} {
  const bySo = new Map<string, {
    soNumber: string;
    destinations: Map<string, true>;
    zones: Map<string, number>;
    qty: number;
    sku: number;
  }>();

  for (const row of rows) {
    const soNumber = text(row.so_number);
    const destination = text(row.destination_code).toUpperCase();
    const zone = text(row.parsed_zone).toUpperCase() || "UNMAPPED";
    if (!soNumber || !OWOR_ROUTES[destination]) continue;
    const current = bySo.get(soNumber) ?? {
      soNumber,
      destinations: new Map<string, true>(),
      zones: new Map<string, number>(),
      qty: 0,
      sku: 0,
    };
    const qty = Math.max(0, number(row.request_qty));
    current.qty += qty;
    current.sku += Math.max(0, Math.trunc(number(row.sku_count)));
    current.destinations.set(destination, true);
    current.zones.set(zone, (current.zones.get(zone) ?? 0) + qty);
    bySo.set(soNumber, current);
  }

  const orders: OworOrder[] = [];
  const conflicts: OworConflict[] = [];
  for (const item of bySo.values()) {
    const destinations = [...item.destinations.keys()].sort();
    const zones = [...item.zones.keys()].sort();
    if (destinations.length !== 1 || zones.length !== 1 || zones[0] === "UNMAPPED") {
      conflicts.push({
        so_number: item.soNumber,
        destinations: destinations.join(", "),
        zones: zones.join(", "),
        request_qty: item.qty,
        reason: destinations.length !== 1
          ? "DESTINATION_CONFLICT"
          : zones.length !== 1
            ? "ZONE_CONFLICT"
            : "ZONE_UNMAPPED",
      });
      continue;
    }
    const destination = destinations[0];
    orders.push({
      so_number: item.soNumber,
      destination,
      route: OWOR_ROUTES[destination],
      zone: zones[0],
      request_qty: item.qty,
      sku_count: item.sku,
    });
  }

  orders.sort((left, right) => left.route.localeCompare(right.route) || right.request_qty - left.request_qty || left.so_number.localeCompare(right.so_number));
  conflicts.sort((left, right) => right.request_qty - left.request_qty || left.so_number.localeCompare(right.so_number));
  return { orders, conflicts };
}

export function normalizePicking(rows: Record<string, unknown>[]): OworPicking[] {
  const result = new Map<string, OworPicking>();
  for (const row of rows) {
    const soNumber = text(row.so_number);
    const destination = text(row.destination_code).toUpperCase();
    const zone = text(row.parsed_zone).toUpperCase() || "UNMAPPED";
    if (!soNumber || !OWOR_ROUTES[destination]) continue;

    const pickerId = text(row.picker_id).replace(/\.0$/, "");
    const requestQty = Math.max(0, number(row.request_qty));
    const pickedQty = Math.max(0, number(row.picked_qty));
    const startAt = timestamp(row.picking_start_at);
    const endAt = timestamp(row.picking_end_at);
    const rawStatus = text(row.so_status).toUpperCase();
    const status: OworPicking["status"] = endAt || (requestQty > 0 && pickedQty >= requestQty) || /COMPLETED|FINISHED|DONE/.test(rawStatus)
      ? "COMPLETED"
      : startAt || pickedQty > 0 || /PICKING|IN_PROGRESS|IN PROGRESS/.test(rawStatus)
        ? "IN_PROGRESS"
        : "WAITING";
    const key = `${soNumber}\u0000${pickerId}\u0000${zone}`;
    const prior = result.get(key);
    const combinedRequest = requestQty + (prior?.request_qty ?? 0);
    const combinedPicked = pickedQty + (prior?.picked_qty ?? 0);
    result.set(key, {
      so_number: soNumber,
      picker_id: pickerId,
      picker_name: text(row.picker_name) || prior?.picker_name || "Unassigned",
      destination,
      route: OWOR_ROUTES[destination],
      zone,
      status: prior?.status === "COMPLETED" || status === "COMPLETED" ? "COMPLETED" : prior?.status === "IN_PROGRESS" || status === "IN_PROGRESS" ? "IN_PROGRESS" : "WAITING",
      raw_status: rawStatus || prior?.raw_status || "",
      request_qty: combinedRequest,
      picked_qty: combinedPicked,
      remaining_qty: Math.max(0, combinedRequest - combinedPicked),
      completion_pct: combinedRequest > 0 ? Math.min(100, Math.round((combinedPicked / combinedRequest) * 100)) : 0,
      sku_count: Math.max(0, Math.trunc(number(row.sku_count))) + (prior?.sku_count ?? 0),
      picking_start_at: startAt ?? prior?.picking_start_at ?? null,
      picking_end_at: endAt ?? prior?.picking_end_at ?? null,
    });
  }

  return [...result.values()].sort((left, right) => left.status.localeCompare(right.status) || left.picker_name.localeCompare(right.picker_name) || right.request_qty - left.request_qty);
}

export async function checksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
