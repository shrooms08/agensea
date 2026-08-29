-- 005_views.sql — the frontend's read surface.
--
-- GOAL: the UI must never read public.agents directly, so that the 4,349 row
-- count (4,348 with clients + agent 127417, which has none) is structurally
-- unrenderable. Two views expose exactly what each screen needs; anon's SELECT
-- on the base table is then revoked.
--
-- DELIBERATE INVERSION OF 003_rls.sql — READ THIS BEFORE CHANGING IT:
-- 003 set security_invoker = true on its views so that RLS on the base tables
-- applied through them. That is correct when anon can read the base tables.
-- Here it is exactly wrong: once anon loses SELECT on public.agents, a
-- security_invoker view reading that table fails for anon too. So these views
-- run as their OWNER (security_invoker = false, the default) and the VIEW
-- DEFINITION becomes the policy. Each is constrained by its own WHERE/JOIN, so
-- none exposes an unfiltered public.agents.
--
-- This also forces a change to the EXISTING agent_bazaar_overlap view, which is
-- security_invoker=true and selects FROM agents. Left alone, the revoke below
-- would break it for anon. It is flipped to run as owner for the same reason.
--
-- No data is dropped. Nothing is revoked from service_role.

begin;

-- ---------------------------------------------------------------------------
-- 1. The liveness surface: exactly the agents that have ever had a client.
--    Filtered to client_count > 0, so count(*) here is 4,348 and can never
--    render 4,349. Every field the list and detail views need.
-- ---------------------------------------------------------------------------
create or replace view public.agent_liveness_with_clients as
  select l.agent_id,
         l.owner,
         l.client_count,
         l.clients,
         l.checked_at,
         a.agent_wallet,
         a.token_uri,
         a.token_uri_kind,
         a.token_uri_host,
         a.metadata,
         a.feedback_count,
         a.summary_value,
         a.summary_decimals
    from public.agent_liveness l
    join public.agents a using (agent_id)
   where l.client_count > 0;

-- ---------------------------------------------------------------------------
-- 2. The overlap surface: agents whose wallet is a B402 Bazaar payee.
--    Currently exactly one row (agentId 127417, xona-agent.com), which has
--    zero clients and is therefore absent from view 1 and from the fan-out
--    curve. This gives /agents/[id] something to resolve without putting it
--    inside any counted set.
--    Carries token_uri / token_uri_kind / metadata, which agent_bazaar_overlap
--    lacks, so it can serve a full detail page.
-- ---------------------------------------------------------------------------
create or replace view public.agent_overlap_detail as
  select a.agent_id,
         a.owner,
         a.agent_wallet,
         a.token_uri,
         a.token_uri_kind,
         a.token_uri_host,
         a.metadata,
         a.client_count,
         a.feedback_count,
         a.summary_value,
         a.summary_decimals,
         a.checked_at,
         c.resources        as bazaar_resources,
         c.pct_of_catalogue as bazaar_pct
    from public.agents a
    join public.bazaar_payee_concentration c on c.pay_to = a.agent_wallet;

-- ---------------------------------------------------------------------------
-- 3. Run as owner. See the header: with anon's SELECT on agents revoked, a
--    security_invoker view could not read it either.
-- ---------------------------------------------------------------------------
alter view public.agent_liveness_with_clients set (security_invoker = false);
alter view public.agent_overlap_detail        set (security_invoker = false);
alter view public.agent_bazaar_overlap        set (security_invoker = false);

-- ---------------------------------------------------------------------------
-- 4. Grants. anon reads the views only.
-- ---------------------------------------------------------------------------
revoke all on public.agent_liveness_with_clients from anon, authenticated;
revoke all on public.agent_overlap_detail        from anon, authenticated;

grant select on public.agent_liveness_with_clients to anon;
grant select on public.agent_overlap_detail        to anon;

grant all on public.agent_liveness_with_clients to service_role;
grant all on public.agent_overlap_detail        to service_role;

-- ---------------------------------------------------------------------------
-- 5. Close the direct route. anon keeps NO access to public.agents.
--    service_role is untouched — the indexer still writes it.
-- ---------------------------------------------------------------------------
revoke all on public.agents from anon, authenticated;

drop policy if exists anon_read_agents on public.agents;

commit;

-- ---------------------------------------------------------------------------
-- Expected after apply:
--   select count(*) from public.agent_liveness_with_clients;  -- 4348
--   select count(*) from public.agent_overlap_detail;         -- 1
--   select agent_id from public.agent_overlap_detail;         -- 127417
--   anon GET /agents                     -> 401 42501
--   anon GET /agent_liveness_with_clients-> 200
--   anon GET /agent_overlap_detail       -> 200
--   anon GET /agent_bazaar_overlap       -> 200  (still works after the flip)
-- ---------------------------------------------------------------------------
