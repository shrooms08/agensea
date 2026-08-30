-- 006_demo_limits.sql — rate limiting for the platform-sponsored demo hire.
--
-- The /api/hire route spends real platform funds (1 $U + gas per press), so
-- the limiter is enforced SERVER-SIDE in Postgres, atomically, before any
-- chain work: 2 per IP per UTC day, 20 globally per UTC day.
--
-- Design: the route (anon key) can ONLY call the RPC. The table itself grants
-- anon nothing; the function is SECURITY DEFINER with a pinned search_path and
-- performs check+insert under an advisory lock so concurrent presses cannot
-- overshoot. Failure mode of direct-RPC abuse: an attacker spamming the RPC
-- with fabricated ip hashes can exhaust the GLOBAL counter and make the demo
-- unavailable — that fails SAFE (no funds move); funds are only spent by the
-- route, which passes real client IPs.

begin;

create table if not exists public.demo_hires (
  id          bigserial primary key,
  ip_hash     text        not null,       -- sha256 of client IP; raw IPs never stored
  agent_id    integer     not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_demo_hires_day on public.demo_hires (created_at);
create index if not exists idx_demo_hires_ip  on public.demo_hires (ip_hash, created_at);

alter table public.demo_hires enable row level security;
revoke all on public.demo_hires from anon, authenticated;
grant all on public.demo_hires to service_role;
grant usage, select on sequence public.demo_hires_id_seq to service_role;

create or replace function public.demo_hire_permit(p_ip_hash text, p_agent_id integer)
returns table (allowed boolean, reason text, ip_used integer, global_used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip int; v_global int;
  IP_LIMIT constant int := 2;
  GLOBAL_LIMIT constant int := 20;
begin
  -- one permit decision at a time: no overshoot under concurrent presses
  perform pg_advisory_xact_lock(hashtext('demo_hire_permit'));

  select count(*) into v_global from public.demo_hires
   where created_at >= date_trunc('day', now());
  select count(*) into v_ip from public.demo_hires
   where ip_hash = p_ip_hash and created_at >= date_trunc('day', now());

  if v_global >= GLOBAL_LIMIT then
    return query select false, 'global'::text, v_ip, v_global; return;
  end if;
  if v_ip >= IP_LIMIT then
    return query select false, 'ip'::text, v_ip, v_global; return;
  end if;

  insert into public.demo_hires (ip_hash, agent_id) values (p_ip_hash, p_agent_id);
  return query select true, 'ok'::text, v_ip + 1, v_global + 1;
end $$;

revoke all on function public.demo_hire_permit(text, integer) from public;
grant execute on function public.demo_hire_permit(text, integer) to anon, service_role;
revoke execute on function public.demo_hire_permit(text, integer) from authenticated;
-- Advisor note: anon-executable SECURITY DEFINER draws a WARN. It is the
-- design — see header. authenticated is revoked; it has no role here.

commit;

-- Expected after apply:
--   demo_hires: 0 rows; anon has NO table access; RPC callable by anon.
--   select * from demo_hire_permit('test', 0) three times ->
--     (t,'ok',1,1), (t,'ok',2,2), (f,'ip',2,2); then clean up test rows.
