# Audit Koli Outbound

The audit workspace is intentionally mobile-first. It expects a Supabase snapshot populated from the Superset dataset `fact_supply_order_item_details` with one task per `(koli_code, so_number)` and one line per SKU.

Required source mapping:

- `so_number` → `owor_koli_audit_tasks.so_number`
- `koli_code` → `owor_koli_audit_tasks.koli_code`
- destination and `fsoid.status` → task metadata
- `product_sku_number` → `owor_koli_audit_lines.sku`
- `product_name` → `owor_koli_audit_lines.product_name`
- `request_quantity` → `owor_koli_audit_lines.expected_qty`

The migration provides RPCs for listing, claiming, confirming SKU quantity, and completing a task. Completion is allowed with a discrepancy only after the auditor supplies a confirmation note. The next backend step is a service-role sync function for the source dataset; it must publish a complete replacement snapshot rather than writing from the browser.
