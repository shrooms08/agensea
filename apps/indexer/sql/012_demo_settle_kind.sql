-- 012_demo_settle_kind.sql — limiter kind for POST /api/settle (client-
-- triggered keeper). A settle costs the platform ~0.00003 tBNB relay fee and
-- only ever acts on SUBMITTED-past-window jobs against our own provider, so
-- griefing can only pay our bills early: 10/IP/day, 60/global/day.

create or replace function public.demo_action_permit(p_ip_hash text, p_agent_id integer, p_kind text)
returns table (allowed boolean, reason text, ip_used integer, global_used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip int; v_global int; v_ip_limit int; v_global_limit int;
begin
  if p_kind = 'hire' then v_ip_limit := 2; v_global_limit := 6;
  elsif p_kind = 'revoke' then v_ip_limit := 1; v_global_limit := 4;
  elsif p_kind = 'agentwork' then v_ip_limit := 6; v_global_limit := 30;
  elsif p_kind = 'settle' then v_ip_limit := 10; v_global_limit := 60;
  else return query select false, 'unknown-kind'::text, 0, 0; return;
  end if;

  perform pg_advisory_xact_lock(hashtext('demo_action_permit' || p_kind));

  select count(*) into v_global from public.demo_hires
   where kind = p_kind and created_at >= date_trunc('day', now());
  select count(*) into v_ip from public.demo_hires
   where kind = p_kind and ip_hash = p_ip_hash and created_at >= date_trunc('day', now());

  if v_global >= v_global_limit then return query select false, 'global'::text, v_ip, v_global; return; end if;
  if v_ip >= v_ip_limit then return query select false, 'ip'::text, v_ip, v_global; return; end if;

  insert into public.demo_hires (ip_hash, agent_id, kind) values (p_ip_hash, p_agent_id, p_kind);
  return query select true, 'ok'::text, v_ip + 1, v_global + 1;
end $$;

-- Assertions ----------------------------------------------------------------
do $$
declare src text; a boolean; r text;
begin
  src := pg_get_functiondef('public.demo_action_permit(text,integer,text)'::regprocedure);
  if src not like '%v_ip_limit := 10; v_global_limit := 60;%' then raise exception 'assert: settle limits missing'; end if;
  if src not like '%v_ip_limit := 6; v_global_limit := 30;%' then raise exception 'assert: agentwork limits changed'; end if;
  if src not like '%v_ip_limit := 2; v_global_limit := 6;%' then raise exception 'assert: hire limits changed'; end if;
  select allowed, reason into a, r from public.demo_action_permit('settle-probe', 0, 'settle');
  if not a then raise exception 'assert: first settle should pass (%)', r; end if;
  delete from public.demo_hires where ip_hash = 'settle-probe';
end $$;
