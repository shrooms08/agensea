-- 004_fanout.sql — precomputed fan-out curve for the explorer threshold slider.
--
-- WHY TABLES, NOT MATERIALIZED VIEWS: Postgres does not support
-- ALTER MATERIALIZED VIEW ... ENABLE ROW LEVEL SECURITY. A matview can only be
-- secured by GRANT, which would leave it outside the RLS posture established in
-- 003_rls.sql. These are ordinary tables refreshed by a function, so they get
-- the identical RLS treatment.
--
-- SIZE: client fan-out is bounded by the 107 distinct client addresses, so the
-- curve only changes at 30 distinct breakpoints. agent_fanout_curve is ~31 rows.
-- The frontend loads it once and resolves any slider position client-side with a
-- "largest breakpoint <= t" lookup — exact, no interpolation, no round-trip.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.client_fanout (
  client       text primary key,
  agent_count  integer not null,
  computed_at  timestamptz not null default now()
);

create table if not exists public.agent_fanout_curve (
  threshold          integer primary key,
  qualifying_agents  integer not null,
  computed_at        timestamptz not null default now()
);

-- Headline figures with the date they were measured. The registry grows ~110
-- agents per 45 minutes, so a bare count is misleading without its timestamp.
create table if not exists public.registry_stats (
  key          text primary key,
  value        numeric not null,
  measured_at  timestamptz not null default now(),
  note         text
);

-- ---------------------------------------------------------------------------
-- 2. Refresh function. Called by the indexer (service_role) after a sweep.
--    jsonb_array_elements_text unnests the clients array directly to text.
--    lower() everywhere: upstream casing is never trusted.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_fanout()
returns table (clients_out integer, breakpoints_out integer)
language plpgsql
as $$
begin
  delete from public.client_fanout;
  insert into public.client_fanout (client, agent_count)
  select lower(c.client), count(distinct l.agent_id)
    from public.agent_liveness l
    cross join lateral jsonb_array_elements_text(l.clients) as c(client)
   where l.client_count > 0
   group by lower(c.client);

  delete from public.agent_fanout_curve;
  insert into public.agent_fanout_curve (threshold, qualifying_agents)
  with edges as (
    select l.agent_id, lower(c.client) as client
      from public.agent_liveness l
      cross join lateral jsonb_array_elements_text(l.clients) as c(client)
     where l.client_count > 0
  )
  select b.threshold,
         (select count(distinct e.agent_id)
            from edges e
            join public.client_fanout f on f.client = e.client
           where f.agent_count <= b.threshold)
    from (select distinct agent_count as threshold from public.client_fanout) b;

  return query
    select (select count(*)::integer from public.client_fanout),
           (select count(*)::integer from public.agent_fanout_curve);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Populate now
-- ---------------------------------------------------------------------------
select * from public.refresh_fanout();

insert into public.registry_stats (key, value, measured_at, note) values
  ('agents_minted',        301992, '2026-08-24T00:00:00Z', 'contiguous ids 1..301992; grows ~110 per 45 min'),
  ('agents_with_client',     4348, '2026-08-24T00:00:00Z', 'ever had >=1 client'),
  ('client_edges',           8260, '2026-08-24T00:00:00Z', null),
  ('distinct_clients',        107, '2026-08-24T00:00:00Z', null),
  ('bazaar_resources',        976, '2026-08-24T00:00:00Z', null),
  ('bazaar_payees',             6, '2026-08-24T00:00:00Z', null),
  ('bazaar_top_payee_pct',  96.41, '2026-08-24T00:00:00Z', '0x50ab2018...'),
  ('overlap_agents',            1, '2026-08-24T00:00:00Z', 'agentId 127417, xona-agent.com')
on conflict (key) do update
  set value = excluded.value, measured_at = excluded.measured_at, note = excluded.note;

-- ---------------------------------------------------------------------------
-- 4. RLS — identical posture to 003_rls.sql. Supabase grants CRUD to anon on
--    NEW tables by default, so this is required, not optional.
-- ---------------------------------------------------------------------------
alter table public.client_fanout      enable row level security;
alter table public.agent_fanout_curve enable row level security;
alter table public.registry_stats     enable row level security;

revoke all on public.client_fanout      from anon, authenticated;
revoke all on public.agent_fanout_curve from anon, authenticated;
revoke all on public.registry_stats     from anon, authenticated;

grant select on public.client_fanout      to anon;
grant select on public.agent_fanout_curve to anon;
grant select on public.registry_stats     to anon;

drop policy if exists anon_read_client_fanout      on public.client_fanout;
drop policy if exists anon_read_agent_fanout_curve on public.agent_fanout_curve;
drop policy if exists anon_read_registry_stats     on public.registry_stats;

create policy anon_read_client_fanout      on public.client_fanout
  for select to anon using (true);
create policy anon_read_agent_fanout_curve on public.agent_fanout_curve
  for select to anon using (true);
create policy anon_read_registry_stats     on public.registry_stats
  for select to anon using (true);

grant all on public.client_fanout      to service_role;
grant all on public.agent_fanout_curve to service_role;
grant all on public.registry_stats     to service_role;

-- The refresh function must NOT be callable by anon: it rewrites both tables.
revoke all on function public.refresh_fanout() from public, anon, authenticated;
grant execute on function public.refresh_fanout() to service_role;

commit;

-- ---------------------------------------------------------------------------
-- Expected after apply (these are the numbers to check against):
--   client_fanout       107 rows
--   agent_fanout_curve   30 rows
--   curve: threshold 1800 -> 4348 · 924 -> 1561 · 442 -> 656 · 62 -> 173
-- ---------------------------------------------------------------------------
