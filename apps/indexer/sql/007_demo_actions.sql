-- 007_demo_actions.sql — generalise the demo limiter to actions with per-kind
-- limits: 'hire' 2/IP/day + 20/global/day (unchanged), 'revoke' 1/IP/day +
-- 4/global/day. Same design as 006: SECURITY DEFINER, advisory-locked,
-- fail-safe (spam can only exhaust counters, never move funds). The table
-- gains a kind column; demo_hire_permit remains for compatibility.

begin;

alter table public.demo_hires add column if not exists kind text not null default 'hire';
create index if not exists idx_demo_hires_kind on public.demo_hires (kind, created_at);

create or replace function public.demo_action_permit(p_ip_hash text, p_agent_id integer, p_kind text)
returns table (allowed boolean, reason text, ip_used integer, global_used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip int; v_global int; v_ip_limit int; v_global_limit int;
begin
  if p_kind = 'hire' then v_ip_limit := 2; v_global_limit := 20;
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

revoke all on function public.demo_action_permit(text, integer, text) from public, authenticated;
grant execute on function public.demo_action_permit(text, integer, text) to anon, service_role;

commit;
-- Assertions: permit('x',0,'revoke') twice -> (t,ok,1,1),(f,ip,1,1);
-- permit('y',0,'bogus') -> (f,unknown-kind). Clean test rows after.
