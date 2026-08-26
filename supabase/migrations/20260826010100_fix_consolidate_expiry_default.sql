begin;

create or replace function public.owor_append_consolidate_rows(p_snapshot_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_written integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'Rows payload must be an array'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 1000 then raise exception 'Append chunk exceeds 1000 rows'; end if;
  if not exists (select 1 from public.owor_consolidate_snapshots where snapshot_id = p_snapshot_id and status = 'DRAFT') then
    raise exception 'Draft snapshot not found';
  end if;

  insert into public.owor_consolidate_rows(
    snapshot_id, so_number, destination_name, hub_code, wave_number, picking_area_name,
    zone_family, floor_number, origin_rack_name, sku_number, product_name, expiry_date, request_qty
  )
  select p_snapshot_id, btrim(x.so_number), coalesce(nullif(btrim(x.destination_name), ''), 'UNKNOWN'),
    upper(btrim(x.hub_code)), x.wave_number, upper(btrim(x.picking_area_name)), upper(btrim(x.zone_family)),
    x.floor_number, coalesce(nullif(upper(btrim(x.origin_rack_name)), ''), 'UNMAPPED'), btrim(x.sku_number),
    coalesce(btrim(x.product_name), ''), coalesce(btrim(x.expiry_date), ''), x.request_qty
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
    so_number text, destination_name text, hub_code text, wave_number integer,
    picking_area_name text, zone_family text, floor_number integer, origin_rack_name text,
    sku_number text, product_name text, expiry_date text, request_qty numeric
  )
  where nullif(btrim(x.so_number), '') is not null and nullif(btrim(x.sku_number), '') is not null
    and x.wave_number > 1 and x.request_qty > 0
  on conflict (snapshot_id, so_number, hub_code, wave_number, picking_area_name, origin_rack_name, sku_number, expiry_date)
  do update set request_qty = excluded.request_qty, product_name = excluded.product_name;
  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke all on function public.owor_append_consolidate_rows(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.owor_append_consolidate_rows(uuid, jsonb) to service_role;

commit;
