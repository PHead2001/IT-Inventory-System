-- U403 authoritative publication paths. All trusted legacy fixtures disappear.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create function pg_temp.choice_publication(change_kind text, route text default 'modern') returns text
language plpgsql as $$
declare category uuid:=gen_random_uuid(); revision uuid:=gen_random_uuid(); field uuid:=gen_random_uuid();
  actor uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); event uuid:=gen_random_uuid();
  proposal jsonb; baseline jsonb; choices jsonb; original text; answers jsonb; old_event jsonb;
  original_event text; original_options text;
  current_id uuid; payload jsonb; response jsonb; review_token_uuid uuid; expired_review_count integer;
  draft uuid; request uuid:=gen_random_uuid();
  outcome text; before_state jsonb; after_state jsonb; prior_claims text; review_reasons jsonb;
begin
  begin
    insert into auth.users(id,email) values(actor,'choice-publication-'||actor::text||'@example.test');
    insert into public.app_members(user_id,display_name,role,active,can_manage_configuration)
      values(actor,'Choice publication maintainer','staff',true,true);
    insert into public.categories(id,code,name) values(category,'CHOICE-'||upper(replace(category::text,'-','')),'Choice publication '||category::text);
    select draft_definition into baseline from public.category_form_revisions where category_id is null and status='published';
    choices:='[
      {"id":"00000000-0000-4000-8000-000000000001","label":"Parent","active":true},
      {"id":"00000000-0000-4000-8000-000000000002","label":"Other parent","active":true},
      {"id":"00000000-0000-4000-8000-000000000003","label":" Same ","active":true,"parent_id":"00000000-0000-4000-8000-000000000001"},
      {"id":"00000000-0000-4000-8000-000000000004","label":"same","active":true,"parent_id":"00000000-0000-4000-8000-000000000001"},
      {"id":"00000000-0000-4000-8000-000000000005","label":"Shared","active":true,"parent_id":"00000000-0000-4000-8000-000000000001"},
      {"id":"00000000-0000-4000-8000-000000000006","label":"Shared","active":true,"parent_id":"00000000-0000-4000-8000-000000000002"},
      {"id":"00000000-0000-4000-8000-000000000007","label":"Same","active":false,"parent_id":"00000000-0000-4000-8000-000000000002"},
      {"id":"00000000-0000-4000-8000-000000000008","label":"Café","active":true},
      {"id":"00000000-0000-4000-8000-000000000009","label":"CAFÉ","active":true}
    ]'::jsonb;
    baseline:=jsonb_set(baseline,'{fields}',jsonb_build_array(jsonb_build_object('id',field,
      'type','hierarchical_select','label','Legacy choices','applies_to',jsonb_build_array('quantity','asset'),
      'required',false,'rules','{}'::jsonb,'options',choices)));
    -- Arrange a coherent immutable pre-policy publication directly as trusted SQL.
    insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition)
      values(revision,category,'draft',2,baseline);
    insert into public.metadata_fields(id,category_id,field_type) values(field,category,'hierarchical_select');
    insert into public.form_revision_fields(revision_id,field_id,label,applies_to,required,sort_order)
      values(revision,field,'Legacy choices',array['quantity','asset'],false,0);
    insert into public.metadata_options(id,field_id) select (value->>'id')::uuid,field from jsonb_array_elements(choices);
    insert into public.form_revision_options(revision_id,field_id,option_id,parent_option_id,label,active,sort_order)
      select revision,field,(value->>'id')::uuid,(value->>'parent_id')::uuid,btrim(value->>'label'),
        (value->>'active')::boolean,ordinality-1 from jsonb_array_elements(choices) with ordinality;
    update public.category_form_revisions set status='published',published_at=now() where id=revision;
    update public.categories set published_form_revision_id=revision where id=category;
    select draft_definition::text into original from public.category_form_revisions where id=revision;
    answers:=jsonb_build_object(field::text,jsonb_build_object('value','00000000-0000-4000-8000-000000000003','validated_revision_id',revision));
    insert into public.quantity_items(id,name,category_id,custom_values,validated_form_revision_id)
      values(item,'Legacy retained answer',category,answers,revision);
    old_event:=jsonb_build_object('category_id',category,'custom_values',answers);
    insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,after_metadata,version)
      values(event,item,'metadata_updated',actor,'Original actor',old_event,1);
    select to_jsonb(e)::text into original_event from public.quantity_events e where id=event;
    select jsonb_agg(to_jsonb(o) order by sort_order,option_id)::text into original_options
      from public.form_revision_options o where revision_id=revision;
    prior_claims:=current_setting('request.jwt.claims',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    proposal:=baseline; current_id:=revision;
    case change_kind
      when 'unrelated' then proposal:=jsonb_set(proposal,'{fields,0,help}','"More guidance"');
      when 'reorder' then proposal:=jsonb_set(proposal,'{fields,0,options}',
        (select jsonb_agg(value order by ordinality desc) from jsonb_array_elements(choices) with ordinality));
      when 'case' then proposal:=jsonb_set(proposal,'{fields,0,options,2,label}','" SAME "');
      when 'trim' then proposal:=jsonb_set(proposal,'{fields,0,options,2,label}','"Same"');
      when 'whitespace' then proposal:=jsonb_set(proposal,'{fields,0,options,2,label}',to_jsonb(chr(65279)||'Same'||chr(160)));
      when 'nfc' then proposal:=jsonb_set(proposal,'{fields,0,options,7,label}','"Café"');
      when 'reparent' then proposal:=jsonb_set(proposal,'{fields,0,options,2,parent_id}','"00000000-0000-4000-8000-000000000002"');
      when 'reactivate' then proposal:=jsonb_set(proposal,'{fields,0,options,6,active}','true');
      when 'new' then proposal:=jsonb_set(proposal,'{fields,0,options}',choices||jsonb_build_array(jsonb_build_object(
        'id',gen_random_uuid(),'label','Shared','active',true,'parent_id','00000000-0000-4000-8000-000000000002')));
      when 'copied' then proposal:=jsonb_set(proposal,'{fields,0,options,2,id}',to_jsonb(gen_random_uuid()::text));
      when 'newfield' then
        proposal:=jsonb_set(proposal,'{fields,0,id}',to_jsonb(gen_random_uuid()::text));
        proposal:=jsonb_set(proposal,'{fields,0,options}',(select jsonb_agg(
          jsonb_build_object('id',gen_random_uuid(),'label',value->>'label','active',value->'active'))
          from jsonb_array_elements(choices)));
      when 'retire' then proposal:=jsonb_set(proposal,'{fields,0,options,2,active}','false');
      when 'rename' then proposal:=jsonb_set(proposal,'{fields,0,options,2,label}','"Unique corrected choice"');
      when 'removed' then
        payload:=jsonb_build_object('category_id',category,'expected_actor_id',actor,
          'expected_published_revision_id',current_id,'expected_draft_id',null,'expected_draft_version','0',
          'definition',jsonb_set(proposal,'{fields,0,options}',choices-2));
        response:=public.metadata_form_save(gen_random_uuid(),payload);
        if response->>'status'='confirmation_required' then
          response:=public.metadata_form_save(gen_random_uuid(),payload||jsonb_build_object('review_token',response->>'token'));
        end if;
        current_id:=(response->>'published_revision_id')::uuid;
      when 'stale' then null;
      when 'staletoken' then proposal:=jsonb_set(proposal,'{fields,0,options,2,label}','"Unique corrected choice"');
      else raise exception 'unknown test variant';
    end case;
    -- The stale-token proposal matches rename/final's unexpired positive control.
    -- Required=true makes confirmation meaningful; label-only changes have no
    -- review reasons and would fail with the same error even without expiry.
    if route='final' or change_kind='staletoken' then
      proposal:=jsonb_set(proposal,'{fields,0,required}','true');
      proposal:=jsonb_set(proposal,'{layout}',(proposal->'layout')||jsonb_build_array(jsonb_build_object(
        'id',gen_random_uuid(),'label','Legacy choices','controls',jsonb_build_array(jsonb_build_object(
          'id',gen_random_uuid(),'kind','field','field_id',field,'width',12)))));
    end if;
    payload:=jsonb_build_object('category_id',category,'expected_actor_id',actor,
      'expected_published_revision_id',current_id,'expected_draft_id',null,'expected_draft_version','0','definition',proposal);
    if change_kind='stale' then payload:=jsonb_set(payload,'{expected_published_revision_id}',to_jsonb(gen_random_uuid()::text)); end if;
    if route='legacy' then
      response:=public.metadata_draft_save(gen_random_uuid(),jsonb_build_object('category_id',category,
        'expected_actor_id',actor,'expected_published_revision_id',current_id,'expected_draft_id',null,'expected_draft_version','0','definition',proposal));
      draft:=(response->>'entity_id')::uuid;
      payload:=jsonb_build_object('category_id',category,'expected_actor_id',actor,'expected_published_revision_id',current_id,
        'expected_draft_id',draft,'expected_draft_version',response->>'version');
      response:=public.metadata_publish_review(payload);
      payload:=payload||jsonb_build_object('review_token',response->>'token');
    elsif route='final' or change_kind='staletoken' then
      -- Trusted token fixture reaches the final compiler independently of the
      -- review compiler. Application roles cannot arrange this private row.
      review_reasons:=private.metadata_form_reasons(private.metadata_effective_definition(current_id,baseline),proposal);
      if jsonb_array_length(review_reasons)=0 then raise exception 'confirmed review fixture must have consequential reasons'; end if;
      insert into private.form_save_reviews(actor_id,category_id,draft_version,published_id,proposal,
        reference_fingerprint,reasons,affected_quantity,affected_assets,newly_needs_quantity,newly_needs_assets,initial_request_id)
        values(actor,category,0,current_id,proposal,private.metadata_reference_fingerprint(category),
          review_reasons,
          0,0,0,0,gen_random_uuid()) returning form_save_reviews.token into review_token_uuid;
      payload:=payload||jsonb_build_object('review_token',review_token_uuid);
      if change_kind='staletoken' then
        update private.form_save_reviews set expires_at=now()-interval '1 second'
          where form_save_reviews.token=review_token_uuid;
        get diagnostics expired_review_count=row_count;
        if expired_review_count<>1 then raise exception 'expired review fixture must target exactly one token'; end if;
      end if;
    end if;
    before_state:=jsonb_build_object('pointer',(select published_form_revision_id from public.categories where id=category),
      'version',(select version from public.categories where id=category),
      'fields',(select count(*) from public.metadata_fields),'options',(select count(*) from public.metadata_options),
      'revisions',(select count(*) from public.category_form_revisions),'events',(select count(*) from public.form_publication_events),
      'receipts',(select count(*) from private.mutation_requests),'reviews',(select count(*) from private.form_save_reviews));
    begin
      if route='legacy' then response:=public.metadata_publish(request,payload);
      else
        response:=public.metadata_form_save(request,payload);
        if response->>'status'='confirmation_required' then
          response:=public.metadata_form_save(gen_random_uuid(),payload||jsonb_build_object('review_token',response->>'token'));
        end if;
      end if;
      outcome:='ok';
      if route='final' and change_kind='rename' and
        (response->>'status' is distinct from 'saved' or
          (select published_form_revision_id from public.categories where id=category)
            is distinct from (response->>'published_revision_id')::uuid) then
        outcome:='unexpired review did not publish';
      end if;
    exception when others then outcome:=sqlstate||':'||sqlerrm;
    end;
    after_state:=jsonb_build_object('pointer',(select published_form_revision_id from public.categories where id=category),
      'version',(select version from public.categories where id=category),
      'fields',(select count(*) from public.metadata_fields),'options',(select count(*) from public.metadata_options),
      'revisions',(select count(*) from public.category_form_revisions),'events',(select count(*) from public.form_publication_events),
      'receipts',(select count(*) from private.mutation_requests),'reviews',(select count(*) from private.form_save_reviews));
    if outcome='ok' and change_kind='reorder' and
      private.metadata_option_paths(revision,field,array(select (value->>'id')::uuid from jsonb_array_elements(choices)))
      is distinct from private.metadata_option_paths((select published_form_revision_id from public.categories where id=category),field,
        array(select (value->>'id')::uuid from jsonb_array_elements(choices)))
      then outcome:='published reorder changed choice display identity'; end if;
    if outcome<>'ok' and before_state<>after_state then outcome:='partial write after '||outcome; end if;
    if (select draft_definition::text from public.category_form_revisions where id=revision)<>original
      or (select to_jsonb(e)::text from public.quantity_events e where id=event)<>original_event
      or (select jsonb_agg(to_jsonb(o) order by sort_order,option_id)::text
        from public.form_revision_options o where revision_id=revision)<>original_options
      or (select custom_values from public.quantity_items where id=item)<>answers
      or (select after_metadata from public.quantity_events where id=event)<>old_event
      or (select validated_form_revision_id from public.quantity_items where id=item)<>revision
      or (select version from public.quantity_items where id=item)<>1 then outcome:='history or answers rewritten'; end if;
    perform set_config('request.jwt.claims',coalesce(prior_claims,''),true);
    raise exception using errcode='P9999',message='rollback_test_fixture';
  exception when sqlstate 'P9999' then return outcome;
  end;
end;
$$;

select is(pg_temp.choice_publication(variant),'ok','unchanged legacy sibling and cross-parent collisions permit '||variant)
  from unnest(array['unrelated','reorder','retire','rename']) variant;
select is(pg_temp.choice_publication(variant),'P1021:ambiguous_active_field_options',
  'review compiler refuses '||variant||' and preserves identities, events, receipts, original bytes and answers')
  from unnest(array['case','trim','whitespace','nfc','reparent','reactivate','new','copied','newfield','removed']) variant;
select is(pg_temp.choice_publication('case','final'),'P1021:ambiguous_active_field_options','final compiler independently refuses a colliding proposal atomically');
select is(pg_temp.choice_publication('new','legacy'),'P1021:ambiguous_active_field_options','permissive legacy saved draft and review never establish collision provenance');
select is(pg_temp.choice_publication('unrelated','legacy'),'ok','legacy publication preserves unchanged existing cross-parent and sibling collisions');
select is(pg_temp.choice_publication('stale'),'P1002:stale_form','stale published revision is rejected before publication');
select is(pg_temp.choice_publication('rename','final'),'ok','matching unexpired consequential review publishes and preserves original history and answers');
select is(pg_temp.choice_publication('staletoken'),'P1017:stale_form_review','expired review cannot publish');
select * from finish();
rollback;
