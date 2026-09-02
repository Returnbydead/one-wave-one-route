begin;

update public.owor_hub_wave_config set active=false,updated_at=now() where warehouse='CBT';

insert into public.owor_hub_wave_config(warehouse,hub_code,wave_number,drop_order,route_code,active)
values
('CBT','PKC',1,1,'PKC - PAM',true),('CBT','PAM',1,2,'PKC - PAM',true),
('CBT','CSA',1,1,'CSA - KLD',true),('CBT','KLD',1,2,'CSA - KLD',true),('CBT','BSX',1,1,'BSX',true),
('CBT','ASA',1,1,'ASA - JBG',true),('CBT','JBG',1,2,'ASA - JBG',true),('CBT','SMN',1,1,'SMN - MRY',true),('CBT','MRY',1,2,'SMN - MRY',true),
('CBT','CPT',1,1,'CPT - PPL',true),('CBT','PPL',1,2,'CPT - PPL',true),('CBT','MSB',1,1,'MSB',true),
('CBT','SLP',1,1,'SLP - RDS',true),('CBT','RDS',1,2,'SLP - RDS',true),('CBT','JLB',1,1,'JLB',true),
('CBT','BDC',1,1,'BDC - BGS',true),('CBT','BGS',1,2,'BDC - BGS',true),('CBT','PPN',1,1,'PPN - TAP',true),('CBT','TAP',1,2,'PPN - TAP',true),
('CBT','BS9',2,1,'BS9 - SRP',true),('CBT','SRP',2,2,'BS9 - SRP',true),('CBT','PBT',2,1,'PBT',true),
('CBT','PGD',2,1,'PGD - KLN',true),('CBT','KLN',2,2,'PGD - KLN',true),('CBT','CWG',2,1,'CWG',true),('CBT','CNR',2,1,'CNR',true),('CBT','GPL',2,1,'GPL',true),
('CBT','TGX',2,1,'TGX - CT2',true),('CBT','CT2',2,2,'TGX - CT2',true),('CBT','LBB',2,1,'LBB - CLN - PIN',true),('CBT','CLN',2,2,'LBB - CLN - PIN',true),('CBT','PIN',2,3,'LBB - CLN - PIN',true),
('CBT','MTG',2,1,'MTG - GMD',true),('CBT','GMD',2,2,'MTG - GMD',true),('CBT','LIM',2,1,'LIM - MRG - CGS',true),('CBT','MRG',2,2,'LIM - MRG - CGS',true),('CBT','CGS',2,3,'LIM - MRG - CGS',true),
('CBT','SWL',3,1,'SWL - PSG - (CNR RIT 2)',true),('CBT','PSG',3,2,'SWL - PSG - (CNR RIT 2)',true),('CBT','CNR RIT 2',3,3,'SWL - PSG - (CNR RIT 2)',true),
('CBT','TDN',3,1,'TDN - FTW',true),('CBT','FTW',3,2,'TDN - FTW',true),('CBT','PLB',3,1,'PLB - KPM',true),('CBT','KPM',3,2,'PLB - KPM',true),
('CBT','SWG',3,1,'SWG - BBK',true),('CBT','BBK',3,2,'SWG - BBK',true),('CBT','BRY',3,1,'BRY - APR',true),('CBT','APR',3,2,'BRY - APR',true),
('CBT','MGR',3,1,'MGR - KGS',true),('CBT','KGS',3,2,'MGR - KGS',true),('CBT','JTI',3,1,'JTI',true),('CBT','TSY',3,1,'TSY',true),('CBT','DST',3,1,'DST',true),
('CBT','DNS',4,1,'DNS',true),('CBT','BKJ',4,1,'BKJ',true),('CBT','SAL',4,1,'SAL',true),('CBT','KJT',4,1,'KJT',true),
('CBT','CAM',4,1,'CAM',true),('CBT','HBD',4,1,'HBD',true),('CBT','GWB',4,1,'GWB',true),('CBT','PHW',4,1,'PHW',true)
on conflict(warehouse,hub_code) do update set wave_number=excluded.wave_number,drop_order=excluded.drop_order,route_code=excluded.route_code,active=true,updated_at=now();

commit;
