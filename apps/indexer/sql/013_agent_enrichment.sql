-- 013_agent_enrichment.sql — third-party metadata for agents our own sweep
-- could not resolve. INGESTED, never proxied: the 8004scan Pro key expires
-- 9 Sep 2026 and judging runs to 23 Sep, so nothing at runtime may call their
-- API. Rows are written once by apps/indexer (service_role) and read from here.
--
-- THE PLACEHOLDER FILTER IS THE POINT, so it is a CHECK CONSTRAINT rather than
-- only a line of ingest code. 8004scan never answers "no data": an agent it
-- cannot resolve comes back as a synthesized "Agent #<id>" with an empty
-- description and metadata_completeness_score 0.0 — 52% of a 40-agent sample
-- of our anonymous set. Presenting that filler as recovered metadata is the
-- exact failure this project exists to expose, so the database refuses it even
-- if a future ingest forgets to.
--
-- Everything here is attributed on screen ("Enriched from 8004scan, ingested
-- <date>") and is never mixed into our own measured figures.

create table if not exists public.agent_enrichment (
  agent_id     bigint primary key,
  name         text not null,
  description  text,
  protocols    jsonb not null default '[]'::jsonb,
  agent_url    text,
  is_verified  boolean,
  source       text not null default '8004scan',
  ingested_at  timestamptz not null default now(),

  -- Refuse their synthesized filler outright.
  constraint agent_enrichment_no_placeholder check (name !~ '^Agent #[0-9]+$'),
  -- A blank name carries no information either.
  constraint agent_enrichment_name_not_blank check (length(btrim(name)) > 0),
  -- Attribution is mandatory: a row with no source cannot be displayed honestly.
  constraint agent_enrichment_source_not_blank check (length(btrim(source)) > 0)
);

comment on table public.agent_enrichment is
  'Third-party agent metadata (8004scan), ingested not proxied. Displayed only with explicit attribution; never merged into our measured figures.';

-- ---------------------------------------------------------------------------
-- RLS — identical posture to 003_rls.sql. Supabase grants CRUD to anon on NEW
-- tables by default, so the revoke is required, not optional.
-- ---------------------------------------------------------------------------
alter table public.agent_enrichment enable row level security;
revoke all on public.agent_enrichment from anon, authenticated;
grant select on public.agent_enrichment to anon;
grant all on public.agent_enrichment to service_role;

drop policy if exists anon_read_agent_enrichment on public.agent_enrichment;
create policy anon_read_agent_enrichment
  on public.agent_enrichment for select to anon using (true);

-- ---------------------------------------------------------------------------
-- Assertions — the constraint must actually reject the filler, and anon must
-- hold SELECT and nothing else.
-- ---------------------------------------------------------------------------
do $$
declare n_ins int; n_anon text;
begin
  -- a real row is accepted
  insert into public.agent_enrichment (agent_id, name, description, protocols, source)
  values (999999801, 'Assertion Agent', 'a real description', '["MCP"]'::jsonb, 'assertion');
  get diagnostics n_ins = row_count;
  if n_ins <> 1 then raise exception 'assert: a real row should insert'; end if;

  -- their synthesized placeholder is refused by the database itself
  begin
    insert into public.agent_enrichment (agent_id, name, source)
    values (999999802, 'Agent #999999802', 'assertion');
    raise exception 'assert: placeholder name must be rejected';
  exception when check_violation then null;
  end;

  -- a blank name is refused
  begin
    insert into public.agent_enrichment (agent_id, name, source)
    values (999999803, '   ', 'assertion');
    raise exception 'assert: blank name must be rejected';
  exception when check_violation then null;
  end;

  -- anon may read and may not write
  select string_agg(privilege_type, ',' order by privilege_type) into n_anon
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'agent_enrichment' and grantee = 'anon';
  if n_anon is distinct from 'SELECT' then
    raise exception 'assert: anon should hold exactly SELECT, holds %', coalesce(n_anon, '(none)');
  end if;

  delete from public.agent_enrichment where source = 'assertion';
end $$;
