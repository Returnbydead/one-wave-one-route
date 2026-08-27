begin;

alter table public.owor_user_profiles add column if not exists roles text[];
update public.owor_user_profiles set roles = array[role] where roles is null or cardinality(roles) = 0;
alter table public.owor_user_profiles alter column roles set default array['STAGING_HELPER']::text[];
alter table public.owor_user_profiles alter column roles set not null;
alter table public.owor_user_profiles drop constraint if exists owor_user_profiles_roles_check;
alter table public.owor_user_profiles add constraint owor_user_profiles_roles_check check (
  cardinality(roles) > 0 and roles <@ array['DEVELOPER','STAGING_HELPER','LINE_HELPER','CONSOLIDATE_PICKER','CONSOLIDATOR']::text[]
);

create or replace function public.owor_create_profile_from_auth()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_app text := coalesce(new.raw_app_meta_data ->> 'app', '');
  v_staff_id text := upper(btrim(coalesce(new.raw_app_meta_data ->> 'staff_id', '')));
  v_name text := btrim(coalesce(new.raw_app_meta_data ->> 'name', ''));
  v_roles text[] := coalesce(array(select upper(value) from jsonb_array_elements_text(coalesce(new.raw_app_meta_data -> 'roles', jsonb_build_array(new.raw_app_meta_data ->> 'role')))), array[]::text[]);
begin
  if v_app <> 'owor' then return new; end if;
  if v_staff_id = '' or v_name = '' or cardinality(v_roles) = 0 or not (v_roles <@ array['DEVELOPER','STAGING_HELPER','LINE_HELPER','CONSOLIDATE_PICKER','CONSOLIDATOR']::text[]) then
    raise exception 'invalid OWOR auth metadata';
  end if;
  insert into public.owor_user_profiles(user_id, staff_id, name, role, roles, active)
  values (new.id, v_staff_id, v_name, v_roles[1], v_roles, true)
  on conflict (user_id) do update set staff_id = excluded.staff_id, name = excluded.name,
    role = excluded.role, roles = excluded.roles, active = true, updated_at = now();
  return new;
end;
$$;

create or replace function public.owor_current_access_profile()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('staff_id', staff_id, 'name', name, 'role', role, 'roles', roles, 'active', active)
  from public.owor_user_profiles where user_id = auth.uid() and active limit 1;
$$;
revoke all on function public.owor_current_access_profile() from public, anon;
grant execute on function public.owor_current_access_profile() to authenticated;

alter table public.owor_consolidate_batches add column if not exists selected_waves integer[] not null default '{}'::integer[];
alter table public.owor_consolidate_batches add column if not exists selected_locations text[] not null default '{}'::text[];
alter table public.owor_consolidate_batches drop constraint if exists owor_consolidate_batches_snapshot_id_picking_area_name_key;

create or replace function public.owor_get_consolidate_assignment_options(p_scope_code text default 'SRA_L2_UP')
returns jsonb language sql stable security definer set search_path = public as $$
  with profile as (
    select * from public.owor_user_profiles where user_id = auth.uid() and active and 'DEVELOPER' = any(roles)
  ), head as (
    select h.* from public.owor_consolidate_head h, profile p where h.scope_code = upper(btrim(coalesce(p_scope_code, 'SRA_L2_UP')))
  )
  select jsonb_build_object(
    'ok', exists(select 1 from profile),
    'pickers', coalesce((select jsonb_agg(jsonb_build_object('staffId', staff_id, 'name', name) order by name)
      from public.owor_user_profiles where active and ('CONSOLIDATE_PICKER' = any(roles) or 'DEVELOPER' = any(roles))), '[]'::jsonb),
    'waves', coalesce((select jsonb_agg(w order by w) from (select distinct wave_number w from public.owor_consolidate_rows r join head h on h.snapshot_id=r.snapshot_id) x), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(loc order by loc) from (select distinct origin_rack_name loc from public.owor_consolidate_rows r join head h on h.snapshot_id=r.snapshot_id) x), '[]'::jsonb)
  );
$$;

create or replace function public.owor_assign_consolidate_picking(
  p_picker_ids text[], p_waves integer[], p_locations text[], p_scope_code text default 'SRA_L2_UP'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile public.owor_user_profiles%rowtype;
  v_head public.owor_consolidate_head%rowtype;
  v_picker text;
  v_picker_index integer := 0;
  v_picker_count integer;
  v_batch_id uuid;
begin
  select * into v_profile from public.owor_user_profiles where user_id = auth.uid() and active;
  if not found or not ('DEVELOPER' = any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
  v_picker_count := cardinality(p_picker_ids);
  if v_picker_count is null or v_picker_count = 0 or cardinality(p_waves) = 0 or cardinality(p_locations) = 0 then raise exception 'ASSIGNMENT_SELECTION_REQUIRED'; end if;
  select * into v_head from public.owor_consolidate_head where scope_code = upper(btrim(coalesce(p_scope_code, 'SRA_L2_UP')));
  if not found then raise exception 'SNAPSHOT_NOT_READY'; end if;
  if exists(select 1 from public.owor_consolidate_batches where snapshot_id=v_head.snapshot_id and status <> 'READY') then raise exception 'ACTIVE_TASKS_MUST_BE_RESET_FIRST'; end if;
  delete from public.owor_consolidate_batches where snapshot_id=v_head.snapshot_id and status='READY';

  foreach v_picker in array p_picker_ids loop
    v_picker_index := v_picker_index + 1;
    if not exists(select 1 from public.owor_user_profiles where staff_id=upper(btrim(v_picker)) and active and ('CONSOLIDATE_PICKER'=any(roles) or 'DEVELOPER'=any(roles))) then raise exception 'INVALID_PICKER_%', v_picker; end if;
    v_batch_id := gen_random_uuid();
    insert into public.owor_consolidate_batches(batch_id,snapshot_id,scope_code,batch_code,picking_area_name,status,picker_id,started_at,selected_waves,selected_locations)
    values(v_batch_id,v_head.snapshot_id,v_head.scope_code,
      regexp_replace(v_head.scope_code,'[^A-Z0-9]+','-','g')||'-'||to_char(v_head.operational_date,'YYYYMMDD')||'-'||lpad(v_picker_index::text,2,'0')||'-'||substr(v_batch_id::text,1,6),
      'ASSIGNED · '||upper(btrim(v_picker)),'IN_PROGRESS',upper(btrim(v_picker)),now(),p_waves,
      array(select location from (select unnest(p_locations) location, row_number() over() rn) q where mod(rn-1,v_picker_count)=v_picker_index-1));

    insert into public.owor_consolidate_batch_lines(batch_id,line_no,zone_family,floor_number,origin_rack_name,sku_number,product_name,expiry_date,total_qty,waves,allocations)
    select v_batch_id, row_number() over(order by r.origin_rack_name,r.sku_number,r.expiry_date), r.zone_family,r.floor_number,r.origin_rack_name,r.sku_number,max(r.product_name),
      case when btrim(r.expiry_date) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then btrim(r.expiry_date)::date else null end,
      sum(r.request_qty),jsonb_agg(distinct r.wave_number order by r.wave_number),
      jsonb_agg(jsonb_build_object('soNumber',r.so_number,'hubCode',r.hub_code,'waveNumber',r.wave_number,'requestQty',r.request_qty) order by r.wave_number,r.hub_code,r.so_number)
    from public.owor_consolidate_rows r
    where r.snapshot_id=v_head.snapshot_id and r.wave_number=any(p_waves)
      and r.origin_rack_name=any(array(select location from (select unnest(p_locations) location,row_number() over() rn) q where mod(rn-1,v_picker_count)=v_picker_index-1))
    group by r.zone_family,r.floor_number,r.origin_rack_name,r.sku_number,r.expiry_date;
  end loop;
  return public.owor_get_consolidate_tasks(v_head.scope_code);
end;
$$;

create or replace function public.owor_confirm_consolidate_pick(p_batch_id uuid,p_line_id bigint,p_sku text,p_qty numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_profile public.owor_user_profiles%rowtype; v_batch public.owor_consolidate_batches%rowtype; v_line public.owor_consolidate_batch_lines%rowtype; v_next numeric;
begin
  select * into v_profile from public.owor_user_profiles where user_id=auth.uid() and active;
  if not found or not ('DEVELOPER'=any(v_profile.roles) or 'CONSOLIDATE_PICKER'=any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
  select * into v_batch from public.owor_consolidate_batches where batch_id=p_batch_id for update;
  if not found or v_batch.status<>'IN_PROGRESS' or (not ('DEVELOPER'=any(v_profile.roles)) and v_batch.picker_id<>v_profile.staff_id) then raise exception 'BATCH_NOT_OWNED'; end if;
  select * into v_line from public.owor_consolidate_batch_lines where batch_id=p_batch_id and line_id=p_line_id for update;
  if not found then raise exception 'PICK_LINE_NOT_FOUND'; end if;
  if upper(btrim(coalesce(p_sku,'')))<>upper(btrim(v_line.sku_number)) then raise exception 'SKU_MISMATCH'; end if;
  if p_qty is null or p_qty<=0 then raise exception 'PICK_QTY_INVALID'; end if;
  v_next:=v_line.picked_qty+p_qty;
  if v_next>v_line.total_qty then raise exception 'PICK_QTY_EXCEEDS_TARGET'; end if;
  update public.owor_consolidate_batch_lines set picked_qty=v_next,status=case when v_next=total_qty then 'DONE' else 'READY' end,updated_at=now() where line_id=p_line_id;
  return public.owor_get_consolidate_tasks(v_batch.scope_code);
end;
$$;

create or replace function public.owor_apply_consolidate_action(
  p_batch_id uuid,p_action text,p_line_id bigint default null,p_qty numeric default null,p_so_number text default ''
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_profile public.owor_user_profiles%rowtype; v_batch public.owor_consolidate_batches%rowtype; v_task public.owor_consolidation_tasks%rowtype; v_action text:=upper(btrim(coalesce(p_action,''))); v_now timestamptz:=now();
begin
  select * into v_profile from public.owor_user_profiles where user_id=auth.uid() and active;
  if not found then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_batch from public.owor_consolidate_batches where batch_id=p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_action='CLAIM_PICKING' then
    if not ('DEVELOPER'=any(v_profile.roles) or 'CONSOLIDATE_PICKER'=any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
    if v_batch.status<>'READY' or (v_batch.picker_id<>'' and v_batch.picker_id<>v_profile.staff_id and not ('DEVELOPER'=any(v_profile.roles))) then raise exception 'BATCH_NOT_READY'; end if;
    update public.owor_consolidate_batches set status='IN_PROGRESS',picker_id=v_profile.staff_id,started_at=v_now,updated_at=v_now,version=version+1 where batch_id=p_batch_id;
  elsif v_action='COMPLETE_PICKING' then
    if not ('DEVELOPER'=any(v_profile.roles) or 'CONSOLIDATE_PICKER'=any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
    if v_batch.status<>'IN_PROGRESS' or (not ('DEVELOPER'=any(v_profile.roles)) and v_batch.picker_id<>v_profile.staff_id) then raise exception 'BATCH_NOT_OWNED'; end if;
    if exists(select 1 from public.owor_consolidate_batch_lines where batch_id=p_batch_id and status<>'DONE') then raise exception 'PICK_ROWS_INCOMPLETE'; end if;
    update public.owor_consolidate_batches set status='PICKING_COMPLETED',completed_at=v_now,updated_at=v_now,version=version+1 where batch_id=p_batch_id;
    insert into public.owor_consolidation_tasks(batch_id,so_number,hub_code,wave_number,expected_qty,allocations)
    select p_batch_id,a.value->>'soNumber',max(a.value->>'hubCode'),max((a.value->>'waveNumber')::integer),sum((a.value->>'requestQty')::numeric),
      jsonb_agg(jsonb_build_object('lineId',l.line_id,'skuNumber',l.sku_number,'productName',l.product_name,'requestQty',(a.value->>'requestQty')::numeric) order by l.line_no)
    from public.owor_consolidate_batch_lines l cross join lateral jsonb_array_elements(l.allocations) a(value) where l.batch_id=p_batch_id group by a.value->>'soNumber'
    on conflict(batch_id,so_number) do nothing;
  elsif v_action='CLAIM_CONSOLIDATION' then
    if not ('DEVELOPER'=any(v_profile.roles) or 'CONSOLIDATOR'=any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
    if v_batch.status<>'PICKING_COMPLETED' then raise exception 'PICKING_NOT_COMPLETED'; end if;
    select * into v_task from public.owor_consolidation_tasks where batch_id=p_batch_id and so_number=btrim(p_so_number) for update;
    if not found or v_task.status<>'READY' then raise exception 'CONSOLIDATION_NOT_READY'; end if;
    update public.owor_consolidation_tasks set status='CONSOLIDATING',consolidator_id=v_profile.staff_id,started_at=v_now,updated_at=v_now,version=version+1 where batch_id=p_batch_id and so_number=btrim(p_so_number);
  elsif v_action='COMPLETE_CONSOLIDATION' then
    if not ('DEVELOPER'=any(v_profile.roles) or 'CONSOLIDATOR'=any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
    select * into v_task from public.owor_consolidation_tasks where batch_id=p_batch_id and so_number=btrim(p_so_number) for update;
    if not found or v_task.status<>'CONSOLIDATING' or (not ('DEVELOPER'=any(v_profile.roles)) and v_task.consolidator_id<>v_profile.staff_id) then raise exception 'CONSOLIDATION_NOT_OWNED'; end if;
    update public.owor_consolidation_tasks set status='CONSOLIDATED',completed_at=v_now,updated_at=v_now,version=version+1 where batch_id=p_batch_id and so_number=btrim(p_so_number);
  else raise exception 'INVALID_CONSOLIDATE_ACTION'; end if;
  return public.owor_get_consolidate_tasks(v_batch.scope_code);
end;
$$;

revoke all on function public.owor_get_consolidate_assignment_options(text) from public,anon;
revoke all on function public.owor_assign_consolidate_picking(text[],integer[],text[],text) from public,anon;
revoke all on function public.owor_confirm_consolidate_pick(uuid,bigint,text,numeric) from public,anon;
grant execute on function public.owor_get_consolidate_assignment_options(text), public.owor_assign_consolidate_picking(text[],integer[],text[],text), public.owor_confirm_consolidate_pick(uuid,bigint,text,numeric) to authenticated;

commit;
