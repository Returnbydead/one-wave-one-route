# OWOR domain language

## Batch picking task

A frozen work package created from one valid Consolidate Picking snapshot. A picker collects total quantities by rack and SKU without separating them by sales order.

## Pick row

One rack, SKU, and expiry combination inside a batch picking task. Every pick row must be confirmed before its batch can be completed.

## Consolidation task

One sales order created after batch picking completes. A consolidator separates the picked stock according to that sales order's SKU allocation.

## Staging helper task

Movement of one separated sales order to STG-MEZZANINE or STG-SPR.

## Line checker task

Movement of one staged sales order from staging picking to a named checker line.
