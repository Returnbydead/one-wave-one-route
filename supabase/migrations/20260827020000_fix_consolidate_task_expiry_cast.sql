begin;

create or replace function public.owor_generate_consolidate_tasks(p_scope_code text default 'SRA_L2_UP')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.owor_user_profiles%rowtype;
  v_head public.owor_consolidate_head%rowtype;
begin
  select * into v_profile from public.owor_user_profiles where user_id = auth.uid() and active;
  if not found or v_profile.role <> 'DEVELOPER' then raise exception 'FORBIDDEN'; end if;
  select * into v_head from public.owor_consolidate_head
  where scope_code = upper(btrim(coalesce(p_scope_code, 'SRA_L2_UP')));
  if not found then raise exception 'SNAPSHOT_NOT_READY'; end if;

  insert into public.owor_consolidate_batches(snapshot_id, scope_code, batch_code, picking_area_name)
  select v_head.snapshot_id, v_head.scope_code,
    regexp_replace(v_head.scope_code, '[^A-Z0-9]+', '-', 'g') || '-' || to_char(v_head.operational_date, 'YYYYMMDD') || '-' ||
      lpad(dense_rank() over(order by r.picking_area_name)::text, 2, '0'),
    r.picking_area_name
  from public.owor_consolidate_rows r
  where r.snapshot_id = v_head.snapshot_id
  group by r.picking_area_name
  on conflict(snapshot_id, picking_area_name) do nothing;

  insert into public.owor_consolidate_batch_lines(
    batch_id, line_no, zone_family, floor_number, origin_rack_name, sku_number, product_name,
    expiry_date, total_qty, waves, allocations
  )
  select b.batch_id,
    row_number() over(partition by b.batch_id order by r.origin_rack_name, r.expiry_date nulls last, r.sku_number),
    r.zone_family, r.floor_number, r.origin_rack_name, r.sku_number, max(r.product_name),
    case
      when btrim(r.expiry_date) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then btrim(r.expiry_date)::date
      else null
    end, sum(r.request_qty),
    jsonb_agg(distinct r.wave_number order by r.wave_number),
    jsonb_agg(jsonb_build_object('soNumber', r.so_number, 'hubCode', r.hub_code,
      'waveNumber', r.wave_number, 'requestQty', r.request_qty) order by r.wave_number, r.hub_code, r.so_number)
  from public.owor_consolidate_rows r
  join public.owor_consolidate_batches b on b.snapshot_id = r.snapshot_id and b.picking_area_name = r.picking_area_name
  where r.snapshot_id = v_head.snapshot_id
  group by b.batch_id, r.zone_family, r.floor_number, r.origin_rack_name, r.sku_number, r.expiry_date
  on conflict(batch_id, line_no) do nothing;

  return public.owor_get_consolidate_tasks(v_head.scope_code);
end;
$$;

revoke all on function public.owor_generate_consolidate_tasks(text) from public, anon;
grant execute on function public.owor_generate_consolidate_tasks(text) to authenticated;

commit;
