alter table public.owor_koli_audit_tasks add column if not exists hub_code text not null default '';
create index if not exists owor_koli_audit_tasks_hub_idx on public.owor_koli_audit_tasks(hub_code, status, updated_at desc);
