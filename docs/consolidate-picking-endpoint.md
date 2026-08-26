# Consolidate Picking backend contract

## Trial scope

- Scope code: `SRA_L2_UP`
- Superset dataset: `400` (`dm_inventory.fact_supply_order_items_ops`)
- Source area column: `picking_area_name`
- Example mapping: `SPR A2-1` -> zone family `SRA`, floor `2`
- Included: SRA floor 2 and above
- Excluded: Wave 1, `CANCELLED`, unknown hub/wave mappings, invalid areas
- Refresh: manual only during trial; no cron is installed yet

The parser is generic: `SPR B3-1` becomes `SRB` floor 3, so a future scope can be added without changing the source query model.

## Sync endpoint

`POST /functions/v1/sync-consolidate-picking`

Required header: `x-sync-secret`. The secret remains server-side.

Probe request (checks the live Superset column and sample area values without publishing):

```json
{ "action": "probe", "scope": "SRA_L2_UP", "date": "2026-08-26" }
```

Publish request:

```json
{ "action": "sync", "scope": "SRA_L2_UP", "date": "2026-08-26" }
```

Publishing fails closed with `WAVE_MAP_REQUIRED` until `owor_hub_wave_config` has active CBT hub-to-wave mappings.

## Read endpoint

Authenticated clients call RPC `owor_get_consolidate_picklist('SRA_L2_UP')`.

The response contains snapshot freshness, totals, and a rack/SKU picklist. Each picklist item retains `allocations` per SO, hub, and wave so the picked stock can later be consolidated back into each SO.

## Wave config

Developer users can call RPC `owor_upsert_hub_wave_config(rows)` with:

```json
[
  { "warehouse": "CBT", "hub_code": "PPL", "wave_number": 2, "drop_order": 1, "active": true }
]
```

The intended source is the existing Google Sheet master with `WH`, `HUB`, `WAVE`, and `DROP`. Unknown mappings are counted for diagnostics and never included in the published picklist.
