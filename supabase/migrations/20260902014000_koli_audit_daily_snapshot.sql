begin;

alter table public.owor_koli_audit_tasks add column if not exists operational_date date not null default (timezone('Asia/Jakarta',now())::date);
alter table public.owor_koli_audit_tasks add column if not exists source_synced_at timestamptz not null default now();
alter table public.owor_koli_audit_tasks drop constraint if exists owor_koli_audit_tasks_koli_code_so_number_key;
alter table public.owor_koli_audit_tasks drop constraint if exists owor_koli_audit_tasks_operational_date_koli_code_so_number_key;
alter table public.owor_koli_audit_tasks add constraint owor_koli_audit_tasks_operational_date_koli_code_so_number_key unique(operational_date,koli_code,so_number);
create index if not exists owor_koli_audit_tasks_date_idx on public.owor_koli_audit_tasks(operational_date desc,hub_code,status);

create or replace function public.owor_publish_koli_audit_snapshot(p_operational_date date,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_tasks integer:=0; v_lines integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'FORBIDDEN'; end if;
  if p_operational_date is null or jsonb_typeof(coalesce(p_rows,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_rows,'[]'::jsonb))>100000 then raise exception 'INVALID_KOLI_SNAPSHOT'; end if;
  with source as (
    select distinct upper(btrim(x.koli_code)) koli_code,btrim(x.so_number) so_number,
      upper(btrim(coalesce(x.destination_location_id,''))) hub_code,
      upper(btrim(coalesce(x.source_status,''))) source_status
    from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) x(koli_code text,so_number text,destination_location_id text,source_status text,sku text,product_name text,expected_qty numeric)
    where nullif(btrim(x.koli_code),'') is not null and nullif(btrim(x.so_number),'') is not null
  )
  insert into public.owor_koli_audit_tasks(operational_date,koli_code,so_number,hub_code,destination_name,source_status,source_synced_at)
  select p_operational_date,koli_code,so_number,hub_code,hub_code,source_status,now() from source
  on conflict(operational_date,koli_code,so_number) do update set hub_code=excluded.hub_code,destination_name=excluded.destination_name,
    source_status=excluded.source_status,source_synced_at=now(),updated_at=case when owor_koli_audit_tasks.status='READY' then now() else owor_koli_audit_tasks.updated_at end;
  get diagnostics v_tasks=row_count;

  with source as (
    select upper(btrim(x.koli_code)) koli_code,btrim(x.so_number) so_number,btrim(x.sku) sku,
      max(btrim(coalesce(x.product_name,''))) product_name,sum(greatest(coalesce(x.expected_qty,0),0)) expected_qty
    from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) x(koli_code text,so_number text,destination_location_id text,source_status text,sku text,product_name text,expected_qty numeric)
    where nullif(btrim(x.koli_code),'') is not null and nullif(btrim(x.so_number),'') is not null and nullif(btrim(x.sku),'') is not null
    group by upper(btrim(x.koli_code)),btrim(x.so_number),btrim(x.sku)
  )
  insert into public.owor_koli_audit_lines(task_id,sku,product_name,expected_qty)
  select t.task_id,s.sku,s.product_name,s.expected_qty from source s join public.owor_koli_audit_tasks t
    on t.operational_date=p_operational_date and t.koli_code=s.koli_code and t.so_number=s.so_number
  on conflict(task_id,sku) do update set product_name=excluded.product_name,expected_qty=excluded.expected_qty
    where exists(select 1 from public.owor_koli_audit_tasks t where t.task_id=owor_koli_audit_lines.task_id and t.status='READY');
  get diagnostics v_lines=row_count;
  return jsonb_build_object('ok',true,'tasks',v_tasks,'lines',v_lines,'operationalDate',p_operational_date);
end;
$$;

create or replace function public.owor_get_koli_audit_tasks(p_search text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_profile public.owor_user_profiles%rowtype;
begin
  select * into v_profile from public.owor_user_profiles where user_id=auth.uid() and active;
  if not found or not ('AUDITOR'=any(v_profile.roles) or 'DEVELOPER'=any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'taskId',t.task_id,'koliCode',t.koli_code,'soNumber',t.so_number,'hubCode',t.hub_code,
    'destinationName',t.destination_name,'sourceStatus',t.source_status,'status',t.status,'auditorId',t.auditor_id,
    'discrepancyConfirmed',t.discrepancy_confirmed,'discrepancyNote',t.discrepancy_note,'updatedAt',t.updated_at,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('lineId',l.line_id,'sku',l.sku,'productName',l.product_name,'expectedQty',l.expected_qty,'auditedQty',l.audited_qty) order by l.line_id) from public.owor_koli_audit_lines l where l.task_id=t.task_id),'[]'::jsonb)
  ) order by t.updated_at desc) from public.owor_koli_audit_tasks t
  where t.operational_date=timezone('Asia/Jakarta',now())::date and (p_search='' or lower(t.koli_code||' '||t.so_number||' '||t.destination_name) like '%'||lower(btrim(p_search))||'%')),'[]'::jsonb);
end;
$$;

revoke all on function public.owor_publish_koli_audit_snapshot(date,jsonb),public.owor_get_koli_audit_tasks(text) from public,anon;
grant execute on function public.owor_publish_koli_audit_snapshot(date,jsonb) to service_role;
grant execute on function public.owor_get_koli_audit_tasks(text) to authenticated;

commit;
