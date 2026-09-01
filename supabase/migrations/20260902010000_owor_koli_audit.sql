-- Outbound koli audit: one task per koli, with an immutable expected snapshot
-- and append-only audit confirmations. Source rows are populated by the
-- fact_supply_order_item_details sync function.
create table if not exists public.owor_koli_audit_tasks (
  task_id uuid primary key default gen_random_uuid(),
  koli_code text not null,
  so_number text not null,
  hub_code text not null default '',
  destination_name text not null default '',
  source_status text not null default '',
  status text not null default 'READY' check (status in ('READY','IN_PROGRESS','COMPLETED')),
  auditor_id text not null default '',
  discrepancy_confirmed boolean not null default false,
  discrepancy_note text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(koli_code, so_number)
);

create table if not exists public.owor_koli_audit_lines (
  line_id bigint generated always as identity primary key,
  task_id uuid not null references public.owor_koli_audit_tasks(task_id) on delete cascade,
  sku text not null,
  product_name text not null default '',
  expected_qty numeric not null default 0 check (expected_qty >= 0),
  audited_qty numeric check (audited_qty is null or audited_qty >= 0),
  confirmed_by text not null default '',
  confirmed_at timestamptz,
  unique(task_id, sku)
);

create index if not exists owor_koli_audit_tasks_status_idx on public.owor_koli_audit_tasks(status, updated_at desc);
create index if not exists owor_koli_audit_tasks_koli_idx on public.owor_koli_audit_tasks(koli_code);
create index if not exists owor_koli_audit_lines_task_idx on public.owor_koli_audit_lines(task_id, line_id);

alter table public.owor_koli_audit_tasks enable row level security;
alter table public.owor_koli_audit_lines enable row level security;
drop policy if exists owor_koli_audit_tasks_read on public.owor_koli_audit_tasks;
drop policy if exists owor_koli_audit_lines_read on public.owor_koli_audit_lines;
create policy owor_koli_audit_tasks_read on public.owor_koli_audit_tasks for select to authenticated
  using (exists (select 1 from public.owor_user_profiles p where p.user_id = auth.uid() and p.active and (p.roles && array['AUDITOR','DEVELOPER']::text[])));
create policy owor_koli_audit_lines_read on public.owor_koli_audit_lines for select to authenticated
  using (exists (select 1 from public.owor_user_profiles p where p.user_id = auth.uid() and p.active and (p.roles && array['AUDITOR','DEVELOPER']::text[])));
revoke all on public.owor_koli_audit_tasks, public.owor_koli_audit_lines from anon, authenticated;
grant select on public.owor_koli_audit_tasks, public.owor_koli_audit_lines to authenticated;

create or replace function public.owor_get_koli_audit_tasks(p_search text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.owor_user_profiles%rowtype;
begin
  select * into v_profile from public.owor_user_profiles where user_id = auth.uid() and active;
  if not found or not ('AUDITOR' = any(v_profile.roles) or 'DEVELOPER' = any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'taskId', t.task_id, 'koliCode', t.koli_code, 'soNumber', t.so_number,
    'hubCode', t.hub_code, 'destinationName', t.destination_name, 'sourceStatus', t.source_status,
    'status', t.status, 'auditorId', t.auditor_id, 'discrepancyConfirmed', t.discrepancy_confirmed,
    'discrepancyNote', t.discrepancy_note, 'updatedAt', t.updated_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('lineId', l.line_id, 'sku', l.sku, 'productName', l.product_name, 'expectedQty', l.expected_qty, 'auditedQty', l.audited_qty) order by l.line_id) from public.owor_koli_audit_lines l where l.task_id=t.task_id), '[]'::jsonb)
  ) order by t.updated_at desc) from public.owor_koli_audit_tasks t where p_search = '' or lower(t.koli_code || ' ' || t.so_number || ' ' || t.destination_name) like '%' || lower(btrim(p_search)) || '%'), '[]'::jsonb);
end; $$;

create or replace function public.owor_claim_koli_audit(p_task_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.owor_user_profiles%rowtype; v_task public.owor_koli_audit_tasks%rowtype;
begin
  select * into v_profile from public.owor_user_profiles where user_id=auth.uid() and active;
  if not found or not ('AUDITOR'=any(v_profile.roles) or 'DEVELOPER'=any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
  select * into v_task from public.owor_koli_audit_tasks where task_id=p_task_id for update;
  if not found or (v_task.status <> 'READY' and v_task.auditor_id <> v_profile.staff_id) then raise exception 'TASK_NOT_READY'; end if;
  update public.owor_koli_audit_tasks set status='IN_PROGRESS', auditor_id=v_profile.staff_id, started_at=coalesce(started_at, now()), updated_at=now() where task_id=p_task_id;
  return jsonb_build_object('ok',true);
end; $$;

create or replace function public.owor_confirm_koli_audit_line(p_task_id uuid, p_line_id bigint, p_qty numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.owor_user_profiles%rowtype; v_task public.owor_koli_audit_tasks%rowtype;
begin
  select * into v_profile from public.owor_user_profiles where user_id=auth.uid() and active;
  if not found or not ('AUDITOR'=any(v_profile.roles) or 'DEVELOPER'=any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
  select * into v_task from public.owor_koli_audit_tasks where task_id=p_task_id for update;
  if not found or v_task.status <> 'IN_PROGRESS' or (v_profile.role <> 'DEVELOPER' and v_task.auditor_id <> v_profile.staff_id) then raise exception 'TASK_NOT_OWNED'; end if;
  update public.owor_koli_audit_lines set audited_qty=p_qty, confirmed_by=v_profile.staff_id, confirmed_at=now() where task_id=p_task_id and line_id=p_line_id;
  if not found then raise exception 'LINE_NOT_FOUND'; end if;
  update public.owor_koli_audit_tasks set updated_at=now() where task_id=p_task_id;
  return jsonb_build_object('ok',true);
end; $$;

create or replace function public.owor_complete_koli_audit(p_task_id uuid, p_discrepancy_confirmed boolean default false, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_profile public.owor_user_profiles%rowtype; v_task public.owor_koli_audit_tasks%rowtype;
begin
  select * into v_profile from public.owor_user_profiles where user_id=auth.uid() and active;
  if not found or not ('AUDITOR'=any(v_profile.roles) or 'DEVELOPER'=any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
  select * into v_task from public.owor_koli_audit_tasks where task_id=p_task_id for update;
  if not found or v_task.status <> 'IN_PROGRESS' or (v_profile.role <> 'DEVELOPER' and v_task.auditor_id <> v_profile.staff_id) then raise exception 'TASK_NOT_OWNED'; end if;
  if exists(select 1 from public.owor_koli_audit_lines where task_id=p_task_id and audited_qty is null) then raise exception 'AUDIT_LINES_INCOMPLETE'; end if;
  if exists(select 1 from public.owor_koli_audit_lines where task_id=p_task_id and audited_qty <> expected_qty) and not coalesce(p_discrepancy_confirmed,false) then raise exception 'DISCREPANCY_CONFIRM_REQUIRED'; end if;
  update public.owor_koli_audit_tasks set status='COMPLETED', discrepancy_confirmed=coalesce(p_discrepancy_confirmed,false), discrepancy_note=left(coalesce(p_note,''),500), completed_at=now(), updated_at=now() where task_id=p_task_id;
  return jsonb_build_object('ok',true);
end; $$;

revoke all on function public.owor_get_koli_audit_tasks(text), public.owor_claim_koli_audit(uuid), public.owor_confirm_koli_audit_line(uuid,bigint,numeric), public.owor_complete_koli_audit(uuid,boolean,text) from public, anon;
grant execute on function public.owor_get_koli_audit_tasks(text), public.owor_claim_koli_audit(uuid), public.owor_confirm_koli_audit_line(uuid,bigint,numeric), public.owor_complete_koli_audit(uuid,boolean,text) to authenticated;
