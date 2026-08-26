begin;

alter table public.owor_user_profiles drop constraint if exists owor_user_profiles_role_check;
alter table public.owor_user_profiles add constraint owor_user_profiles_role_check
  check (role in ('DEVELOPER', 'STAGING_HELPER', 'LINE_HELPER', 'CONSOLIDATE_PICKER', 'CONSOLIDATOR'));

create or replace function public.owor_create_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app text := coalesce(new.raw_app_meta_data ->> 'app', '');
  v_staff_id text := upper(btrim(coalesce(new.raw_app_meta_data ->> 'staff_id', '')));
  v_name text := btrim(coalesce(new.raw_app_meta_data ->> 'name', ''));
  v_role text := upper(btrim(coalesce(new.raw_app_meta_data ->> 'role', '')));
begin
  if v_app <> 'owor' then return new; end if;
  if v_staff_id = '' or v_name = '' or v_role not in ('DEVELOPER', 'STAGING_HELPER', 'LINE_HELPER', 'CONSOLIDATE_PICKER', 'CONSOLIDATOR') then
    raise exception 'invalid OWOR auth metadata';
  end if;
  insert into public.owor_user_profiles(user_id, staff_id, name, role, active)
  values (new.id, v_staff_id, v_name, v_role, true)
  on conflict (user_id) do update set
    staff_id = excluded.staff_id, name = excluded.name, role = excluded.role,
    active = true, updated_at = now();
  return new;
end;
$$;

create table if not exists public.owor_consolidate_batches (
  batch_id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.owor_consolidate_snapshots(snapshot_id),
  scope_code text not null references public.owor_consolidate_scopes(scope_code),
  batch_code text not null unique,
  picking_area_name text not null,
  status text not null default 'READY' check (status in ('READY', 'IN_PROGRESS', 'PICKING_COMPLETED')),
  picker_id text not null default '',
  started_at timestamptz,
  completed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(snapshot_id, picking_area_name)
);

create table if not exists public.owor_consolidate_batch_lines (
  line_id bigint generated always as identity primary key,
  batch_id uuid not null references public.owor_consolidate_batches(batch_id) on delete cascade,
  line_no integer not null,
  zone_family text not null,
  floor_number integer not null,
  origin_rack_name text not null,
  sku_number text not null,
  product_name text not null default '',
  expiry_date date,
  total_qty numeric not null check (total_qty > 0),
  picked_qty numeric not null default 0 check (picked_qty >= 0),
  status text not null default 'READY' check (status in ('READY', 'DONE')),
  waves jsonb not null default '[]'::jsonb,
  allocations jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique(batch_id, line_no)
);

create table if not exists public.owor_consolidation_tasks (
  batch_id uuid not null references public.owor_consolidate_batches(batch_id) on delete cascade,
  so_number text not null,
  hub_code text not null,
  wave_number integer not null,
  status text not null default 'READY' check (status in ('READY', 'CONSOLIDATING', 'CONSOLIDATED')),
  consolidator_id text not null default '',
  expected_qty numeric not null check (expected_qty > 0),
  allocations jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(batch_id, so_number)
);

create index if not exists owor_consolidate_batches_status_idx on public.owor_consolidate_batches(scope_code, status, updated_at desc);
create index if not exists owor_consolidation_tasks_status_idx on public.owor_consolidation_tasks(status, updated_at desc);

alter table public.owor_consolidate_batches enable row level security;
alter table public.owor_consolidate_batch_lines enable row level security;
alter table public.owor_consolidation_tasks enable row level security;

drop policy if exists owor_consolidate_batches_read on public.owor_consolidate_batches;
create policy owor_consolidate_batches_read on public.owor_consolidate_batches for select to authenticated
using (exists(select 1 from public.owor_user_profiles p where p.user_id = auth.uid() and p.active));
drop policy if exists owor_consolidate_batch_lines_read on public.owor_consolidate_batch_lines;
create policy owor_consolidate_batch_lines_read on public.owor_consolidate_batch_lines for select to authenticated
using (exists(select 1 from public.owor_user_profiles p where p.user_id = auth.uid() and p.active));
drop policy if exists owor_consolidation_tasks_read on public.owor_consolidation_tasks;
create policy owor_consolidation_tasks_read on public.owor_consolidation_tasks for select to authenticated
using (exists(select 1 from public.owor_user_profiles p where p.user_id = auth.uid() and p.active));

revoke all on public.owor_consolidate_batches, public.owor_consolidate_batch_lines, public.owor_consolidation_tasks from anon;
revoke insert, update, delete on public.owor_consolidate_batches, public.owor_consolidate_batch_lines, public.owor_consolidation_tasks from authenticated;
grant select on public.owor_consolidate_batches, public.owor_consolidate_batch_lines, public.owor_consolidation_tasks to authenticated;

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
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'lineId', l.line_id, 'lineNo', l.line_no, 'zoneFamily', l.zone_family, 'floorNumber', l.floor_number,
        'originRackName', l.origin_rack_name, 'skuNumber', l.sku_number, 'productName', l.product_name,
        'expiryDate', l.expiry_date, 'totalQty', l.total_qty, 'pickedQty', l.picked_qty,
        'status', l.status, 'waves', l.waves, 'allocations', l.allocations
      ) order by l.line_no) from public.owor_consolidate_batch_lines l where l.batch_id = b.batch_id), '[]'::jsonb)
    ) order by b.batch_code) from batches b), '[]'::jsonb),
    'consolidations', coalesce((select jsonb_agg(jsonb_build_object(
      'batchId', c.batch_id, 'batchCode', b.batch_code, 'soNumber', c.so_number, 'hubCode', c.hub_code,
      'waveNumber', c.wave_number, 'status', c.status, 'consolidatorId', c.consolidator_id,
      'expectedQty', c.expected_qty, 'allocations', c.allocations, 'startedAt', c.started_at,
      'completedAt', c.completed_at
    ) order by c.status, c.wave_number, c.hub_code, c.so_number)
    from public.owor_consolidation_tasks c join batches b on b.batch_id = c.batch_id), '[]'::jsonb)
  );
$$;

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
    r.expiry_date, sum(r.request_qty),
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

create or replace function public.owor_apply_consolidate_action(
  p_batch_id uuid,
  p_action text,
  p_line_id bigint default null,
  p_qty numeric default null,
  p_so_number text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.owor_user_profiles%rowtype;
  v_batch public.owor_consolidate_batches%rowtype;
  v_line public.owor_consolidate_batch_lines%rowtype;
  v_task public.owor_consolidation_tasks%rowtype;
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_now timestamptz := now();
begin
  select * into v_profile from public.owor_user_profiles where user_id = auth.uid() and active;
  if not found then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_batch from public.owor_consolidate_batches where batch_id = p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;

  if v_action = 'CLAIM_PICKING' then
    if v_profile.role not in ('DEVELOPER', 'CONSOLIDATE_PICKER') then raise exception 'FORBIDDEN'; end if;
    if v_batch.status <> 'READY' then raise exception 'BATCH_NOT_READY'; end if;
    update public.owor_consolidate_batches set status = 'IN_PROGRESS', picker_id = v_profile.staff_id,
      started_at = v_now, updated_at = v_now, version = version + 1
    where batch_id = p_batch_id returning * into v_batch;
  elsif v_action = 'COMPLETE_LINE' then
    if v_profile.role not in ('DEVELOPER', 'CONSOLIDATE_PICKER') then raise exception 'FORBIDDEN'; end if;
    if v_batch.status <> 'IN_PROGRESS' or (v_profile.role <> 'DEVELOPER' and v_batch.picker_id <> v_profile.staff_id) then raise exception 'BATCH_NOT_OWNED'; end if;
    select * into v_line from public.owor_consolidate_batch_lines where line_id = p_line_id and batch_id = p_batch_id for update;
    if not found then raise exception 'PICK_LINE_NOT_FOUND'; end if;
    if p_qty is null or p_qty <> v_line.total_qty then raise exception 'PICK_QTY_MUST_MATCH'; end if;
    update public.owor_consolidate_batch_lines set picked_qty = p_qty, status = 'DONE', updated_at = v_now
    where line_id = p_line_id;
  elsif v_action = 'COMPLETE_PICKING' then
    if v_profile.role not in ('DEVELOPER', 'CONSOLIDATE_PICKER') then raise exception 'FORBIDDEN'; end if;
    if v_batch.status <> 'IN_PROGRESS' or (v_profile.role <> 'DEVELOPER' and v_batch.picker_id <> v_profile.staff_id) then raise exception 'BATCH_NOT_OWNED'; end if;
    if exists(select 1 from public.owor_consolidate_batch_lines where batch_id = p_batch_id and status <> 'DONE') then raise exception 'PICK_ROWS_INCOMPLETE'; end if;
    update public.owor_consolidate_batches set status = 'PICKING_COMPLETED', completed_at = v_now,
      updated_at = v_now, version = version + 1 where batch_id = p_batch_id returning * into v_batch;
    insert into public.owor_consolidation_tasks(batch_id, so_number, hub_code, wave_number, expected_qty, allocations)
    select p_batch_id, a.value ->> 'soNumber', max(a.value ->> 'hubCode'),
      max((a.value ->> 'waveNumber')::integer), sum((a.value ->> 'requestQty')::numeric),
      jsonb_agg(jsonb_build_object('lineId', l.line_id, 'skuNumber', l.sku_number,
        'productName', l.product_name, 'requestQty', (a.value ->> 'requestQty')::numeric)
        order by l.line_no)
    from public.owor_consolidate_batch_lines l cross join lateral jsonb_array_elements(l.allocations) a(value)
    where l.batch_id = p_batch_id
    group by a.value ->> 'soNumber'
    on conflict(batch_id, so_number) do nothing;
  elsif v_action = 'CLAIM_CONSOLIDATION' then
    if v_profile.role not in ('DEVELOPER', 'CONSOLIDATOR') then raise exception 'FORBIDDEN'; end if;
    if v_batch.status <> 'PICKING_COMPLETED' then raise exception 'PICKING_NOT_COMPLETED'; end if;
    select * into v_task from public.owor_consolidation_tasks
      where batch_id = p_batch_id and so_number = btrim(p_so_number) for update;
    if not found or v_task.status <> 'READY' then raise exception 'CONSOLIDATION_NOT_READY'; end if;
    update public.owor_consolidation_tasks set status = 'CONSOLIDATING', consolidator_id = v_profile.staff_id,
      started_at = v_now, updated_at = v_now, version = version + 1
    where batch_id = p_batch_id and so_number = btrim(p_so_number);
  elsif v_action = 'COMPLETE_CONSOLIDATION' then
    if v_profile.role not in ('DEVELOPER', 'CONSOLIDATOR') then raise exception 'FORBIDDEN'; end if;
    select * into v_task from public.owor_consolidation_tasks
      where batch_id = p_batch_id and so_number = btrim(p_so_number) for update;
    if not found or v_task.status <> 'CONSOLIDATING' or (v_profile.role <> 'DEVELOPER' and v_task.consolidator_id <> v_profile.staff_id) then
      raise exception 'CONSOLIDATION_NOT_OWNED';
    end if;
    update public.owor_consolidation_tasks set status = 'CONSOLIDATED', completed_at = v_now,
      updated_at = v_now, version = version + 1
    where batch_id = p_batch_id and so_number = btrim(p_so_number);
  else
    raise exception 'INVALID_CONSOLIDATE_ACTION';
  end if;

  return public.owor_get_consolidate_tasks(v_batch.scope_code);
end;
$$;

revoke all on function public.owor_get_consolidate_tasks(text) from public, anon;
revoke all on function public.owor_generate_consolidate_tasks(text) from public, anon;
revoke all on function public.owor_apply_consolidate_action(uuid, text, bigint, numeric, text) from public, anon;
grant execute on function public.owor_get_consolidate_tasks(text) to authenticated, service_role;
grant execute on function public.owor_generate_consolidate_tasks(text) to authenticated, service_role;
grant execute on function public.owor_apply_consolidate_action(uuid, text, bigint, numeric, text) to authenticated, service_role;

alter publication supabase_realtime add table public.owor_consolidate_batches;
alter publication supabase_realtime add table public.owor_consolidate_batch_lines;
alter publication supabase_realtime add table public.owor_consolidation_tasks;

commit;
