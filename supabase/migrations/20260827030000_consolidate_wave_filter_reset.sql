begin;

create or replace function public.owor_reset_consolidate_tasks(p_scope_code text default 'SRA_L2_UP')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.owor_user_profiles%rowtype;
  v_scope_code text := upper(btrim(coalesce(p_scope_code, 'SRA_L2_UP')));
  v_deleted integer := 0;
begin
  select * into v_profile
  from public.owor_user_profiles
  where user_id = auth.uid() and active;

  if not found then raise exception 'UNAUTHENTICATED'; end if;
  if v_profile.role <> 'DEVELOPER' then raise exception 'FORBIDDEN'; end if;

  delete from public.owor_consolidate_batches
  where scope_code = v_scope_code;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'ok', true,
    'scopeCode', v_scope_code,
    'deletedBatches', v_deleted,
    'resetBy', v_profile.staff_id
  );
end;
$$;

revoke all on function public.owor_reset_consolidate_tasks(text) from public, anon;
grant execute on function public.owor_reset_consolidate_tasks(text) to authenticated;

commit;
