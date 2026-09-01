alter table public.owor_user_profiles drop constraint if exists owor_user_profiles_roles_check;
alter table public.owor_user_profiles add constraint owor_user_profiles_roles_check check (
  cardinality(roles) > 0 and roles <@ array['DEVELOPER','STAGING_HELPER','LINE_HELPER','CONSOLIDATE_PICKER','CONSOLIDATOR','AUDITOR']::text[]
);
alter table public.owor_user_profiles drop constraint if exists owor_user_profiles_role_check;
alter table public.owor_user_profiles add constraint owor_user_profiles_role_check check (role in ('DEVELOPER','STAGING_HELPER','LINE_HELPER','CONSOLIDATE_PICKER','CONSOLIDATOR','AUDITOR'));
create or replace function public.owor_create_profile_from_auth()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_staff_id text := upper(btrim(coalesce(new.raw_app_meta_data ->> 'staff_id', ''))); v_name text := btrim(coalesce(new.raw_app_meta_data ->> 'name', '')); v_roles text[] := coalesce(array(select upper(value) from jsonb_array_elements_text(coalesce(new.raw_app_meta_data -> 'roles', jsonb_build_array(new.raw_app_meta_data ->> 'role'))) where upper(value) in ('DEVELOPER','STAGING_HELPER','LINE_HELPER','CONSOLIDATE_PICKER','CONSOLIDATOR','AUDITOR')), array[]::text[]);
begin
  if v_staff_id='' or v_name='' or cardinality(v_roles)=0 then raise exception 'Invalid OWOR profile metadata'; end if;
  insert into public.owor_user_profiles(user_id,staff_id,name,role,roles,active) values(new.id,v_staff_id,v_name,v_roles[1],v_roles,true)
  on conflict(user_id) do update set staff_id=excluded.staff_id,name=excluded.name,role=excluded.role,roles=excluded.roles,active=true,updated_at=now();
  return new;
end; $$;
