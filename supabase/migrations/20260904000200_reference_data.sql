-- Stable codes, never fixed UUIDs, connect reference data and Git room data.
insert into public.categories(code,name,sort_order) values
('COMPUTERS','Computers',1),
('NETWORKING','Networking',2),
('CABLES','Cables',3),
('ADAPTERS','Adapters',4),
('PERIPHERALS','Peripherals',5),
('PARTS','Parts',6),
('TOOLS','Tools',7),
('OTHER','Other',8);

insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC','IT Closet',null,'room',false,0);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-L','Left Storage',(select id from public.locations where code='ITC'),'storage_group',false,1);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-R','Right Storage',(select id from public.locations where code='ITC'),'storage_group',false,3);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S1','Shelf 1',(select id from public.locations where code='ITC-L'),'shelf',false,1);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S2','Shelf 2',(select id from public.locations where code='ITC-L'),'shelf',false,2);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S3','Shelf 3',(select id from public.locations where code='ITC-R'),'shelf',false,1);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S4','Shelf 4',(select id from public.locations where code='ITC-R'),'shelf',false,2);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S1A','1A',(select id from public.locations where code='ITC-S1'),'shelf_section',true,1);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S1B','1B',(select id from public.locations where code='ITC-S1'),'shelf_section',true,2);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S1C','1C',(select id from public.locations where code='ITC-S1'),'shelf_section',true,3);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S2A','2A',(select id from public.locations where code='ITC-S2'),'shelf_section',true,1);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S2B','2B',(select id from public.locations where code='ITC-S2'),'shelf_section',true,2);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S2C','2C',(select id from public.locations where code='ITC-S2'),'shelf_section',true,3);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S3A','3A',(select id from public.locations where code='ITC-S3'),'shelf_section',true,1);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S3B','3B',(select id from public.locations where code='ITC-S3'),'shelf_section',true,2);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S3C','3C',(select id from public.locations where code='ITC-S3'),'shelf_section',true,3);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S4A','4A',(select id from public.locations where code='ITC-S4'),'shelf_section',true,1);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S4B','4B',(select id from public.locations where code='ITC-S4'),'shelf_section',true,2);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-S4C','4C',(select id from public.locations where code='ITC-S4'),'shelf_section',true,3);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D01','Drawer 1',(select id from public.locations where code='ITC-L'),'drawer',true,3);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D02','Drawer 2',(select id from public.locations where code='ITC-L'),'drawer',true,4);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D03','Drawer 3',(select id from public.locations where code='ITC-L'),'drawer',true,5);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D04','Drawer 4',(select id from public.locations where code='ITC-L'),'drawer',true,6);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D05','Drawer 5',(select id from public.locations where code='ITC-L'),'drawer',true,7);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D06','Drawer 6',(select id from public.locations where code='ITC-L'),'drawer',true,8);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D07','Drawer 7',(select id from public.locations where code='ITC-R'),'drawer',true,3);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D08','Drawer 8',(select id from public.locations where code='ITC-R'),'drawer',true,4);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D09','Drawer 9',(select id from public.locations where code='ITC-R'),'drawer',true,5);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D10','Drawer 10',(select id from public.locations where code='ITC-R'),'drawer',true,6);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D11','Drawer 11',(select id from public.locations where code='ITC-R'),'drawer',true,7);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-D12','Drawer 12',(select id from public.locations where code='ITC-R'),'drawer',true,8);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-RACK','Server Rack',(select id from public.locations where code='ITC'),'rack',true,2);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-RED','Red Container',(select id from public.locations where code='ITC'),'container',true,4);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-BLACK','Black Container',(select id from public.locations where code='ITC'),'container',true,5);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory,sort_order) values ('ITC-CLEAR','Clear Container',(select id from public.locations where code='ITC'),'container',true,6);

