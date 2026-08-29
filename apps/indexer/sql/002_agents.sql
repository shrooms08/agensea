-- PHASE 1b - ERC-8004 agent enumeration.
-- Pass 1 (liveness) -> agent_liveness; Pass 2 (enrichment) -> agents.
-- All addresses are stored LOWERCASE. Upstream casing is never trusted.

-- ---------------------------------------------------------------------------
-- Pass 1: liveness. One row per agentId in 1..ceiling.
-- `owner` is an ADDITION to the approved spec - see the note in the report.
-- Without it, side question 2 (which agentId 0x515e7bce... owns) is
-- unanswerable: the registry has no reverse lookup and no enumeration.
-- ---------------------------------------------------------------------------
create table if not exists agent_liveness (
  agent_id     bigint primary key,
  owner        text,
  client_count int  not null default 0,
  clients      jsonb not null default '[]'::jsonb,
  checked_at   timestamptz not null default now()
);

create index if not exists idx_liveness_owner on agent_liveness (owner);
-- Partial index: Pass 2 only ever scans the non-zero set, which is expected
-- to be a tiny fraction of ~297k rows.
create index if not exists idx_liveness_live on agent_liveness (agent_id)
  where client_count > 0;

-- ---------------------------------------------------------------------------
-- Pass 2: enrichment. Only agents with client_count > 0.
-- ---------------------------------------------------------------------------
create table if not exists agents (
  agent_id         bigint primary key
                     references agent_liveness(agent_id) on delete cascade,
  owner            text,
  agent_wallet     text,          -- JOIN KEY to bazaar_accepts.pay_to
  token_uri        text,
  -- 'other' is included beyond the three specified kinds: the probe found a
  -- tokenURI that is neither http, data: nor empty, and a CHECK that rejects
  -- it would abort the sweep on that row.
  token_uri_kind   text check (token_uri_kind in ('http','data','empty','other')),
  token_uri_host   text,          -- null for data:/empty
  metadata         jsonb,
  client_count     int not null default 0,
  feedback_count   bigint,        -- getSummary count  (uint64)
  summary_value    numeric,       -- getSummary summaryValue (int128, may be negative)
  summary_decimals int,           -- getSummary summaryValueDecimals (uint8)
  checked_at       timestamptz not null default now()
);

create index if not exists idx_agents_wallet on agents (agent_wallet);
create index if not exists idx_agents_host   on agents (token_uri_host);

-- ---------------------------------------------------------------------------
-- Resumable cursor. Required by the brief; no table was specified, so this is
-- proposed. One row per named sweep, so pass 1 and pass 2 resume independently.
-- ---------------------------------------------------------------------------
create table if not exists sweep_cursor (
  sweep_name   text primary key,
  next_id      bigint not null,
  ceiling_used bigint not null,
  batch_size   int    not null default 200,
  requests     bigint not null default 0,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- The point of the whole phase: agents whose wallet is a B402 payee.
-- Both sides are lowercase, so the join is a plain equality.
-- ---------------------------------------------------------------------------
create or replace view agent_bazaar_overlap as
  select a.agent_id,
         a.owner,
         a.agent_wallet,
         a.token_uri_host,
         a.client_count,
         a.feedback_count,
         c.resources        as bazaar_resources,
         c.pct_of_catalogue as bazaar_pct
  from agents a
  join bazaar_payee_concentration c on c.pay_to = a.agent_wallet
  order by c.resources desc;
