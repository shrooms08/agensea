-- 014_agent_listings.sql — operator claims and listings.
--
-- An operator who owns an ERC-8004 agent on chain 56 proves it and lists the
-- agent here. Claimed and displayed only: EXECUTION IS OUT OF SCOPE in this
-- build, so nothing in the product calls an operator-supplied endpoint. The
-- 'live' status below is reserved for third-party execution after the
-- hackathon; nothing in this build ever sets it.
--
-- WHY THE WRITE PATH IS AN RPC, AND WHY THAT IS SAFE
-- The web app holds ONLY the anon key by design (lib/supabase.ts refuses to
-- start with a service key), so writes go through SECURITY DEFINER functions
-- callable by anon — the same posture as demo_action_permit and
-- demo_record_deliverable. That means a determined caller can invoke these
-- functions directly, without our signature check. Two things make that
-- harmless:
--
--   1. The route does the real proof: a MAC'd nonce, a signature over a
--      message naming the agentId, and recovered signer === ownerOf(agentId)
--      read LIVE from the IdentityRegistry at request time.
--   2. THE CHAIN IS THE AUTHORITY AT RENDER. Every surface that displays a
--      listing re-reads ownerOf(agent_id) and refuses to render any row whose
--      stored owner no longer matches chain. A forged row is inert: it can sit
--      in this table and will never appear anywhere.
--
-- So this table is a cache of claims, not a source of truth about ownership.
-- It is never allowed to be the reason something is shown.

create table if not exists public.agent_listings (
  agent_id      bigint primary key,
  owner         text not null,
  name          text not null,
  description   text,
  category      text,
  delivers      jsonb not null default '[]'::jsonb,
  input_schema  jsonb not null default '{}'::jsonb,
  endpoint_url  text,
  price_u       numeric(20,6),
  status        text not null default 'claimed',
  claimed_at    timestamptz not null default now(),
  listed_at     timestamptz,

  constraint agent_listings_owner_addr   check (owner ~ '^0x[0-9a-f]{40}$'),
  constraint agent_listings_name_present check (length(btrim(name)) > 0),
  constraint agent_listings_status       check (status in ('claimed', 'listed', 'live')),
  -- One of our four categories, or none while still merely claimed.
  constraint agent_listings_category     check (
    category is null or category in
      ('health-factor-monitoring', 'rebalancing', 'grid-trading', 'yield-optimisation')),
  -- An endpoint may be absent, but if present it must be https. We never call
  -- it for work in this build; this keeps a plaintext or javascript: URL from
  -- ever being stored, let alone displayed.
  constraint agent_listings_endpoint_https check (
    endpoint_url is null or endpoint_url ~* '^https://[a-z0-9.-]+(:[0-9]+)?(/.*)?$'),
  constraint agent_listings_price         check (price_u is null or price_u >= 0),
  -- A listed row must actually carry the things a listing promises.
  constraint agent_listings_listed_shape  check (
    status = 'claimed' or (category is not null and description is not null and listed_at is not null))
);

create index if not exists idx_agent_listings_status on public.agent_listings (status, category);
create index if not exists idx_agent_listings_owner  on public.agent_listings (owner);

comment on table public.agent_listings is
  'Operator-claimed ERC-8004 agents (chain 56). Ownership is proven at claim time and RE-VERIFIED against ownerOf at render; this table never justifies display on its own. Execution through AgenSea is out of scope in this build.';

-- ---------------------------------------------------------------------------
-- RLS — identical posture to 003_rls.sql. Supabase grants CRUD to anon on NEW
-- tables by default, so the revoke is required, not optional.
-- ---------------------------------------------------------------------------
alter table public.agent_listings enable row level security;
revoke all on public.agent_listings from anon, authenticated;
grant select on public.agent_listings to anon;
grant all on public.agent_listings to service_role;

drop policy if exists anon_read_agent_listings on public.agent_listings;
create policy anon_read_agent_listings
  on public.agent_listings for select to anon using (true);

-- ---------------------------------------------------------------------------
-- Write path. Both functions are idempotent per (agent_id, owner) and refuse
-- to let one address overwrite another's claim.
-- ---------------------------------------------------------------------------
create or replace function public.claim_agent(p_agent_id bigint, p_owner text)
returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner text := lower(p_owner); v_existing text;
begin
  if v_owner !~ '^0x[0-9a-f]{40}$' then return query select false, 'bad-owner'::text; return; end if;
  if p_agent_id is null or p_agent_id < 1 then return query select false, 'bad-agent'::text; return; end if;

  select owner into v_existing from public.agent_listings where agent_id = p_agent_id;
  if v_existing is not null and v_existing <> v_owner then
    return query select false, 'claimed-by-another-address'::text; return;
  end if;

  insert into public.agent_listings (agent_id, owner, name, status)
  values (p_agent_id, v_owner, 'Agent ' || p_agent_id::text, 'claimed')
  on conflict (agent_id) do nothing;

  return query select true, 'ok'::text;
end $$;

create or replace function public.list_agent(
  p_agent_id bigint, p_owner text, p_name text, p_description text, p_category text,
  p_delivers jsonb, p_input_schema jsonb, p_endpoint_url text, p_price_u numeric
) returns table (ok boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner text := lower(p_owner); v_existing text;
begin
  if v_owner !~ '^0x[0-9a-f]{40}$' then return query select false, 'bad-owner'::text; return; end if;
  select owner into v_existing from public.agent_listings where agent_id = p_agent_id;
  if v_existing is null then return query select false, 'not-claimed'::text; return; end if;
  if v_existing <> v_owner then return query select false, 'claimed-by-another-address'::text; return; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then return query select false, 'name-required'::text; return; end if;
  if pg_column_size(coalesce(p_delivers, '[]'::jsonb)) > 8192
     or pg_column_size(coalesce(p_input_schema, '{}'::jsonb)) > 8192 then
    return query select false, 'payload-too-large'::text; return;
  end if;

  update public.agent_listings
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         category = p_category,
         delivers = coalesce(p_delivers, '[]'::jsonb),
         input_schema = coalesce(p_input_schema, '{}'::jsonb),
         endpoint_url = nullif(btrim(coalesce(p_endpoint_url, '')), ''),
         price_u = p_price_u,
         status = 'listed',
         listed_at = now()
   where agent_id = p_agent_id;

  return query select true, 'ok'::text;
exception when check_violation then
  return query select false, 'rejected-by-constraint'::text;
end $$;

revoke all on function public.claim_agent(bigint, text) from public, authenticated;
revoke all on function public.list_agent(bigint, text, text, text, text, jsonb, jsonb, text, numeric) from public, authenticated;
grant execute on function public.claim_agent(bigint, text) to anon, service_role;
grant execute on function public.list_agent(bigint, text, text, text, text, jsonb, jsonb, text, numeric) to anon, service_role;

-- ---------------------------------------------------------------------------
-- Rate-limit kinds for the two new routes. Body otherwise identical to 012.
-- ---------------------------------------------------------------------------
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
  elsif p_kind = 'claim' then v_ip_limit := 3; v_global_limit := 20;
  elsif p_kind = 'listing' then v_ip_limit := 10; v_global_limit := 60;
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

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
declare a boolean; r text; n_anon text; src text;
begin
  -- claim, then re-claim by the same owner (idempotent), then by another (refused)
  select ok, reason into a, r from public.claim_agent(999999901, '0x00000000000000000000000000000000000000aa');
  if not a then raise exception 'assert: first claim should succeed (%)', r; end if;
  select ok, reason into a, r from public.claim_agent(999999901, '0x00000000000000000000000000000000000000AA');
  if not a then raise exception 'assert: same owner re-claim should be idempotent (%)', r; end if;
  select ok, reason into a, r from public.claim_agent(999999901, '0x00000000000000000000000000000000000000bb');
  if a or r <> 'claimed-by-another-address' then raise exception 'assert: another address must be refused (%)', r; end if;

  -- listing requires a prior claim by the same owner
  select ok, reason into a, r from public.list_agent(999999902, '0x00000000000000000000000000000000000000aa',
    'X', 'd', 'rebalancing', '[]'::jsonb, '{}'::jsonb, 'https://example.com/x', 1);
  if a or r <> 'not-claimed' then raise exception 'assert: listing an unclaimed agent must be refused (%)', r; end if;

  select ok, reason into a, r from public.list_agent(999999901, '0x00000000000000000000000000000000000000aa',
    'Test Listing', 'a description', 'rebalancing', '["x"]'::jsonb, '{"k":"v"}'::jsonb, 'https://example.com/x', 1.5);
  if not a then raise exception 'assert: valid listing should succeed (%)', r; end if;
  if (select status from public.agent_listings where agent_id = 999999901) <> 'listed' then
    raise exception 'assert: status should be listed';
  end if;

  -- http endpoint refused by the constraint (surfaced as rejected-by-constraint)
  select ok, reason into a, r from public.list_agent(999999901, '0x00000000000000000000000000000000000000aa',
    'Test Listing', 'a description', 'rebalancing', '[]'::jsonb, '{}'::jsonb, 'http://insecure.example/x', 1);
  if a or r <> 'rejected-by-constraint' then raise exception 'assert: http endpoint must be refused (%)', r; end if;

  -- bad category refused
  select ok, reason into a, r from public.list_agent(999999901, '0x00000000000000000000000000000000000000aa',
    'Test Listing', 'a description', 'not-a-category', '[]'::jsonb, '{}'::jsonb, null, 1);
  if a or r <> 'rejected-by-constraint' then raise exception 'assert: bad category must be refused (%)', r; end if;

  -- new limiter kinds live, old ones unchanged
  src := pg_get_functiondef('public.demo_action_permit(text,integer,text)'::regprocedure);
  if src not like '%p_kind = ''claim''%' or src not like '%p_kind = ''listing''%' then
    raise exception 'assert: claim/listing kinds missing';
  end if;
  if src not like '%v_ip_limit := 2; v_global_limit := 6;%' then raise exception 'assert: hire limits changed'; end if;
  if src not like '%v_ip_limit := 10; v_global_limit := 60;%' then raise exception 'assert: settle limits changed'; end if;

  -- anon may read the table and nothing else
  select string_agg(privilege_type, ',' order by privilege_type) into n_anon
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'agent_listings' and grantee = 'anon';
  if n_anon is distinct from 'SELECT' then
    raise exception 'assert: anon should hold exactly SELECT, holds %', coalesce(n_anon, '(none)');
  end if;

  delete from public.agent_listings where agent_id in (999999901, 999999902);
end $$;
