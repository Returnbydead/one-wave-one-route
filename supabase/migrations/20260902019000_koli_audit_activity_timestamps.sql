begin;

create or replace function public.owor_get_koli_audit_tasks(p_search text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_profile public.owor_user_profiles%rowtype;
begin
  select * into v_profile from public.owor_user_profiles where user_id=auth.uid() and active;
  if not found or not ('AUDITOR'=any(v_profile.roles) or 'DEVELOPER'=any(v_profile.roles)) then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'taskId',t.task_id,'koliCode',t.koli_code,'soNumber',t.so_number,'hubCode',t.hub_code,
    'destinationName',t.destination_name,'sourceStatus',t.source_status,'status',t.status,'auditorId',t.auditor_id,
    'startedAt',t.started_at,'completedAt',t.completed_at,'updatedAt',t.updated_at,
    'discrepancyConfirmed',t.discrepancy_confirmed,'discrepancyNote',t.discrepancy_note,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('lineId',l.line_id,'sku',l.sku,'productName',l.product_name,'expectedQty',l.expected_qty,'auditedQty',l.audited_qty,'confirmedAt',l.confirmed_at) order by l.line_id) from public.owor_koli_audit_lines l where l.task_id=t.task_id),'[]'::jsonb)
  ) order by t.updated_at desc) from (
    select * from public.owor_koli_audit_tasks
    where (p_search='' or lower(koli_code||' '||so_number||' '||destination_name) like '%'||lower(btrim(p_search))||'%')
    order by updated_at desc limit 500
  ) t),'[]'::jsonb);
end;
$$;

grant execute on function public.owor_get_koli_audit_tasks(text) to authenticated;
commit;
