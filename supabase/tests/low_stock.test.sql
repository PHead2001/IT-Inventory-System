begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_column('public','quantity_items','reorder_threshold','threshold column exists');
select col_type_is('public','quantity_items','reorder_threshold','integer','threshold is an integer');
select col_is_null('public','quantity_items','reorder_threshold','threshold defaults to null');
select ok((select reloptions @> array['security_invoker=true'] from pg_class
 where oid='public.inventory_search_rows'::regclass),'search projection invokes caller RLS');
select has_function('public','inventory_search_v2',array['text','text','text','uuid','text','integer','integer','boolean'],'filtered search signature');
select has_function('public','low_stock_dashboard',array['integer','integer'],'dashboard signature');
select has_function('public','inventory_export_snapshot',array['text','text','text','uuid','text','boolean','text'],'export signature');
select ok(not has_function_privilege('anon',fn,'EXECUTE'),'anonymous cannot invoke '||fn)
from (values
 ('public.inventory_search_v2(text,text,text,uuid,text,integer,integer,boolean)'),
 ('public.low_stock_dashboard(integer,integer)'),
 ('public.inventory_export_snapshot(text,text,text,uuid,text,boolean,text)')) f(fn);
select ok(has_function_privilege('authenticated',fn,'EXECUTE'),'authenticated may invoke '||fn)
from (values
 ('public.inventory_search_v2(text,text,text,uuid,text,integer,integer,boolean)'),
 ('public.low_stock_dashboard(integer,integer)'),
 ('public.inventory_export_snapshot(text,text,text,uuid,text,boolean,text)')) f(fn);
select ok(not p.prosecdef,'read RPC is invoker: '||p.proname)
from pg_proc p where p.oid in (
 'public.inventory_search_v2(text,text,text,uuid,text,integer,integer,boolean)'::regprocedure,
 'public.low_stock_dashboard(integer,integer)'::regprocedure,
 'public.inventory_export_snapshot(text,text,text,uuid,text,boolean,text)'::regprocedure);
select ok(not has_table_privilege('authenticated','public.quantity_items','UPDATE'),
 'authenticated cannot directly set thresholds');

select * from finish();
rollback;
