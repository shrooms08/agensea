-- 003_rls.sql — row level security for AgenSea public tables.
--
-- WHY: every table so far was created with RLS OFF and all writes used the
-- service_role key. The frontend will use the publishable (anon) key, which
-- ships in the browser bundle and is therefore public by definition. With RLS
-- off, anyone holding that key can read AND WRITE every table through
-- PostgREST. This file closes that.
--
-- Two independent layers are used, deliberately:
--   1. GRANTs      — can the role touch the table at all?
--   2. RLS policies — which rows may it touch?
-- Either alone would be sufficient for reads; both together mean a mistake in
-- one layer does not silently open writes.
--
-- service_role is unaffected: in Supabase it carries the BYPASSRLS attribute,
-- so the indexer keeps working unchanged. It is granted explicitly below anyway
-- so the intent is visible rather than inherited.

begin;

-- ---------------------------------------------------------------------------
-- 1. Enable RLS. With RLS on and no policy for a role, that role gets NOTHING.
--    This is the fail-closed default we want.
-- ---------------------------------------------------------------------------
alter table public.bazaar_resources enable row level security;
alter table public.bazaar_accepts   enable row level security;
alter table public.agent_liveness   enable row level security;
alter table public.agents           enable row level security;
alter table public.sweep_cursor     enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Reset role privileges to a known-minimal baseline.
--    Supabase grants CRUD on new tables to anon/authenticated by default, so
--    revoking first means we are not relying on assumptions about what the
--    project template did.
-- ---------------------------------------------------------------------------
revoke all on public.bazaar_resources           from anon, authenticated;
revoke all on public.bazaar_accepts             from anon, authenticated;
revoke all on public.agent_liveness             from anon, authenticated;
revoke all on public.agents                     from anon, authenticated;
revoke all on public.sweep_cursor               from anon, authenticated;
revoke all on public.bazaar_payee_concentration from anon, authenticated;
revoke all on public.agent_bazaar_overlap       from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. anon gets SELECT only, on the four public tables.
--    No INSERT / UPDATE / DELETE grant and no corresponding policy exists, so
--    writes fail at both layers.
-- ---------------------------------------------------------------------------
grant select on public.bazaar_resources to anon;
grant select on public.bazaar_accepts   to anon;
grant select on public.agent_liveness   to anon;
grant select on public.agents           to anon;

drop policy if exists anon_read_bazaar_resources on public.bazaar_resources;
drop policy if exists anon_read_bazaar_accepts   on public.bazaar_accepts;
drop policy if exists anon_read_agent_liveness   on public.agent_liveness;
drop policy if exists anon_read_agents           on public.agents;

create policy anon_read_bazaar_resources on public.bazaar_resources
  for select to anon using (true);
create policy anon_read_bazaar_accepts   on public.bazaar_accepts
  for select to anon using (true);
create policy anon_read_agent_liveness   on public.agent_liveness
  for select to anon using (true);
create policy anon_read_agents           on public.agents
  for select to anon using (true);

-- ---------------------------------------------------------------------------
-- 4. sweep_cursor: NO anon access of any kind.
--    RLS is enabled above and no policy is created for anon, so even if a
--    future migration re-grants SELECT by accident, RLS still denies it.
-- ---------------------------------------------------------------------------
-- (intentionally no grant, no policy for anon on public.sweep_cursor)

-- ---------------------------------------------------------------------------
-- 5. Views. In PG15+ a view executes with its OWNER's privileges unless
--    security_invoker is set — which would let a view read straight past RLS
--    on its base tables. Neither of these views touches sweep_cursor, so there
--    is no leak today, but setting this makes RLS apply through them and keeps
--    that true if the definitions ever change.
-- ---------------------------------------------------------------------------
alter view public.bazaar_payee_concentration set (security_invoker = true);
alter view public.agent_bazaar_overlap       set (security_invoker = true);

grant select on public.bazaar_payee_concentration to anon;
grant select on public.agent_bazaar_overlap       to anon;

-- ---------------------------------------------------------------------------
-- 6. service_role stays unrestricted (explicit, not merely inherited).
-- ---------------------------------------------------------------------------
grant all on public.bazaar_resources           to service_role;
grant all on public.bazaar_accepts             to service_role;
grant all on public.agent_liveness             to service_role;
grant all on public.agents                     to service_role;
grant all on public.sweep_cursor               to service_role;
grant all on public.bazaar_payee_concentration to service_role;
grant all on public.agent_bazaar_overlap       to service_role;

-- bazaar_accepts.id is a bigserial; writers need the sequence.
grant usage, select on all sequences in schema public to service_role;

commit;

-- ---------------------------------------------------------------------------
-- Eyeball check (run separately; the empirical tests are what actually matter)
-- ---------------------------------------------------------------------------
-- select tablename, rowsecurity
--   from pg_tables where schemaname = 'public' order by tablename;
--
-- select tablename, policyname, roles, cmd
--   from pg_policies where schemaname = 'public' order by tablename;
--
-- select table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--  where table_schema = 'public' and grantee in ('anon','authenticated')
--  order by table_name, grantee, privilege_type;
