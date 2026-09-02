begin;

alter table public.owor_hub_wave_config add column if not exists route_code text not null default '';
alter table public.owor_consolidate_rows add column if not exists route_code text not null default '';

create or replace function public.owor_get_consolidate_config(p_scope_code text default 'SRA_L2_UP')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'scope', coalesce((select jsonb_build_object(
      'code', s.scope_code, 'zoneFamily', s.zone_family, 'minLevel', s.min_level,
      'excludedWaves', to_jsonb(s.excluded_waves), 'enabled', s.enabled
    ) from public.owor_consolidate_scopes s where s.scope_code=upper(btrim(coalesce(p_scope_code,'SRA_L2_UP')))), 'null'::jsonb),
    'waveMap', coalesce((select jsonb_object_agg(c.hub_code, jsonb_build_object(
      'waveNumber', c.wave_number, 'routeCode', c.route_code
    ) order by c.hub_code) from public.owor_hub_wave_config c where c.warehouse='CBT' and c.active), '{}'::jsonb)
  );
$$;

create or replace function public.owor_upsert_hub_wave_config(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_written integer := 0;
begin
  if auth.role() <> 'service_role' and not coalesce((select p.role='DEVELOPER' and p.active from public.owor_current_profile() p),false) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows,'[]'::jsonb))=0 or jsonb_array_length(p_rows)>500 then
    raise exception 'Wave map payload must contain 1-500 rows';
  end if;
  update public.owor_hub_wave_config set active=false, updated_at=now() where warehouse='CBT';
  insert into public.owor_hub_wave_config(warehouse,hub_code,wave_number,drop_order,route_code,active)
  select coalesce(nullif(upper(btrim(x.warehouse)),''),'CBT'),upper(btrim(x.hub_code)),x.wave_number,x.drop_order,
    upper(btrim(coalesce(x.route_code,''))),coalesce(x.active,true)
  from jsonb_to_recordset(p_rows) as x(warehouse text,hub_code text,wave_number integer,drop_order integer,route_code text,active boolean)
  where nullif(btrim(x.hub_code),'') is not null and x.wave_number>0
  on conflict(warehouse,hub_code) do update set wave_number=excluded.wave_number,drop_order=excluded.drop_order,
    route_code=excluded.route_code,active=excluded.active,updated_at=now();
  get diagnostics v_written=row_count;
  return v_written;
end;
$$;

create or replace function public.owor_append_consolidate_rows(p_snapshot_id uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare v_written integer:=0;
begin
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb))<>'array' then raise exception 'Rows payload must be an array'; end if;
  if jsonb_array_length(coalesce(p_rows,'[]'::jsonb))>1000 then raise exception 'Append chunk exceeds 1000 rows'; end if;
  if not exists(select 1 from public.owor_consolidate_snapshots where snapshot_id=p_snapshot_id and status='DRAFT') then raise exception 'Draft snapshot not found'; end if;
  insert into public.owor_consolidate_rows(snapshot_id,so_number,destination_name,hub_code,wave_number,route_code,picking_area_name,zone_family,floor_number,origin_rack_name,sku_number,product_name,expiry_date,request_qty)
  select p_snapshot_id,btrim(x.so_number),coalesce(nullif(btrim(x.destination_name),''),'UNKNOWN'),upper(btrim(x.hub_code)),x.wave_number,
    upper(btrim(coalesce(x.route_code,''))),upper(btrim(x.picking_area_name)),upper(btrim(x.zone_family)),x.floor_number,
    coalesce(nullif(upper(btrim(x.origin_rack_name)),''),'UNMAPPED'),btrim(x.sku_number),coalesce(btrim(x.product_name),''),coalesce(btrim(x.expiry_date),''),x.request_qty
  from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(so_number text,destination_name text,hub_code text,wave_number integer,route_code text,picking_area_name text,zone_family text,floor_number integer,origin_rack_name text,sku_number text,product_name text,expiry_date text,request_qty numeric)
  where nullif(btrim(x.so_number),'') is not null and nullif(btrim(x.sku_number),'') is not null and x.wave_number>1 and x.request_qty>0
  on conflict(snapshot_id,so_number,hub_code,wave_number,picking_area_name,origin_rack_name,sku_number,expiry_date)
  do update set request_qty=excluded.request_qty,product_name=excluded.product_name,route_code=excluded.route_code;
  get diagnostics v_written=row_count;
  return v_written;
end;
$$;

create or replace function public.owor_assign_consolidate_picking(p_picker_ids text[],p_waves integer[],p_locations text[],p_scope_code text default 'SRA_L2_UP')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_profile public.owor_user_profiles%rowtype; v_head public.owor_consolidate_head%rowtype;
  v_picker_ids text[]; v_picker text; v_picker_index integer:=0; v_batch_id uuid;
  v_location text; v_location_qty numeric; v_picker_locations text[];
begin
  select * into v_profile from public.owor_user_profiles where user_id=auth.uid() and active;
  if not found or not ('DEVELOPER'=any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
  select array_agg(pid order by ord) into v_picker_ids from (
    select upper(btrim(value)) pid,min(ordinality) ord from unnest(coalesce(p_picker_ids,'{}'::text[])) with ordinality u(value,ordinality)
    where btrim(value)<>'' group by upper(btrim(value))
  ) q;
  if cardinality(v_picker_ids)=0 or cardinality(p_waves)=0 or cardinality(p_locations)=0 then raise exception 'ASSIGNMENT_SELECTION_REQUIRED'; end if;
  if exists(select 1 from unnest(v_picker_ids) pid where not exists(select 1 from public.owor_user_profiles p where p.staff_id=pid and p.active and ('CONSOLIDATE_PICKER'=any(p.roles) or 'DEVELOPER'=any(p.roles)))) then raise exception 'INVALID_PICKER'; end if;
  select * into v_head from public.owor_consolidate_head where scope_code=upper(btrim(coalesce(p_scope_code,'SRA_L2_UP')));
  if not found then raise exception 'SNAPSHOT_NOT_READY'; end if;
  if exists(select 1 from public.owor_consolidate_batches where snapshot_id=v_head.snapshot_id and status<>'READY') then raise exception 'ACTIVE_TASKS_MUST_BE_RESET_FIRST'; end if;
  delete from public.owor_consolidate_batches where snapshot_id=v_head.snapshot_id and status='READY';

  create temporary table if not exists _owor_assignment_plan(location text primary key,picker_id text not null,qty numeric not null) on commit drop;
  truncate _owor_assignment_plan;
  for v_location,v_location_qty in
    select r.origin_rack_name,sum(r.request_qty) qty from public.owor_consolidate_rows r
    where r.snapshot_id=v_head.snapshot_id and r.wave_number=any(p_waves) and r.origin_rack_name=any(p_locations)
    group by r.origin_rack_name order by qty desc,r.origin_rack_name
  loop
    select candidate.picker_id into v_picker from (
      select u.value picker_id,u.ordinality,coalesce(sum(plan.qty),0) assigned_qty
      from unnest(v_picker_ids) with ordinality u(value,ordinality)
      left join _owor_assignment_plan plan on plan.picker_id=u.value
      group by u.value,u.ordinality order by assigned_qty,u.ordinality limit 1
    ) candidate;
    insert into _owor_assignment_plan(location,picker_id,qty) values(v_location,v_picker,v_location_qty);
  end loop;

  foreach v_picker in array v_picker_ids loop
    select array_agg(location order by location) into v_picker_locations from _owor_assignment_plan where picker_id=v_picker;
    if coalesce(cardinality(v_picker_locations),0)=0 then continue; end if;
    v_picker_index:=v_picker_index+1; v_batch_id:=gen_random_uuid();
    insert into public.owor_consolidate_batches(batch_id,snapshot_id,scope_code,batch_code,picking_area_name,status,picker_id,started_at,selected_waves,selected_locations)
    values(v_batch_id,v_head.snapshot_id,v_head.scope_code,regexp_replace(v_head.scope_code,'[^A-Z0-9]+','-','g')||'-'||to_char(v_head.operational_date,'YYYYMMDD')||'-'||lpad(v_picker_index::text,2,'0')||'-'||substr(v_batch_id::text,1,6),
      'ASSIGNED · '||v_picker,'IN_PROGRESS',v_picker,now(),p_waves,v_picker_locations);
    insert into public.owor_consolidate_batch_lines(batch_id,line_no,zone_family,floor_number,origin_rack_name,sku_number,product_name,expiry_date,total_qty,waves,allocations)
    select v_batch_id,row_number() over(order by r.origin_rack_name,r.sku_number,r.expiry_date),r.zone_family,r.floor_number,r.origin_rack_name,r.sku_number,max(r.product_name),
      case when btrim(r.expiry_date)~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then btrim(r.expiry_date)::date else null end,
      sum(r.request_qty),jsonb_agg(distinct r.wave_number order by r.wave_number),
      jsonb_agg(jsonb_build_object('soNumber',r.so_number,'hubCode',r.hub_code,'waveNumber',r.wave_number,'routeCode',r.route_code,'requestQty',r.request_qty) order by r.wave_number,r.hub_code,r.so_number)
    from public.owor_consolidate_rows r where r.snapshot_id=v_head.snapshot_id and r.wave_number=any(p_waves) and r.origin_rack_name=any(v_picker_locations)
    group by r.zone_family,r.floor_number,r.origin_rack_name,r.sku_number,r.expiry_date;
  end loop;
  return public.owor_get_consolidate_tasks(v_head.scope_code);
end;
$$;

revoke all on function public.owor_get_consolidate_config(text),public.owor_upsert_hub_wave_config(jsonb),public.owor_append_consolidate_rows(uuid,jsonb),public.owor_assign_consolidate_picking(text[],integer[],text[],text) from public,anon;
grant execute on function public.owor_get_consolidate_config(text),public.owor_upsert_hub_wave_config(jsonb),public.owor_append_consolidate_rows(uuid,jsonb) to service_role;
grant execute on function public.owor_upsert_hub_wave_config(jsonb),public.owor_assign_consolidate_picking(text[],integer[],text[],text) to authenticated;

commit;
