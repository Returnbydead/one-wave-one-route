const EXACT_COVERAGE = new Map([
  ["MZC23", ["MZC2", "MZC3"]],
  ["MZD1", ["MZD1"]],
  ["MZD2", ["MZD2"]],
  ["MZC1", ["MZC1"]],
  ["MZC2", ["MZC2"]],
  ["MZC3", ["MZC3"]],
  ["SPRC11", ["SRC1"]],
  ["SPRC21", ["SRC2"]],
  ["SPRA11", ["SRA1"]],
  ["SPRA21", ["SRA1"]],
  ["SPRB11", ["SRB1"]],
  ["SPRB21", ["SRB2"]],
]);

const PREFIX_COVERAGE = new Map([
  ["MZE", "MZE"],
  ["MZA", "MZA"],
  ["MZB", "MZB"],
  ["MZF", "MZF"],
  ["HRA", "HRA"],
  ["HRB", "HRB"],
  ["SPRC", "SRC"],
]);

/** Normalize an SO rack zone into a comparable operational code. */
export function canonicalSoZone(value = "") {
  const label = canonicalPickerLabel(value);
  const exact = EXACT_COVERAGE.get(label);
  if (exact?.length === 1) return exact[0];
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/^CBT[-_\s]*/, "")
    .replace(/^SPR\s*/, "SR")
    .replace(/[^A-Z0-9]/g, "");
}

function canonicalPickerLabel(value = "") {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/\b(PAGI|SIANG|MALAM)\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

/** Return exact codes or prefix coverage derived from the free-form GSheet zone label. */
export function pickerCoverage(value = "") {
  const label = canonicalPickerLabel(value);
  if (!label) return [];
  if (EXACT_COVERAGE.has(label)) return EXACT_COVERAGE.get(label).map((code) => ({ code, prefix: false }));
  if (PREFIX_COVERAGE.has(label)) return [{ code: PREFIX_COVERAGE.get(label), prefix: true }];

  const normalized = canonicalSoZone(value);
  return normalized ? [{ code: normalized, prefix: false }] : [];
}

export function pickerMatchesZone(pickerZone, soZone) {
  const target = canonicalSoZone(soZone);
  return pickerCoverage(pickerZone).some(({ code, prefix }) =>
    prefix ? target.startsWith(code) : target === code,
  );
}

export function pickerMatchesAnyZone(pickerZone, soZones) {
  return [...soZones].some((zone) => pickerMatchesZone(pickerZone, zone));
}

export function formatPickerCoverage(value = "") {
  const coverage = pickerCoverage(value);
  if (!coverage.length) return "Belum dipetakan";
  return coverage.map(({ code, prefix }) => `${code}${prefix ? "*" : ""}`).join(", ");
}
