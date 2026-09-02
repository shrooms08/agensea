/**
 * Operator listings for display — SERVER ONLY.
 *
 * THE TABLE NEVER JUSTIFIES DISPLAY ON ITS OWN. Every listing is re-checked
 * against ownerOf(agent_id) on chain 56 before it renders: if the stored owner
 * no longer matches the registry — because the agent was transferred, or
 * because a row was inserted without going through our proof — the listing is
 * dropped. A forged row is inert.
 *
 * Nothing here calls an operator's endpoint. Execution through AgenSea is out
 * of scope in this build; the URL is displayed, never fetched for work.
 */
import 'server-only';
import { sbSelect } from '@/lib/supabase';
import { ownerOfOnChain } from '@/lib/server/claim';
import { AGENTS_WALLET } from '@/data/first-party-agents';

export interface Listing {
  agent_id: number; owner: string; name: string; description: string | null;
  category: string | null; delivers: string[] | null; input_schema: Record<string, unknown> | null;
  endpoint_url: string | null; price_u: string | null; status: string;
  claimed_at: string; listed_at: string | null;
}

const SELECT = 'select=agent_id,owner,name,description,category,delivers,input_schema,endpoint_url,price_u,status,claimed_at,listed_at';

/**
 * Drop any listing whose stored owner is not the current on-chain owner.
 *
 * The read is CACHED for the render path. A forged or stale row still cannot
 * appear — the chain is still asked — but it is asked when the page is built
 * rather than on every request, so listing a page does not force it out of
 * static rendering. The keepalive revalidates every six hours, which bounds how
 * long a listing can outlive a transfer. Authorising a claim is a different
 * question and still uses the uncached default: see lib/server/claim.ts.
 */
const OWNER_RECHECK_SECONDS = 21_600;   // 6h, matching the keepalive's revalidate

async function keepOwnerVerified(rows: Listing[]): Promise<Listing[]> {
  const checked = await Promise.all(rows.map(async (r) => {
    const onChain = await ownerOfOnChain(r.agent_id, { revalidate: OWNER_RECHECK_SECONDS });
    return onChain && onChain === r.owner.toLowerCase() ? r : null;
  }));
  return checked.filter((r): r is Listing => r !== null);
}

/**
 * Listings for the aggregate surfaces (marketplace, category pages).
 *
 * OUR OWN AGENTS ARE EXCLUDED. We hold the key to mainnet agent 322885 and can
 * legitimately claim it, but showing our own agent inside a section headed
 * "listed by their operators" would read as seeded supply on a site that labels
 * first-party everywhere else. The row stays in the table and its detail page
 * still renders — it is simply never counted as third-party supply.
 */
export async function getVerifiedListings(category?: string): Promise<Listing[]> {
  try {
    const q = `${SELECT}&status=eq.listed&owner=neq.${AGENTS_WALLET.toLowerCase()}${category ? `&category=eq.${category}` : ''}&order=listed_at.desc`;
    const { rows } = await sbSelect<Listing>('agent_listings', { query: q, revalidate: 300 });
    return await keepOwnerVerified(rows);
  } catch { return []; }
}

export async function getVerifiedListing(agentId: number): Promise<Listing | null> {
  try {
    const { rows } = await sbSelect<Listing>('agent_listings', {
      query: `${SELECT}&agent_id=eq.${agentId}&status=eq.listed`, revalidate: 300,
    });
    return (await keepOwnerVerified(rows))[0] ?? null;
  } catch { return null; }
}
