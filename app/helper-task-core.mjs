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
