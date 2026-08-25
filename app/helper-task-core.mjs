export const STAGING_BARCODES = ["STG-MEZZANINE", "STG-SPR"];

export function getLoadPosition(route, destination) {
  const hubs = String(route).split(/\s*-\s*/).filter(Boolean);
  const index = hubs.indexOf(String(destination).trim());
  if (hubs.length <= 1) return "HEAD";
  if (index <= 0) return "TAIL";
  if (index === hubs.length - 1) return "HEAD";
  return "BODY";
}

export function normalizeScan(value = "") {
  return String(value).trim().toUpperCase();
}

function activityTimeValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareActivityTimeDesc(left, right) {
  return activityTimeValue(right) - activityTimeValue(left);
}

function shortSoNumber(value) {
  return String(value ?? "").replace(/\D/g, "").slice(-7).padStart(7, "0");
}

function helperCandidateRank(order, query) {
  if (!query) return 10;
  const soNumber = normalizeScan(order.soNumber);
  const shortNumber = shortSoNumber(order.soNumber);
  if (soNumber === query || shortNumber === query) return 0;
  if (shortNumber.startsWith(query)) return 1;
  if (soNumber.includes(query)) return 2;
  if (normalizeScan(order.destination).includes(query)) return 3;
  if (normalizeScan(order.route).includes(query)) return 4;
  if (normalizeScan(order.zone).includes(query)) return 5;
  return 99;
}

export function filterHelperCandidates(orders = [], activities = [], value = "", limit = 20) {
  const query = normalizeScan(value);
  const completed = new Set(
    activities
      .filter((activity) => normalizeScan(activity.status) === "COMPLETED")
      .map((activity) => String(activity.soNumber ?? "")),
  );

  return orders
    .filter((order) => !completed.has(String(order.soNumber ?? "")))
    .map((order) => ({ order, rank: helperCandidateRank(order, query) }))
    .filter((item) => item.rank < 99)
    .sort((left, right) => left.rank - right.rank
      || Number(right.order.qty ?? 0) - Number(left.order.qty ?? 0)
      || String(left.order.soNumber).localeCompare(String(right.order.soNumber)))
    .slice(0, Math.max(1, Number(limit) || 20))
    .map((item) => item.order);
}

export function findExactHelperOrder(orders = [], value = "") {
  const query = normalizeScan(value);
  if (!query) return undefined;
  return orders.find((order) => normalizeScan(order.soNumber) === query || shortSoNumber(order.soNumber) === query);
}

export function isValidStagingBarcode(value) {
  return STAGING_BARCODES.includes(normalizeScan(value));
}

export function isValidPackingLine(value) {
  return /^(PACK(ING)?[-_ ]?)?LINE[-_ ]?[A-Z0-9]+$/.test(normalizeScan(value));
}

export function nextHelperTask(current, action) {
  const at = action.at || new Date().toISOString();
  const base = current || {
    status: "READY",
    stagingHelperId: "",
    lineHelperId: "",
    staging: "",
    packingLine: "",
    history: [],
  };

  if (action.type === "CLAIM_STAGING") {
    if (!action.helperId) throw new Error("Helper Staff ID wajib diisi");
    if (current) throw new Error("SO ini sudah masuk task helper");
    return {
      ...base,
      status: "CLAIMED_STAGING",
      stagingHelperId: action.helperId,
      updatedAt: at,
      history: [...base.history, { type: "CLAIMED_STAGING", value: action.helperId, at }],
    };
  }

  if (action.type === "SCAN_STAGING") {
    if (!base.stagingHelperId) throw new Error("Task staging harus diambil dulu");
    if (base.status !== "CLAIMED_STAGING") throw new Error("Task tidak berada di proses staging picking");
    if (!isValidStagingBarcode(action.barcode)) throw new Error("Barcode staging tidak dikenali");
    const staging = normalizeScan(action.barcode);
    return {
      ...base,
      status: "STAGED_PICKING",
      staging,
      updatedAt: at,
      history: [...base.history, { type: "STAGED_PICKING", value: staging, at }],
    };
  }

  if (action.type === "CLAIM_LINE") {
    if (!action.helperId) throw new Error("Helper Staff ID wajib diisi");
    if (base.status !== "STAGED_PICKING") throw new Error("SO belum tersedia di staging picking");
    return {
      ...base,
      status: "CLAIMED_LINE",
      lineHelperId: action.helperId,
      updatedAt: at,
      history: [...base.history, { type: "CLAIMED_LINE", value: action.helperId, at }],
    };
  }

  if (action.type === "SCAN_PACKING_LINE") {
    if (base.status !== "CLAIMED_LINE") throw new Error("Task line checker harus diambil dulu");
    if (!base.lineHelperId) throw new Error("Helper line checker belum tercatat");
    if (!isValidPackingLine(action.barcode)) throw new Error("Format packing line tidak dikenali");
    const packingLine = normalizeScan(action.barcode).replaceAll("_", "-").replaceAll(" ", "-");
    return {
      ...base,
      status: "STAGED_PACKER",
      packingLine,
      updatedAt: at,
      history: [...base.history, { type: "STAGED_PACKER", value: packingLine, at }],
    };
  }

  throw new Error("Aksi task tidak dikenali");
}
