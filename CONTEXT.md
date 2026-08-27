# OWOR domain language

## Batch picking task

A frozen work package created from one valid Consolidate Picking snapshot. A picker collects total quantities by rack and SKU without separating them by sales order.

## Pick row

One rack, SKU, and expiry combination inside a batch picking task. A picker must confirm the SKU and quantity at that rack. Partial confirmations accumulate, may not exceed the target, and the row is complete only when the target is reached.

## Picking assignment

A developer-created allocation of selected waves and selected rack locations to one or more bulk pickers. Every selected location belongs to exactly one picker task in that assignment.

## Consolidation task

One sales order created after batch picking completes. A consolidator separates the picked stock according to that sales order's SKU allocation.

## Access role

One operational capability attached to an account. An account may hold multiple roles; each role independently unlocks its matching workspace. Developer includes every capability.

## Staging helper task

Movement of one separated sales order to STG-MEZZANINE or STG-SPR.

## Line checker task

Movement of one staged sales order from staging picking to a named checker line.
