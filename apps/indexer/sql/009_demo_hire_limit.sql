-- 009_demo_hire_limit.sql — global HIRE limit 20 -> 6 per UTC day.
-- Per-IP stays 2. Revoke limits unchanged (1/IP/day, 4/global/day).
--
-- WHY 6: the faucet automation (/api/faucet-claim, called by keepalive every
-- 6 hours) brings ~40 $U/day into the buyer wallet, so at 6/day out the
-- balance grows. Even with the faucet failing completely, 22 $U covers 3.6
-- days at 6/day. And 6/day means a second or third judge on the same day
-- still gets a live run, which 1/day would not.
--
-- Function body is otherwise identical to 007. Grants are preserved by
-- create or replace (anon + service_role execute; public/authenticated none).

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
declare src text; n_anon int;
begin
  src := pg_get_functiondef('public.demo_action_permit(text,integer,text)'::regprocedure);
  if src not like '%v_global_limit := 6;%' then raise exception 'assert: hire global limit is not 6'; end if;
  if src not like '%v_ip_limit := 2; v_global_limit := 6;%' then raise exception 'assert: hire per-IP limit changed'; end if;
  if src not like '%v_ip_limit := 1; v_global_limit := 4;%' then raise exception 'assert: revoke limits changed'; end if;
  select count(*) into n_anon from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'demo_action_permit' and grantee = 'anon' and privilege_type = 'EXECUTE';
  if n_anon <> 1 then raise exception 'assert: anon execute grant not preserved'; end if;
end $$;
