export const KOLI_AUDIT_DATASET_ID = 323;

export const KOLI_AUDIT_COLUMNS = [
  "so_number",
  "product_sku_number",
  "product_name",
  "koli_code",
  "fsoid.status",
  "destination_id",
  "destination_location_name",
];

export function koliAuditWhere(date) {
  const compact = String(date).replaceAll("-", "");
  return `so_number LIKE 'INV/SO/${compact}/%' AND origin_id IN (819)`;
}

const clean = (value) => String(value ?? "").trim();

function hubCode(destinationName, destinationId) {
  const name = clean(destinationName).toUpperCase();
  const prefix = name.match(/^([A-Z0-9]{2,8})\s*(?:-|$)/)?.[1];
  return prefix || name || clean(destinationId).toUpperCase();
}

export function normalizeKoliAuditRow(row) {
  const destinationId = clean(row.destination_id);
  const destinationName = clean(row.destination_location_name);
  return {
    koli_code: clean(row.koli_code),
    so_number: clean(row.so_number),
    sku: clean(row.product_sku_number),
    product_name: clean(row.product_name),
    expected_qty: Number(row.request_quantity ?? 0),
    source_status: clean(row["fsoid.status"] ?? row.status),
    destination_id: destinationId,
    destination_name: destinationName,
    hub_code: hubCode(destinationName, destinationId),
  };
}

export function chunkKoliAuditRows(rows, size = 1_000) {
  if (!Number.isInteger(size) || size < 1) throw new Error("INVALID_KOLI_CHUNK_SIZE");
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}
