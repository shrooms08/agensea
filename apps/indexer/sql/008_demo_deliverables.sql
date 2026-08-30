-- 008_demo_deliverables.sql
--
-- Persist demo-hire deliverable manifests so the footer's LAST JOB strip can
-- verify live demo jobs without event-log reads (ISR is eth_call-only).
-- The manifest is PUBLIC data — it is already on chain as a data: URL in the
-- submit event; this table is a queryable copy, not a secret.
--
-- Write path: the hire route calls demo_record_deliverable via PostgREST with
-- the anon key (same posture as demo_action_permit — the web app deliberately
-- holds no service key). First-writer-wins on job_id; the footer recomputes
-- keccak256(manifest) against the on-chain deliverable hash before rendering,
-- so a junk row can never surface — it can only make a job unrenderable.

create table if not exists public.demo_deliverables (
  job_id     bigint primary key,
  agent_id   integer not null,
  manifest   jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.demo_deliverables enable row level security;
revoke all on public.demo_deliverables from public, anon, authenticated;
grant select on public.demo_deliverables to anon;
grant all on public.demo_deliverables to service_role;

drop policy if exists demo_deliverables_anon_read on public.demo_deliverables;
create policy demo_deliverables_anon_read
  on public.demo_deliverables for select to anon using (true);

create or replace function public.demo_record_deliverable(
  p_job_id bigint, p_agent_id integer, p_manifest jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_job_id is null or p_job_id < 1 or p_job_id > 100000000 then
    raise exception 'job_id out of range';
  end if;
  if p_agent_id not in (2012, 2013, 2014, 2015) then
    raise exception 'unknown agent_id';
  end if;
  if pg_column_size(p_manifest) > 65536 then
    raise exception 'manifest too large';
  end if;
  insert into public.demo_deliverables (job_id, agent_id, manifest)
  values (p_job_id, p_agent_id, p_manifest)
  on conflict (job_id) do nothing;
  return found;
end;
$$;

revoke all on function public.demo_record_deliverable(bigint, integer, jsonb) from public, authenticated;
grant execute on function public.demo_record_deliverable(bigint, integer, jsonb) to anon, service_role;

-- Assertions ----------------------------------------------------------------
do $$
declare v boolean;
begin
  select public.demo_record_deliverable(99999901, 2012, '{"t":1}'::jsonb) into v;
  if not v then raise exception 'assert: first insert should report true'; end if;
  select public.demo_record_deliverable(99999901, 2013, '{"t":2}'::jsonb) into v;
  if v then raise exception 'assert: duplicate insert should report false'; end if;
  if (select agent_id from public.demo_deliverables where job_id = 99999901) <> 2012 then
    raise exception 'assert: first writer must win';
  end if;
  begin
    perform public.demo_record_deliverable(99999902, 9999, '{}'::jsonb);
    raise exception 'assert: unknown agent_id must be rejected';
  exception when others then
    if sqlerrm not like '%unknown agent_id%' then raise; end if;
  end;
  delete from public.demo_deliverables where job_id = 99999901;
end $$;
