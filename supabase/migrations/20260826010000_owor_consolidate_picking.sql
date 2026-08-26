begin;

create table if not exists public.owor_hub_wave_config (
  warehouse text not null default 'CBT',
  hub_code text not null,
  wave_number integer not null check (wave_number > 0),
  drop_order integer,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (warehouse, hub_code)
);

create table if not exists public.owor_consolidate_scopes (
  scope_code text primary key,
  zone_family text not null,
  min_level integer not null check (min_level > 0),
  excluded_waves integer[] not null default array[1],
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.owor_consolidate_scopes(scope_code, zone_family, min_level, excluded_waves, enabled)
values ('SRA_L2_UP', 'SRA', 2, array[1], true)
on conflict (scope_code) do update set
  zone_family = excluded.zone_family,
  min_level = excluded.min_level,
  excluded_waves = excluded.excluded_waves,
  enabled = excluded.enabled,
  updated_at = now();

create table if not exists public.owor_consolidate_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  operational_date date not null,
  scope_code text not null references public.owor_consolidate_scopes(scope_code),
  generated_at timestamptz not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'FAILED')),
  row_count integer not null default 0,
  so_count integer not null default 0,
  checksum text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.owor_consolidate_head (
  scope_code text primary key references public.owor_consolidate_scopes(scope_code),
  snapshot_id uuid not null references public.owor_consolidate_snapshots(snapshot_id),
  operational_date date not null,
  generated_at timestamptz not null,
  row_count integer not null default 0,
  so_count integer not null default 0,
  checksum text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.owor_consolidate_rows (
  snapshot_id uuid not null references public.owor_consolidate_snapshots(snapshot_id) on delete cascade,
  so_number text not null,
  destination_name text not null default 'UNKNOWN',
  hub_code text not null,
  wave_number integer not null check (wave_number > 1),
  picking_area_name text not null,
  zone_family text not null,
  floor_number integer not null,
  origin_rack_name text not null default 'UNMAPPED',
  sku_number text not null,
  product_name text not null default '',
  expiry_date text not null default '',
  request_qty numeric not null check (request_qty > 0),
  primary key (snapshot_id, so_number, hub_code, wave_number, picking_area_name, origin_rack_name, sku_number, expiry_date)
);

create index if not exists owor_consolidate_rows_pick_idx
  on public.owor_consolidate_rows(snapshot_id, picking_area_name, origin_rack_name, sku_number);
create index if not exists owor_consolidate_rows_so_idx
  on public.owor_consolidate_rows(snapshot_id, so_number);

create table if not exists public.owor_consolidate_sync_state (
  scope_code text primary key references public.owor_consolidate_scopes(scope_code),
  active_snapshot_id uuid,
  locked_until timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  updated_at timestamptz not null default now()
);

alter table public.owor_hub_wave_config enable row level security;
alter table public.owor_consolidate_scopes enable row level security;
alter table public.owor_consolidate_snapshots enable row level security;
alter table public.owor_consolidate_head enable row level security;
alter table public.owor_consolidate_rows enable row level security;
alter table public.owor_consolidate_sync_state enable row level security;

revoke all on public.owor_hub_wave_config from anon, authenticated;
revoke all on public.owor_consolidate_scopes from anon, authenticated;
revoke all on public.owor_consolidate_snapshots from anon, authenticated;
revoke all on public.owor_consolidate_head from anon, authenticated;
revoke all on public.owor_consolidate_rows from anon, authenticated;
revoke all on public.owor_consolidate_sync_state from anon, authenticated;

create or replace function public.owor_get_consolidate_config(p_scope_code text default 'SRA_L2_UP')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'scope', coalesce((
      select jsonb_build_object(
        'code', s.scope_code, 'zoneFamily', s.zone_family, 'minLevel', s.min_level,
        'excludedWaves', to_jsonb(s.excluded_waves), 'enabled', s.enabled
      ) from public.owor_consolidate_scopes s
      where s.scope_code = upper(btrim(coalesce(p_scope_code, 'SRA_L2_UP')))
    ), 'null'::jsonb),
    'waveMap', coalesce((
      select jsonb_object_agg(c.hub_code, c.wave_number order by c.hub_code)
      from public.owor_hub_wave_config c where c.warehouse = 'CBT' and c.active
    ), '{}'::jsonb)
  );
$$;

create or replace function public.owor_begin_consolidate_snapshot(
  p_scope_code text,
  p_operational_date date,
  p_generated_at timestamptz,
  p_lock_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text := upper(btrim(coalesce(p_scope_code, '')));
  v_state public.owor_consolidate_sync_state%rowtype;
  v_snapshot uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.owor_consolidate_scopes where scope_code = v_scope and enabled) then
    raise exception 'Consolidate scope is missing or disabled';
  end if;

  insert into public.owor_consolidate_sync_state(scope_code) values (v_scope)
  on conflict (scope_code) do nothing;
  select * into v_state from public.owor_consolidate_sync_state where scope_code = v_scope for update;

  if v_state.locked_until is not null and v_state.locked_until > now() then
    return jsonb_build_object('claimed', false, 'activeSnapshotId', v_state.active_snapshot_id);
  end if;

  insert into public.owor_consolidate_snapshots(snapshot_id, operational_date, scope_code, generated_at)
  values (v_snapshot, p_operational_date, v_scope, coalesce(p_generated_at, now()));
  update public.owor_consolidate_sync_state
  set active_snapshot_id = v_snapshot,
      locked_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lock_seconds, 300), 900))),
      updated_at = now()
  where scope_code = v_scope;
  return jsonb_build_object('claimed', true, 'snapshotId', v_snapshot);
end;
$$;

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

create or replace function public.owor_finalize_consolidate_snapshot(
  p_snapshot_id uuid,
  p_checksum text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot public.owor_consolidate_snapshots%rowtype;
  v_rows integer;
  v_sos integer;
begin
  select * into v_snapshot from public.owor_consolidate_snapshots where snapshot_id = p_snapshot_id and status = 'DRAFT' for update;
  if v_snapshot.snapshot_id is null then raise exception 'Draft snapshot not found'; end if;
  select count(*), count(distinct so_number) into v_rows, v_sos from public.owor_consolidate_rows where snapshot_id = p_snapshot_id;
  if v_rows = 0 then raise exception 'Consolidate snapshot is empty; last valid snapshot retained'; end if;

  update public.owor_consolidate_snapshots
  set status = 'PUBLISHED', row_count = v_rows, so_count = v_sos,
      checksum = coalesce(p_checksum, ''), metadata = coalesce(p_metadata, '{}'::jsonb)
  where snapshot_id = p_snapshot_id;
  insert into public.owor_consolidate_head(scope_code, snapshot_id, operational_date, generated_at, row_count, so_count, checksum)
  values (v_snapshot.scope_code, p_snapshot_id, v_snapshot.operational_date, v_snapshot.generated_at, v_rows, v_sos, coalesce(p_checksum, ''))
  on conflict (scope_code) do update set snapshot_id = excluded.snapshot_id, operational_date = excluded.operational_date,
    generated_at = excluded.generated_at, row_count = excluded.row_count, so_count = excluded.so_count,
    checksum = excluded.checksum, updated_at = now();
  update public.owor_consolidate_sync_state
  set active_snapshot_id = null, locked_until = null, last_success_at = now(), last_error_at = null,
      last_error_message = null, updated_at = now()
  where scope_code = v_snapshot.scope_code and active_snapshot_id = p_snapshot_id;
  return jsonb_build_object('snapshotId', p_snapshot_id, 'rowCount', v_rows, 'soCount', v_sos);
end;
$$;

create or replace function public.owor_fail_consolidate_snapshot(p_snapshot_id uuid, p_error_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_scope text;
begin
  update public.owor_consolidate_snapshots set status = 'FAILED', metadata = metadata || jsonb_build_object('error', left(coalesce(p_error_message, ''), 500))
  where snapshot_id = p_snapshot_id and status = 'DRAFT' returning scope_code into v_scope;
  if v_scope is not null then
    update public.owor_consolidate_sync_state set active_snapshot_id = null, locked_until = null,
      last_error_at = now(), last_error_message = left(coalesce(p_error_message, ''), 500), updated_at = now()
    where scope_code = v_scope and active_snapshot_id = p_snapshot_id;
  end if;
end;
$$;

create or replace function public.owor_get_consolidate_picklist(p_scope_code text default 'SRA_L2_UP')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scope as (
    select * from public.owor_consolidate_scopes where scope_code = upper(btrim(coalesce(p_scope_code, 'SRA_L2_UP'))) and enabled
  ), head as (
    select h.* from public.owor_consolidate_head h join scope s using(scope_code)
  ), current_rows as (
    select r.* from public.owor_consolidate_rows r join head h on h.snapshot_id = r.snapshot_id
  ), item_keys as (
    select picking_area_name, zone_family, floor_number, origin_rack_name, sku_number, product_name, expiry_date,
      sum(request_qty) as total_qty, count(distinct so_number) as so_count
    from current_rows
    group by picking_area_name, zone_family, floor_number, origin_rack_name, sku_number, product_name, expiry_date
  ), items as (
    select k.*,
      (select jsonb_agg(w.wave_number order by w.wave_number) from (
        select distinct r.wave_number from current_rows r
        where r.picking_area_name = k.picking_area_name and r.origin_rack_name = k.origin_rack_name
          and r.sku_number = k.sku_number and r.expiry_date = k.expiry_date
      ) w) as waves,
      (select jsonb_agg(jsonb_build_object('soNumber', a.so_number, 'hubCode', a.hub_code,
        'waveNumber', a.wave_number, 'requestQty', a.request_qty) order by a.wave_number, a.hub_code, a.so_number)
       from current_rows a where a.picking_area_name = k.picking_area_name and a.origin_rack_name = k.origin_rack_name
         and a.sku_number = k.sku_number and a.expiry_date = k.expiry_date) as allocations
    from item_keys k
  )
  select jsonb_build_object(
    'ok', exists(select 1 from head),
    'generatedAt', (select generated_at from head),
    'operationalDate', (select operational_date from head),
    'stale', coalesce((select generated_at < now() - interval '20 minutes' from head), true),
    'scope', coalesce((select jsonb_build_object('code', scope_code, 'zoneFamily', zone_family,
      'minLevel', min_level, 'excludedWaves', to_jsonb(excluded_waves)) from scope), 'null'::jsonb),
    'totals', jsonb_build_object(
      'pickRows', coalesce((select count(*) from items), 0),
      'soCount', coalesce((select so_count from head), 0),
      'totalQty', coalesce((select sum(request_qty) from current_rows), 0)
    ),
    'picklist', coalesce((select jsonb_agg(jsonb_build_object(
      'pickingAreaName', i.picking_area_name, 'zoneFamily', i.zone_family, 'floorNumber', i.floor_number,
      'originRackName', i.origin_rack_name, 'skuNumber', i.sku_number, 'productName', i.product_name,
      'expiryDate', i.expiry_date, 'totalQty', i.total_qty, 'soCount', i.so_count,
      'waves', i.waves, 'allocations', i.allocations
    ) order by i.picking_area_name, i.origin_rack_name, i.expiry_date nulls last, i.sku_number) from items i), '[]'::jsonb)
  );
$$;

create or replace function public.owor_upsert_hub_wave_config(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_written integer := 0;
begin
  if not coalesce((select p.role = 'DEVELOPER' and p.active from public.owor_current_profile() p), false) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 500 then
    raise exception 'Wave map payload must be an array of at most 500 rows';
  end if;
  insert into public.owor_hub_wave_config(warehouse, hub_code, wave_number, drop_order, active)
  select coalesce(nullif(upper(btrim(x.warehouse)), ''), 'CBT'), upper(btrim(x.hub_code)), x.wave_number, x.drop_order, coalesce(x.active, true)
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(warehouse text, hub_code text, wave_number integer, drop_order integer, active boolean)
  where nullif(btrim(x.hub_code), '') is not null and x.wave_number > 0
  on conflict (warehouse, hub_code) do update set wave_number = excluded.wave_number, drop_order = excluded.drop_order,
    active = excluded.active, updated_at = now();
  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke all on function public.owor_get_consolidate_config(text) from public, anon, authenticated;
revoke all on function public.owor_begin_consolidate_snapshot(text, date, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.owor_append_consolidate_rows(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.owor_finalize_consolidate_snapshot(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.owor_fail_consolidate_snapshot(uuid, text) from public, anon, authenticated;
revoke all on function public.owor_get_consolidate_picklist(text) from public, anon;
revoke all on function public.owor_upsert_hub_wave_config(jsonb) from public, anon;
grant execute on function public.owor_get_consolidate_config(text) to service_role;
grant execute on function public.owor_begin_consolidate_snapshot(text, date, timestamptz, integer) to service_role;
grant execute on function public.owor_append_consolidate_rows(uuid, jsonb) to service_role;
grant execute on function public.owor_finalize_consolidate_snapshot(uuid, text, jsonb) to service_role;
grant execute on function public.owor_fail_consolidate_snapshot(uuid, text) to service_role;
grant execute on function public.owor_get_consolidate_picklist(text) to authenticated, service_role;
grant execute on function public.owor_upsert_hub_wave_config(jsonb) to authenticated, service_role;

commit;
