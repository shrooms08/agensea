/**
 * Typed reads for the frontend. Every function here goes through a VIEW.
 * public.agents is not readable by anon (005_views.sql) and must never be
 * named in this file.
 */
import { sbSelect } from './supabase';

/**
 * ISR window for every read. Long by design.
 *
 * The Supabase project is on the FREE plan, which pauses after 7 days of low
 * activity, and judging runs 9-23 Sep unattended. A short revalidate means more
 * chances to re-query a database that may be paused; a long one means pages keep
 * serving the last good render from the CDN. Push fresh data deliberately with
 * POST /api/revalidate after a sweep instead of waiting for a window to lapse.
 *
 * NOTE: the fetch-level value wins over a page's `export const revalidate` when
 * it is shorter, so these must not be left small "just in case".
 */
const DAY = 86400;

export interface CurvePoint { threshold: number; qualifying_agents: number }
export interface RegistryStat { key: string; value: string; measured_at: string; note: string | null }

/** The full 31-row fan-out curve. Small enough to load once and never refetch. */
export async function getFanoutCurve(): Promise<CurvePoint[]> {
  const { rows } = await sbSelect<CurvePoint>('agent_fanout_curve', {
    query: 'select=threshold,qualifying_agents&order=threshold.asc',
    revalidate: DAY,
  });
  return rows;
}

/** Headline figures keyed by name, each carrying the date it was measured. */
export async function getRegistryStats(): Promise<Record<string, RegistryStat>> {
  const { rows } = await sbSelect<RegistryStat>('registry_stats', {
    query: 'select=key,value,measured_at,note&order=key.asc',
    revalidate: DAY,
  });
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}

export interface LiveAgent {
  agent_id: number; owner: string; client_count: number; clients: string[];
  checked_at: string; agent_wallet: string | null; token_uri: string | null;
  token_uri_kind: string | null; token_uri_host: string | null;
  metadata: unknown; feedback_count: string | null;
  summary_value: string | null; summary_decimals: number | null;
}

/** Server-side pagination. The full table — tracks
 *  registry_stats.agents_minted (317,468 as of 29 Aug 2026) — never reaches
 *  the client. */
export async function getLiveAgents(opts: { page: number; perPage: number; minFanout?: number }) {
  const from = opts.page * opts.perPage;
  return sbSelect<LiveAgent>('agent_liveness_with_clients', {
    query: 'select=agent_id,owner,client_count,checked_at,token_uri_kind,token_uri_host,feedback_count,summary_value&order=client_count.desc,agent_id.asc',
    count: true,
    range: [from, from + opts.perPage - 1],
    revalidate: DAY,
  });
}

export async function getAgent(agentId: number): Promise<LiveAgent | null> {
  const { rows } = await sbSelect<LiveAgent>('agent_liveness_with_clients', {
    query: `select=agent_id,owner,client_count,clients,checked_at,agent_wallet,token_uri,token_uri_kind,token_uri_host,metadata,feedback_count,summary_value,summary_decimals&agent_id=eq.${agentId}`, revalidate: DAY,
  });
  return rows[0] ?? null;
}

/** Base sweep row for ANY swept id — the fallback that makes every agent
 *  deep-linkable, zero-client agents included. Generic by design: the
 *  enriched view inner-joins clients, so without this a judge deep-linking
 *  any zero-client agent hits a 404. Enrichment fields are null (Pass 2
 *  deliberately only enriches agents with clients or payee owners). */
export async function getBareAgent(agentId: number): Promise<LiveAgent | null> {
  const { rows } = await sbSelect<Pick<LiveAgent, 'agent_id' | 'owner' | 'client_count' | 'clients' | 'checked_at'>>(
    'agent_liveness', { query: `select=agent_id,owner,client_count,clients,checked_at&agent_id=eq.${agentId}`, revalidate: DAY });
  const r = rows[0];
  if (!r) return null;
  return { ...r, agent_wallet: null, token_uri: null, token_uri_kind: null,
           token_uri_host: null, metadata: null, feedback_count: null,
           summary_value: null, summary_decimals: null };
}

/** Third-party metadata ingested from 8004scan (013_agent_enrichment).
 *  Read from OUR table — their API is never called at runtime, by design: the
 *  Pro key expires 9 Sep 2026 and judging runs to 23 Sep. Always displayed
 *  with attribution, never merged into our measured figures. */
export interface AgentEnrichment {
  agent_id: number; name: string; description: string | null;
  protocols: string[] | null; agent_url: string | null;
  is_verified: boolean | null; source: string; ingested_at: string;
}

export async function getAgentEnrichment(agentId: number): Promise<AgentEnrichment | null> {
  const { rows } = await sbSelect<AgentEnrichment>('agent_enrichment', {
    query: `select=agent_id,name,description,protocols,agent_url,is_verified,source,ingested_at&agent_id=eq.${agentId}`,
    revalidate: DAY,
  });
  return rows[0] ?? null;
}

export interface OverlapAgent extends LiveAgent { bazaar_resources: number; bazaar_pct: number }

/** Agent 127417 and anything like it: a B402 payee holding an ERC-8004 identity.
 *  Deliberately a separate surface so it never enters a counted set. */
export async function getOverlapAgent(agentId: number): Promise<OverlapAgent | null> {
  const { rows } = await sbSelect<OverlapAgent>('agent_overlap_detail', {
    query: `select=agent_id,owner,agent_wallet,token_uri,token_uri_kind,token_uri_host,metadata,client_count,feedback_count,summary_value,summary_decimals,checked_at,bazaar_resources,bazaar_pct&agent_id=eq.${agentId}`, revalidate: DAY,
  });
  return rows[0] ?? null;
}

export async function getAllOverlapAgents(): Promise<OverlapAgent[]> {
  const { rows } = await sbSelect<OverlapAgent>('agent_overlap_detail', {
    query: 'select=agent_id,owner,agent_wallet,token_uri,token_uri_kind,token_uri_host,metadata,client_count,feedback_count,summary_value,summary_decimals,checked_at,bazaar_resources,bazaar_pct&order=bazaar_resources.desc', revalidate: DAY,
  });
  return rows;
}

export interface BazaarResource { resource_url: string; resource_type: string | null; last_updated: string | null }
export interface Payee { pay_to: string; resources: number; pct_of_catalogue: number }

/** All resources — tracks registry_stats.bazaar_resources (978 as of 29 Aug
 *  2026). Paged to exhaustion by sbSelect; the rows stay on the
 *  server and only aggregates reach the client. */
export async function getBazaarResources(): Promise<BazaarResource[]> {
  const { rows } = await sbSelect<BazaarResource>('bazaar_resources', {
    query: 'select=resource_url,resource_type,last_updated&order=resource_url.asc',
    revalidate: DAY,
  });
  return rows;
}

export async function getPayees(): Promise<Payee[]> {
  const { rows } = await sbSelect<Payee>('bazaar_payee_concentration', {
    query: 'select=pay_to,resources,pct_of_catalogue&order=resources.desc',
    revalidate: DAY,
  });
  return rows;
}

/** Host of a resource URL. Mirrors the SQL index split_part(resource_url,'/',3). */
export function hostOf(url: string): string {
  try { return new URL(url).host.toLowerCase(); }
  catch { return url.split('/')[2]?.toLowerCase() ?? '(unparseable)'; }
}

export interface ClientConcentration {
  totalEdges: number; top2Edges: number; top2Pct: number; distinctClients: number;
}

/**
 * Client-side concentration, derived from client_fanout rather than written as
 * prose. The "two addresses account for N% of edges" line was hardcoded at 36%
 * and silently went stale when the sweep re-ran; computing it means it cannot.
 */
export async function getClientConcentration(): Promise<ClientConcentration> {
  const { rows } = await sbSelect<{ client: string; agent_count: number }>('client_fanout', {
    query: 'select=client,agent_count&order=agent_count.desc',
    revalidate: DAY,
  });
  const totalEdges = rows.reduce((n, r) => n + r.agent_count, 0);
  const top2Edges = rows.slice(0, 2).reduce((n, r) => n + r.agent_count, 0);
  return {
    totalEdges, top2Edges,
    top2Pct: totalEdges ? (100 * top2Edges) / totalEdges : 0,
    distinctClients: rows.length,
  };
}

export interface RegistryCategoryAgent {
  agent_id: number; client_count: number; token_uri_host: string | null;
  name: string | null; declared_category: string | null;
}

/**
 * Third-party registry agents for a category page.
 *
 * HOW MATCHING WAS DECIDED: of 4,353 agents with clients, 3,474 have metadata
 * but only 7 carry an explicit `category` key (122 have `skills`; 193 merely
 * mention category-like words somewhere in their metadata text). Keyword
 * inference over prose would mislabel agents, so matching uses ONLY the
 * explicit self-declared `category` key, mapped to this site's slugs. Pages
 * therefore show few third-party agents — or none — rather than mislabeled
 * ones. [M: SQL over agent_liveness_with_clients, 30 Aug 2026]
 */
const CATEGORY_ALIASES: Record<string, string[]> = {
  'rebalancing': ['rebalancing'],
  'grid-trading': ['grid', 'grid-trading'],
  'yield-optimisation': ['yield', 'yield-optimisation'],
  'health-factor-monitoring': ['health-factor', 'health-factor-monitoring'],
};

export async function getRegistryAgentsForCategory(slug: string): Promise<RegistryCategoryAgent[]> {
  const aliases = CATEGORY_ALIASES[slug] ?? [];
  if (aliases.length === 0) return [];
  const list = aliases.map((a) => `"${a}"`).join(',');
  const { rows } = await sbSelect<{ agent_id: number; client_count: number; token_uri_host: string | null; metadata: Record<string, unknown> | null }>(
    'agent_liveness_with_clients', {
      query: `select=agent_id,client_count,token_uri_host,metadata&metadata->>category=in.(${aliases.join(',')})&order=client_count.desc`,
      truncate: { reason: 'top 10 per category page', limit: 10 },
      revalidate: DAY,   // fetch-level revalidate WINS over the page export when shorter
    });
  void list;
  return rows.map((r) => ({
    agent_id: r.agent_id, client_count: r.client_count, token_uri_host: r.token_uri_host,
    name: (r.metadata?.name as string | undefined) ?? null,
    declared_category: (r.metadata?.category as string | undefined) ?? null,
  }));
}
