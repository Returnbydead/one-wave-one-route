export function parseBulkStaffIds(value) {
  const matches = String(value || "").match(/\b\d{4,8}\b/g) || [];
  return [...new Set(matches)];
}

export function createInitialPassword(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 10) throw new Error("PASSWORD_ENTROPY_REQUIRED");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let random = "";
  for (const byte of bytes) random += alphabet[byte % alphabet.length];
  return `Iw!${random}`;
}

export function normalizeGeneratedPasswordPaste(value) {
  const raw = String(value ?? "");
  const trimmed = raw.trim();
  const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replaceAll('""', '"')
    : trimmed;
  return /^Iw![A-Za-z0-9]{10,}$/.test(unquoted) ? unquoted : raw;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function buildBulkCredentialCsv(rows) {
  const header = ["staff_id", "name", "password_awal", "roles"];
  const body = rows.map((row) => [row.staffId, row.name, row.password, row.roles.join(" + ")]);
  return `\uFEFF${[header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
