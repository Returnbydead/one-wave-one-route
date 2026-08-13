/**
 * ONE WAVE ONE ROUTE V1 backend.
 * Superset dataset 400 -> compact Google Sheet snapshot -> JSON feed.
 */

const OWOR = Object.freeze({
  TARGET_SPREADSHEET_ID: '17IGhUxPxtHbPV8PU-gY85OStre2A2YcArEJ9n2ATUNc',
  MANPOWER_SPREADSHEET_ID: '1yc9Jf8BiVniEZC6E6p-coggZTPcnbZ796hENFdHrfAY',
  COOKIE_SPREADSHEET_ID: '1paykhTW528DVMq3o5O-8l9plXeCrilSzMtchQHoYQZE',
  COOKIE_SHEET: 'COOKIES',
  ROUTE_SHEET: 'PLAN CBT AUG 2026',
  MANPOWER_SHEET: 'Schedule Manpower 2025',
  SO_SHEET: 'OWOR SO SNAPSHOT',
  CONFLICT_SHEET: 'OWOR SO CONFLICTS',
  PICKER_SHEET: 'OWOR PICKER SNAPSHOT',
  STATUS_SHEET: 'OWOR SYNC STATUS',
  TIME_ZONE: 'Asia/Jakarta',
  SUPERSET_URL: 'https://dash.astronauts.id/api/v1/chart/data',
  DATASOURCE_ID: 400,
  DESTINATIONS: ['SWL', 'PSG', 'SMN', 'MRY', 'BSX', 'CPT', 'PPL', 'RDS', 'SLP', 'JLB'],
  ROUTES: {
    SWL: 'SWL - PSG',
    PSG: 'SWL - PSG',
    SMN: 'SMN - MRY',
    MRY: 'SMN - MRY',
    BSX: 'BSX',
    CPT: 'CPT - PPL',
    PPL: 'CPT - PPL',
    RDS: 'RDS - SLP',
    SLP: 'RDS - SLP',
    JLB: 'JLB',
  },
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ONE WAVE ONE ROUTE')
    .addItem('Setup backend', 'setupOworBackend')
    .addItem('Sync now', 'syncOworNow')
    .addItem('Install 5-minute trigger', 'installOworTrigger')
    .addToUi();
}

function setupOworBackend() {
  ensureSheets_();
  installOworTrigger();
  return syncOworNow();
}

function installOworTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'syncOworNow')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncOworNow').timeBased().everyMinutes(5).create();
  return { ok: true, trigger: 'every 5 minutes' };
}

function syncOworNow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: false, skipped: true, message: 'Sync already running.' };

  const startedAt = new Date();
  try {
    ensureSheets_();
    assertRouteConfig_();
    const cookie = readSupersetCookie_();
    const supersetRows = fetchSupersetRows_(cookie);
    const normalized = normalizeOrders_(supersetRows);
    const orders = normalized.orders;
    const conflicts = normalized.conflicts;
    const pickers = readScheduledPickers_();
    const generatedAt = new Date();

    writeOrderSnapshot_(orders, generatedAt);
    writeConflictSnapshot_(conflicts, generatedAt);
    writePickerSnapshot_(pickers, generatedAt);
    writeStatus_('SUCCESS', {
      startedAt,
      generatedAt,
      operationalDate: todayIso_(),
      supersetRows: supersetRows.length,
      orders: orders.length,
      zoneConflicts: conflicts.length,
      pickers: pickers.length,
      message: 'Compact snapshot ready.',
    });
    return { ok: true, orders: orders.length, zoneConflicts: conflicts.length, pickers: pickers.length, generatedAt: generatedAt.toISOString() };
  } catch (error) {
    writeStatus_('ERROR', {
      startedAt,
      generatedAt: new Date(),
      operationalDate: todayIso_(),
      supersetRows: 0,
      orders: 0,
      zoneConflicts: 0,
      pickers: 0,
      message: safeError_(error),
    });
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function doGet(event) {
  const token = PropertiesService.getScriptProperties().getProperty('OWOR_API_TOKEN') || '';
  const supplied = String((event && event.parameter && event.parameter.token) || '');
  if (!token || supplied !== token) return json_({ ok: false, error: 'UNAUTHORIZED' });

  const resource = String((event && event.parameter && event.parameter.resource) || 'snapshot');
  if (resource === 'health') return json_(buildHealth_());
  if (resource !== 'snapshot') return json_({ ok: false, error: 'INVALID_RESOURCE' });
  return json_(buildSnapshot_());
}

function doPost(event) {
  let body = {};
  try { body = JSON.parse((event && event.postData && event.postData.contents) || '{}'); } catch (_) {}
  const token = PropertiesService.getScriptProperties().getProperty('OWOR_API_TOKEN') || '';
  if (!token || String(body.token || '') !== token) return json_({ ok: false, error: 'UNAUTHORIZED' });
  if (body.action !== 'sync') return json_({ ok: false, error: 'INVALID_ACTION' });
  try { return json_(syncOworNow()); } catch (error) { return json_({ ok: false, error: safeError_(error) }); }
}

function fetchSupersetRows_(cookie) {
  const destinationSql = `CASE
    WHEN UPPER(COALESCE(destination_name_adjusted, '')) LIKE '%SWL%' THEN 'SWL'
    WHEN UPPER(COALESCE(destination_name_adjusted, '')) LIKE '%PSG%' THEN 'PSG'
    WHEN UPPER(COALESCE(destination_name_adjusted, '')) LIKE '%SMN%' THEN 'SMN'
    WHEN UPPER(COALESCE(destination_name_adjusted, '')) LIKE '%MRY%' THEN 'MRY'
    WHEN UPPER(COALESCE(destination_name_adjusted, '')) LIKE '%BSX%' THEN 'BSX'
    WHEN UPPER(COALESCE(destination_name_adjusted, '')) LIKE '%CPT%' THEN 'CPT'
    WHEN UPPER(COALESCE(destination_name_adjusted, '')) LIKE '%PPL%' THEN 'PPL'
    WHEN UPPER(COALESCE(destination_name_adjusted, '')) LIKE '%RDS%' THEN 'RDS'
    WHEN UPPER(COALESCE(destination_name_adjusted, '')) LIKE '%SLP%' THEN 'SLP'
    WHEN UPPER(COALESCE(destination_name_adjusted, '')) LIKE '%JLB%' THEN 'JLB'
    ELSE 'OTHER' END`;
  const destinationColumn = adhocColumn_(destinationSql, 'destination_code');
  const zoneColumn = adhocColumn_("extract(origin_rack_name, '^CBT-([^-]+)')", 'parsed_zone');
  const columns = ['so_number', destinationColumn, zoneColumn];
  const metrics = [
    adhocMetric_('SUM(request_quantity)', 'request_qty'),
    adhocMetric_('COUNT(DISTINCT sku_number)', 'sku_count'),
  ];
  const filters = [
    { col: 'supply_order_created_at_date_adjusted', op: 'TEMPORAL_RANGE', val: 'Current day' },
    { col: 'status', op: 'IN', val: ['NEW'] },
  ];
  const destinationsWhere = OWOR.DESTINATIONS.map((code) => `UPPER(destination_name_adjusted) LIKE '%${code}%'`).join(' OR ');
  const where = `so_number LIKE 'INV/SO/%' AND UPPER(COALESCE(origin_rack_name, '')) LIKE 'CBT-%' AND (${destinationsWhere})`;
  const query = {
    annotation_layers: [], applied_time_extras: {}, columns, custom_form_data: {}, custom_params: {},
    extras: { having: '', where }, filters, metrics, order_desc: true, orderby: [],
    post_processing: [], row_limit: 100000, series_limit: 0, time_offsets: [],
    url_params: { datasource_id: '400', datasource_type: 'table' },
  };
  const payload = {
    datasource: { id: OWOR.DATASOURCE_ID, type: 'table' }, force: true, queries: [query],
    form_data: {
      datasource: '400__table', viz_type: 'table', query_mode: 'aggregate', groupby: columns,
      metrics, adhoc_filters: [
        adhocFilter_('supply_order_created_at_date_adjusted', 'TEMPORAL_RANGE', 'Current day'),
        adhocFilter_('status', 'IN', ['NEW']),
      ], row_limit: 100000,
    },
    result_format: 'json', result_type: 'results',
  };
  const csrf = extractCookieValue_(cookie, ['csrftoken', 'csrf_token']);
  const headers = { Accept: 'application/json', Cookie: cookie, Referer: 'https://dash.astronauts.id/' };
  if (csrf) headers['X-CSRFToken'] = csrf;
  const response = UrlFetchApp.fetch(OWOR.SUPERSET_URL, {
    method: 'post', contentType: 'application/json', headers,
    payload: JSON.stringify(payload), followRedirects: false, muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300 || /^\s*</.test(text)) {
    throw new Error(`SUPERSET_HTTP_${code}: cookie expired or query rejected.`);
  }
  return parseSuperset_(text, ['so_number', 'destination_code', 'parsed_zone', 'request_qty', 'sku_count']);
}

function normalizeOrders_(rows) {
  const bySo = {};
  rows.forEach((row) => {
    const soNumber = String(row.so_number || '').trim();
    const destination = String(row.destination_code || '').trim().toUpperCase();
    const zone = String(row.parsed_zone || 'UNMAPPED').trim().toUpperCase() || 'UNMAPPED';
    if (!soNumber || !OWOR.ROUTES[destination]) return;
    if (!bySo[soNumber]) bySo[soNumber] = { soNumber, destinations: {}, qty: 0, sku: 0, zones: {} };
    const qty = Number(row.request_qty || 0);
    const sku = Number(row.sku_count || 0);
    bySo[soNumber].qty += qty;
    bySo[soNumber].sku += sku;
    bySo[soNumber].destinations[destination] = true;
    bySo[soNumber].zones[zone] = (bySo[soNumber].zones[zone] || 0) + qty;
  });
  const orders = [];
  const conflicts = [];
  Object.keys(bySo).forEach((key) => {
    const order = bySo[key];
    const zones = Object.keys(order.zones);
    const destinations = Object.keys(order.destinations);
    if (zones.length !== 1 || zones[0] === 'UNMAPPED' || destinations.length !== 1) {
      conflicts.push({
        soNumber: order.soNumber,
        destinations: destinations.join(', '),
        zones: zones.join(', '),
        qty: order.qty,
        reason: destinations.length !== 1 ? 'DESTINATION_CONFLICT' : zones.length !== 1 ? 'ZONE_CONFLICT' : 'ZONE_UNMAPPED',
      });
      return;
    }
    const destination = destinations[0];
    orders.push({ soNumber: order.soNumber, destination, route: OWOR.ROUTES[destination], zone: zones[0], qty: order.qty, sku: order.sku });
  });
  orders.sort((a, b) => a.route.localeCompare(b.route) || b.qty - a.qty);
  conflicts.sort((a, b) => b.qty - a.qty);
  return { orders, conflicts };
}

function readScheduledPickers_() {
  const sheet = SpreadsheetApp.openById(OWOR.MANPOWER_SPREADSHEET_ID).getSheetByName(OWOR.MANPOWER_SHEET);
  if (!sheet) throw new Error(`Missing manpower sheet: ${OWOR.MANPOWER_SHEET}`);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const headerValues = sheet.getRange(3, 1, 1, lastColumn).getValues()[0];
  const today = todayIso_();
  let scheduleColumn = -1;
  headerValues.forEach((value, index) => {
    const normalized = normalizeDate_(value);
    if (normalized === today) scheduleColumn = index + 1;
  });
  if (scheduleColumn < 1) throw new Error(`Schedule column not found for ${today}.`);
  const master = sheet.getRange(4, 3, Math.max(0, lastRow - 3), 7).getDisplayValues();
  const schedules = sheet.getRange(4, scheduleColumn, Math.max(0, lastRow - 3), 1).getDisplayValues();
  const excluded = /OFF|CUTI|IZIN|SAKIT|ALPHA|RESIGN|TERMINATE/i;
  const seen = {};
  return master.reduce((pickers, row, index) => {
    const contract = String(row[0] || '').trim();
    const jobTitle = String(row[1] || '').trim();
    const staffId = String(row[2] || '').replace(/\D/g, '');
    const productivity = Number(String(row[3] || '').replace(/[^0-9.-]/g, '')) || 0;
    const defaultShift = String(row[4] || '').trim();
    const zone = String(row[5] || 'UNMAPPED').trim() || 'UNMAPPED';
    const name = String(row[6] || '').trim();
    const schedule = String(schedules[index][0] || '').trim();
    if (jobTitle !== 'Picker' || !/^\d{4,8}$/.test(staffId) || !name || !schedule || excluded.test(schedule) || seen[staffId]) return pickers;
    seen[staffId] = true;
    pickers.push({ staffId, name, zone, productivity, shift: schedule || defaultShift, contract });
    return pickers;
  }, []);
}

function buildSnapshot_() {
  const ss = SpreadsheetApp.openById(OWOR.TARGET_SPREADSHEET_ID);
  const orderSheet = ss.getSheetByName(OWOR.SO_SHEET);
  const conflictSheet = ss.getSheetByName(OWOR.CONFLICT_SHEET);
  const pickerSheet = ss.getSheetByName(OWOR.PICKER_SHEET);
  const status = readStatus_();
  if (!orderSheet || !pickerSheet || status.status !== 'SUCCESS') return { ok: false, error: 'FEED_NOT_READY', sync: status };
  const orderRows = orderSheet.getLastRow() > 1 ? orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, 7).getValues() : [];
  const pickerRows = pickerSheet.getLastRow() > 1 ? pickerSheet.getRange(2, 1, pickerSheet.getLastRow() - 1, 7).getValues() : [];
  const conflictRows = conflictSheet && conflictSheet.getLastRow() > 1 ? conflictSheet.getRange(2, 1, conflictSheet.getLastRow() - 1, 6).getValues() : [];
  return {
    ok: true, generatedAt: status.generatedAt, operationalDate: status.operationalDate,
    source: 'Superset dataset 400 + Google Sheets', sync: status,
    orders: orderRows.filter((row) => row[0]).map((row) => ({ soNumber: String(row[0]), destination: String(row[1]), route: String(row[2]), zone: String(row[3]), qty: Number(row[4]), sku: Number(row[5]) })),
    conflicts: conflictRows.filter((row) => row[0]).map((row) => ({ soNumber: String(row[0]), destinations: String(row[1]), zones: String(row[2]), qty: Number(row[3]), reason: String(row[4]) })),
    pickers: pickerRows.filter((row) => row[0]).map((row) => ({ staffId: String(row[0]), name: String(row[1]), zone: String(row[2]), productivity: Number(row[3]), shift: String(row[4]), contract: String(row[5]) })),
  };
}

function writeConflictSnapshot_(conflicts, generatedAt) {
  const sheet = SpreadsheetApp.openById(OWOR.TARGET_SPREADSHEET_ID).getSheetByName(OWOR.CONFLICT_SHEET);
  sheet.clearContents();
  const values = [['so_number', 'destinations', 'zones', 'request_qty', 'reason', 'generated_at']]
    .concat(conflicts.map((item) => [item.soNumber, item.destinations, item.zones, item.qty, item.reason, generatedAt]));
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  sheet.setFrozenRows(1);
}

function buildHealth_() { const status = readStatus_(); return { ok: status.status === 'SUCCESS', source: 'OWOR GAS', sync: status }; }

function writeOrderSnapshot_(orders, generatedAt) {
  const sheet = SpreadsheetApp.openById(OWOR.TARGET_SPREADSHEET_ID).getSheetByName(OWOR.SO_SHEET);
  sheet.clearContents();
  const values = [['so_number', 'destination', 'route', 'primary_zone', 'request_qty', 'sku_count', 'generated_at']]
    .concat(orders.map((order) => [order.soNumber, order.destination, order.route, order.zone, order.qty, order.sku, generatedAt]));
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  sheet.setFrozenRows(1);
}

function writePickerSnapshot_(pickers, generatedAt) {
  const sheet = SpreadsheetApp.openById(OWOR.TARGET_SPREADSHEET_ID).getSheetByName(OWOR.PICKER_SHEET);
  sheet.clearContents();
  const values = [['staff_id', 'name', 'zone', 'productivity', 'shift', 'contract', 'generated_at']]
    .concat(pickers.map((picker) => [picker.staffId, picker.name, picker.zone, picker.productivity, picker.shift, picker.contract, generatedAt]));
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  sheet.setFrozenRows(1);
}

function writeStatus_(status, detail) {
  const sheet = SpreadsheetApp.openById(OWOR.TARGET_SPREADSHEET_ID).getSheetByName(OWOR.STATUS_SHEET);
  sheet.clearContents();
  const values = [
    ['key', 'value'], ['status', status], ['operational_date', detail.operationalDate],
    ['started_at', detail.startedAt], ['generated_at', detail.generatedAt],
    ['superset_rows', detail.supersetRows], ['orders', detail.orders], ['zone_conflicts', detail.zoneConflicts || 0], ['pickers', detail.pickers], ['message', detail.message],
  ];
  sheet.getRange(1, 1, values.length, 2).setValues(values);
  sheet.setFrozenRows(1);
}

function readStatus_() {
  const sheet = SpreadsheetApp.openById(OWOR.TARGET_SPREADSHEET_ID).getSheetByName(OWOR.STATUS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { status: 'NOT_READY' };
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  const data = {}; rows.forEach((row) => { data[String(row[0])] = row[1]; });
  return { status: data.status || 'UNKNOWN', operationalDate: data.operational_date || '', generatedAt: data.generated_at || '', supersetRows: Number(data.superset_rows || 0), orders: Number(data.orders || 0), zoneConflicts: Number(data.zone_conflicts || 0), pickers: Number(data.pickers || 0), message: data.message || '' };
}

function ensureSheets_() {
  const ss = SpreadsheetApp.openById(OWOR.TARGET_SPREADSHEET_ID);
  [OWOR.SO_SHEET, OWOR.CONFLICT_SHEET, OWOR.PICKER_SHEET, OWOR.STATUS_SHEET].forEach((name) => { if (!ss.getSheetByName(name)) ss.insertSheet(name); });
}

function assertRouteConfig_() {
  const sheet = SpreadsheetApp.openById(OWOR.TARGET_SPREADSHEET_ID).getSheetByName(OWOR.ROUTE_SHEET);
  if (!sheet) throw new Error(`Missing route sheet: ${OWOR.ROUTE_SHEET}`);
  const text = sheet.getDataRange().getDisplayValues().flat().join(' ').toUpperCase();
  OWOR.DESTINATIONS.forEach((code) => { if (!text.includes(code)) throw new Error(`Route code ${code} missing from ${OWOR.ROUTE_SHEET}.`); });
}

function readSupersetCookie_() {
  const sheet = SpreadsheetApp.openById(OWOR.COOKIE_SPREADSHEET_ID).getSheetByName(OWOR.COOKIE_SHEET);
  const cookie = sheet ? String(sheet.getRange('A1').getDisplayValue() || '').trim() : '';
  if (!cookie) throw new Error('SUPERSET_COOKIE_MISSING');
  return cookie.replace(/^cookie\s*:\s*/i, '').trim();
}

function parseSuperset_(text, expectedHeaders) {
  const parsed = JSON.parse(text);
  if (parsed.errors) throw new Error(parsed.errors.map((item) => item.message || String(item)).join(' | '));
  const result = Array.isArray(parsed.result) ? parsed.result[0] : parsed.result;
  if (!result) throw new Error('SUPERSET_RESULT_MISSING');
  const data = result.data || result.records || [];
  const headers = result.colnames || result.column_names || expectedHeaders;
  return data.map((row) => {
    if (!Array.isArray(row)) return row;
    const item = {}; headers.forEach((header, index) => { item[header] = row[index]; }); return item;
  });
}

function adhocColumn_(sqlExpression, label) { return { expressionType: 'SQL', sqlExpression, label }; }
function adhocMetric_(sqlExpression, label) { return { expressionType: 'SQL', sqlExpression, label, hasCustomLabel: true, optionName: `metric_${label}` }; }
function adhocFilter_(subject, operator, comparator) { return { clause: 'WHERE', comparator, datasourceWarning: false, expressionType: 'SIMPLE', filterOptionName: `filter_${String(subject).replace(/[^A-Za-z0-9]/g, '_')}`, isExtra: false, isNew: false, operator, operatorId: operator === 'NOT IN' ? 'NOT_IN' : operator, sqlExpression: null, subject }; }
function extractCookieValue_(cookie, names) { for (let i = 0; i < names.length; i += 1) { const match = new RegExp(`(?:^|;\\s*)${names[i]}=([^;]+)`, 'i').exec(cookie); if (match) return match[1]; } return ''; }
function todayIso_() { return Utilities.formatDate(new Date(), OWOR.TIME_ZONE, 'yyyy-MM-dd'); }
function normalizeDate_(value) { if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, OWOR.TIME_ZONE, 'yyyy-MM-dd'); const text = String(value || '').trim(); const parsed = new Date(text); return isNaN(parsed.getTime()) ? '' : Utilities.formatDate(parsed, OWOR.TIME_ZONE, 'yyyy-MM-dd'); }
function safeError_(error) { return String(error && error.message ? error.message : error).replace(/cookie\s*[:=].*/ig, 'cookie=[REDACTED]').slice(0, 500); }
function json_(payload) { return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON); }
