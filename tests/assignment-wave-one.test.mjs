import test from 'node:test';
import assert from 'node:assert/strict';
import { OWOR_DESTINATIONS, OWOR_ROUTES, normalizeOrders, normalizePicking } from '../supabase/functions/_shared/owor.ts';

const additions = { MSB: 'MSB', SLP: 'SLP - RDS', RDS: 'SLP - RDS', JLB: 'JLB', BDC: 'BDC - BGS', BGS: 'BDC - BGS', PPN: 'PPN - TAP', TAP: 'PPN - TAP' };
test('all added Wave 1 hubs survive the query allowlist and normalization', () => {
  for (const [hub, route] of Object.entries(additions)) {
    assert.ok(OWOR_DESTINATIONS.includes(hub), `Query must include ${hub}`);
    assert.equal(OWOR_ROUTES[hub], route);
    // Synthetic quantities: exercise the reported MSB SO without inventing its live quantity.
    const row = { so_number: 'INV/SO/20260902/201/6499046', destination_code: hub, parsed_zone: 'MZE1', request_qty: 10, sku_count: 1 };
    const { orders } = normalizeOrders([row]);
    assert.equal(orders.length, 1, `${hub} must not disappear`);
    assert.equal(orders[0].request_qty, 10);
    assert.equal(orders[0].route, route);
    assert.equal(normalizePicking([row])[0]?.route, route);
  }
  assert.equal(OWOR_DESTINATIONS.length, 19);
  assert.equal(new Set(Object.values(OWOR_ROUTES)).size, 11);
});
