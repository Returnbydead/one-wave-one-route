begin;

-- Route changes do not rewrite an already-published consolidate snapshot.
-- Reconcile only the currently visible snapshot; historical snapshots remain immutable.
delete from public.owor_consolidate_rows r
using public.owor_consolidate_head h, public.owor_hub_wave_config c
where r.snapshot_id=h.snapshot_id
  and c.warehouse='CBT' and c.active and c.hub_code=r.hub_code
  and c.wave_number=1;

update public.owor_consolidate_rows r
set wave_number=c.wave_number,route_code=c.route_code
from public.owor_consolidate_head h,public.owor_hub_wave_config c
where r.snapshot_id=h.snapshot_id
  and c.warehouse='CBT' and c.active and c.hub_code=r.hub_code
  and c.wave_number>1
  and (r.wave_number<>c.wave_number or r.route_code is distinct from c.route_code);

update public.owor_consolidate_snapshots s
set row_count=x.row_count,so_count=x.so_count,checksum='',
  metadata=coalesce(s.metadata,'{}'::jsonb)||jsonb_build_object('route_reconciled_at',now(),'route_source','PLAN CBT SEP 2026')
from (
  select h.snapshot_id,count(r.*)::integer row_count,count(distinct r.so_number)::integer so_count
  from public.owor_consolidate_head h left join public.owor_consolidate_rows r on r.snapshot_id=h.snapshot_id
  group by h.snapshot_id
) x where s.snapshot_id=x.snapshot_id;

update public.owor_consolidate_head h
set row_count=x.row_count,so_count=x.so_count,checksum='',updated_at=now()
from (
  select h2.snapshot_id,count(r.*)::integer row_count,count(distinct r.so_number)::integer so_count
  from public.owor_consolidate_head h2 left join public.owor_consolidate_rows r on r.snapshot_id=h2.snapshot_id
  group by h2.snapshot_id
) x where h.snapshot_id=x.snapshot_id;

commit;
