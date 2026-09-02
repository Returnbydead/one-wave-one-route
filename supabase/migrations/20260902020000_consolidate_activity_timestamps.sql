create or replace function public.owor_get_consolidate_tasks(p_scope_code text default 'SRA_L2_UP')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with profile as (
    select * from public.owor_user_profiles where user_id = auth.uid() and active
  ), head as (
    select h.* from public.owor_consolidate_head h
    where h.scope_code = upper(btrim(coalesce(p_scope_code, 'SRA_L2_UP')))
  ), batches as (
    select b.* from public.owor_consolidate_batches b join head h on h.snapshot_id = b.snapshot_id
  )
  select jsonb_build_object(
    'ok', exists(select 1 from profile),
    'batches', coalesce((select jsonb_agg(jsonb_build_object(
      'batchId', b.batch_id, 'batchCode', b.batch_code, 'pickingAreaName', b.picking_area_name,
      'status', b.status, 'pickerId', b.picker_id, 'startedAt', b.started_at, 'completedAt', b.completed_at,
      'updatedAt', b.updated_at,
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'lineId', l.line_id, 'lineNo', l.line_no, 'zoneFamily', l.zone_family, 'floorNumber', l.floor_number,
        'originRackName', l.origin_rack_name, 'skuNumber', l.sku_number, 'productName', l.product_name,
        'expiryDate', l.expiry_date, 'totalQty', l.total_qty, 'pickedQty', l.picked_qty,
        'status', l.status, 'waves', l.waves, 'allocations', l.allocations, 'updatedAt', l.updated_at
      ) order by l.line_no) from public.owor_consolidate_batch_lines l where l.batch_id = b.batch_id), '[]'::jsonb)
    ) order by b.batch_code) from batches b), '[]'::jsonb),
    'consolidations', coalesce((select jsonb_agg(jsonb_build_object(
      'batchId', c.batch_id, 'batchCode', b.batch_code, 'soNumber', c.so_number, 'hubCode', c.hub_code,
      'waveNumber', c.wave_number, 'status', c.status, 'consolidatorId', c.consolidator_id,
      'expectedQty', c.expected_qty, 'allocations', c.allocations, 'startedAt', c.started_at,
      'completedAt', c.completed_at, 'updatedAt', c.updated_at
    ) order by c.status, c.wave_number, c.hub_code, c.so_number)
    from public.owor_consolidation_tasks c join batches b on b.batch_id = c.batch_id), '[]'::jsonb)
  );
$$;
