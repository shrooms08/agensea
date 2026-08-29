/**
 * STEP A PROBE — not a screen. Proves anon-key reads work from a SERVER
 * component against the live RLS policies, and that denials are denials.
 */
import { sbSelect, sbProbe } from '@/lib/supabase';
import { FIRST_PARTY_AGENTS } from '@/data/first-party-agents';

export const dynamic = 'force-dynamic';

export default async function Probe() {
  const agents = await sbSelect<{ agent_id: number }>('agents', {
    query: 'select=agent_id,owner,token_uri_kind&order=agent_id.asc', count: true, range: [0, 4],
  });
  const liveness = await sbSelect<{ agent_id: number }>('agent_liveness', {
    query: 'select=agent_id&client_count=gt.0', count: true, range: [0, 0],
  });
  const bazaar = await sbSelect<unknown>('bazaar_resources', { query: 'select=resource_url', count: true, range: [0, 0] });
  const payees = await sbSelect<unknown>('bazaar_payee_concentration', { query: 'select=*&limit=3' });
  const overlap = await sbSelect<unknown>('agent_bazaar_overlap', { query: 'select=*' });
  const denied = await sbProbe('sweep_cursor', 'select=*&limit=1');
  const curve = await sbProbe('agent_fanout_curve', 'select=*&limit=3');

  return (
    <main>
      <h1>Step A — data layer probe</h1>
      <pre>{JSON.stringify({
        readsViaAnonKey: {
          agents: { total: agents.total, sample: agents.rows.length },
          agent_liveness_with_clients: { total: liveness.total },
          bazaar_resources: { total: bazaar.total },
          bazaar_payee_concentration: payees.rows.length,
          agent_bazaar_overlap: overlap.rows.length,
        },
        mustBeDenied: { sweep_cursor: { status: denied.status, body: denied.body } },
        notYetApplied: { agent_fanout_curve: { status: curve.status, body: curve.body } },
        firstPartyAgents: FIRST_PARTY_AGENTS.map((a) => ({ id: a.agentId, slug: a.slug, jobs: a.jobs.map((j) => j.jobId) })),
      }, null, 2)}</pre>
    </main>
  );
}
