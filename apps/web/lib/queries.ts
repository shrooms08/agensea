/**
 * Typed reads for the frontend. Every function here goes through a VIEW.
 * public.agents is not readable by anon (005_views.sql) and must never be
 * named in this file.
 */
import { sbSelect } from './supabase';

export interface CurvePoint { threshold: number; qualifying_agents: number }
export interface RegistryStat { key: string; value: string; measured_at: string; note: string | null }

/** The full 31-row fan-out curve. Small enough to load once and never refetch. */
export async function getFanoutCurve(): Promise<CurvePoint[]> {
  const { rows } = await sbSelect<CurvePoint>('agent_fanout_curve', {
    query: 'select=threshold,qualifying_agents&order=threshold.asc',
    revalidate: 3600,
  });
  return rows;
}

/** Headline figures keyed by name, each carrying the date it was measured. */
export async function getRegistryStats(): Promise<Record<string, RegistryStat>> {
  const { rows } = await sbSelect<RegistryStat>('registry_stats', {
    query: 'select=key,value,measured_at,note&order=key.asc',
    revalidate: 3600,
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

/** Server-side pagination. 301,992 rows never reach the client. */
export async function getLiveAgents(opts: { page: number; perPage: number; minFanout?: number }) {
  const from = opts.page * opts.perPage;
  return sbSelect<LiveAgent>('agent_liveness_with_clients', {
    query: 'select=agent_id,owner,client_count,checked_at,token_uri_kind,token_uri_host,feedback_count,summary_value&order=client_count.desc,agent_id.asc',
    count: true,
    range: [from, from + opts.perPage - 1],
    revalidate: 300,
  });
}

export async function getAgent(agentId: number): Promise<LiveAgent | null> {
  const { rows } = await sbSelect<LiveAgent>('agent_liveness_with_clients', {
    query: `select=agent_id,owner,client_count,clients,checked_at,agent_wallet,token_uri,token_uri_kind,token_uri_host,metadata,feedback_count,summary_value,summary_decimals&agent_id=eq.${agentId}`, revalidate: 300,
  });
  return rows[0] ?? null;
}

export interface OverlapAgent extends LiveAgent { bazaar_resources: number; bazaar_pct: number }

/** Agent 127417 and anything like it: a B402 payee holding an ERC-8004 identity.
 *  Deliberately a separate surface so it never enters a counted set. */
export async function getOverlapAgent(agentId: number): Promise<OverlapAgent | null> {
  const { rows } = await sbSelect<OverlapAgent>('agent_overlap_detail', {
    query: `select=agent_id,owner,agent_wallet,token_uri,token_uri_kind,token_uri_host,metadata,client_count,feedback_count,summary_value,summary_decimals,checked_at,bazaar_resources,bazaar_pct&agent_id=eq.${agentId}`, revalidate: 300,
  });
  return rows[0] ?? null;
}

export async function getAllOverlapAgents(): Promise<OverlapAgent[]> {
  const { rows } = await sbSelect<OverlapAgent>('agent_overlap_detail', {
    query: 'select=agent_id,owner,agent_wallet,token_uri,token_uri_kind,token_uri_host,metadata,client_count,feedback_count,summary_value,summary_decimals,checked_at,bazaar_resources,bazaar_pct&order=bazaar_resources.desc', revalidate: 3600,
  });
  return rows;
}
