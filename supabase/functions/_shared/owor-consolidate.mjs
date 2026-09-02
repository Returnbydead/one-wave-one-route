const AREA_PATTERN = /^SPR\s+([A-Z])\s*(\d+)(?:-(\d+))?$/i;

export function parsePickingArea(value) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const match = raw.match(AREA_PATTERN);
  if (!match) return null;
  return {
    pickingAreaName: raw,
    zoneFamily: `SR${match[1]}`,
    floorNumber: Number(match[2]),
    subAreaNumber: match[3] ? Number(match[3]) : null,
  };
}
export function extractHubCode(destination, hubCodes) {
  const source = String(destination ?? "").trim().toUpperCase();
  const ordered = [...new Set((hubCodes ?? []).map((value) => String(value).trim().toUpperCase()).filter(Boolean))]
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  return ordered.find((code) => new RegExp(`(^|[^A-Z0-9])${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9]|$)`).test(source)) ?? "";
}
function routeConfigFor(value) {
  if (value && typeof value === "object") {
    return { waveNumber: Number(value.waveNumber ?? value.wave_number), routeCode: String(value.routeCode ?? value.route_code ?? "").trim().toUpperCase() };
  }
  return { waveNumber: Number(value), routeCode: "" };
}

export function balanceLocationsByQty(sourceRows, pickerIds) {
  const locationQty = new Map();
  for (const row of sourceRows ?? []) {
    const location = String(row?.origin_rack_name ?? "").trim().toUpperCase();
    const qty = Number(row?.request_qty ?? 0);
    if (!location || !Number.isFinite(qty) || qty <= 0) continue;
    locationQty.set(location, (locationQty.get(location) ?? 0) + qty);
  }
  const assignments = [...new Set((pickerIds ?? []).map((id) => String(id).trim().toUpperCase()).filter(Boolean))]
    .map((pickerId, index) => ({ pickerId, locations: [], totalQty: 0, index }));
  if (!assignments.length) return [];
  const locations = [...locationQty].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  for (const [location, qty] of locations) {
    const target = [...assignments].sort((left, right) => left.totalQty - right.totalQty || left.index - right.index)[0];
    target.locations.push(location);
    target.totalQty += qty;
  }
  return assignments.filter((assignment) => assignment.locations.length).map((assignment) => ({
    pickerId: assignment.pickerId, locations: assignment.locations, totalQty: assignment.totalQty,
  }));
}

export function normalizeConsolidateRows(sourceRows, routeMap, scope) {
  const hubs = Object.keys(routeMap ?? {});
  const accepted = new Map();
  const diagnostics = { sourceRows: 0, acceptedRows: 0, excludedArea: 0, excludedWave1: 0, unmappedWave: 0, invalidRows: 0 };

  for (const source of sourceRows ?? []) {
    diagnostics.sourceRows += 1;
    const soNumber = String(source.so_number ?? "").trim();
    const skuNumber = String(source.sku_number ?? "").trim();
    const area = parsePickingArea(source.picking_area_name);
    const requestQty = Number(source.request_qty ?? 0);
    if (!soNumber || !skuNumber || !area || !Number.isFinite(requestQty) || requestQty <= 0) {
      diagnostics.invalidRows += 1;
      continue;
    }
    if (area.zoneFamily !== scope.zoneFamily || area.floorNumber < scope.minLevel) {
      diagnostics.excludedArea += 1;
      continue;
    }
    const hubCode = extractHubCode(source.destination_name, hubs);
    const routeConfig = routeConfigFor(routeMap?.[hubCode]);
    const waveNumber = routeConfig.waveNumber;
    if (!hubCode || !Number.isInteger(waveNumber)) {
      diagnostics.unmappedWave += 1;
      continue;
    }
    if (waveNumber <= 1) {
      diagnostics.excludedWave1 += 1;
      continue;
    }

    const row = {
      so_number: soNumber,
      destination_name: String(source.destination_name ?? "UNKNOWN").trim() || "UNKNOWN",
      hub_code: hubCode,
      wave_number: waveNumber,
      route_code: routeConfig.routeCode,
      picking_area_name: area.pickingAreaName,
      zone_family: area.zoneFamily,
      floor_number: area.floorNumber,
      origin_rack_name: String(source.origin_rack_name ?? "UNMAPPED").trim().toUpperCase() || "UNMAPPED",
      sku_number: skuNumber,
      product_name: String(source.product_name ?? "").trim(),
      expiry_date: String(source.expiry_date ?? "").trim() || null,
      request_qty: requestQty,
    };
    const key = [row.so_number, row.hub_code, row.wave_number, row.picking_area_name, row.origin_rack_name, row.sku_number, row.expiry_date ?? ""].join("\u0000");
    const prior = accepted.get(key);
    if (prior) prior.request_qty += row.request_qty;
    else accepted.set(key, row);
  }

  const rows = [...accepted.values()].sort((left, right) =>
    left.picking_area_name.localeCompare(right.picking_area_name)
      || left.origin_rack_name.localeCompare(right.origin_rack_name)
      || left.sku_number.localeCompare(right.sku_number)
      || left.wave_number - right.wave_number
      || left.so_number.localeCompare(right.so_number));
  diagnostics.acceptedRows = rows.length;
  return { rows, diagnostics };
}
