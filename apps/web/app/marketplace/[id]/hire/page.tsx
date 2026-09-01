/**
 * /marketplace/[id]/hire — what you are about to sign, then the run.
 *
 * Split out of the listing so the listing can describe the service and this
 * page can do one thing. Everything here already existed inside WalletHire; the
 * component renders this surface under mode="hire" rather than a second copy of
 * the hire machinery.
 *
 * THE TARGET ARRIVES AS ?target=. A query param because this route has to be
 * shareable and the back button has to return to the listing — a form POST is
 * neither, and back would re-post it. The param is NOT trusted: WalletHire runs
 * the same on-chain check it runs on the listing, and Confirm stays disabled
 * until it passes, so a hand-typed target cannot reach a signature.
 *
 * Dynamic, not ISR: it reads searchParams. dynamicParams stays false so an
 * unknown agent id 404s here exactly as it does on the listing.
 */
import { notFound } from 'next/navigation';
import { FIRST_PARTY_AGENTS, byId, ERC8183 } from '@/data/first-party-agents';
import { DELIVERS, TARGETS } from '@/data/hire-spec';
import { WalletHire } from '@/components/WalletHire';
import { HireDemo } from '@/components/HireDemo';
import { SponsoredFallback } from '@/components/SponsoredFallback';

export const dynamicParams = false;

export function generateStaticParams() {
  return FIRST_PARTY_AGENTS.map((a) => ({ id: String(a.agentId) }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = byId(Number(id));
  return { title: agent ? `Hire ${agent.name}` : 'Hire' };
}

export default async function HireAgent({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const agent = byId(Number(id));
  if (!agent) notFound();

  const sp = await searchParams;
  const raw = sp.target;
  const target = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;

  const s = agent.session;

  return (
    <WalletHire
      mode="hire"
      agentId={agent.agentId}
      agentName={agent.name}
      priceLabel={agent.priceLabel}
      initialTarget={target}
      delivers={DELIVERS[agent.agentId] ?? []}
      targetSpec={TARGETS[agent.agentId]!}
      session={{
        capTBnb: (Number(s.spendCapWei) / 1e18).toFixed(6),
        signature: s.calls[0]?.signature ?? 'submit(uint256,bytes32,bytes)',
        commerce: ERC8183.commerce,
        expiryLabel: new Date(s.expiryUnix * 1000).toISOString().slice(0, 10),
      }}
      sponsored={
        <SponsoredFallback>
          <HireDemo agentId={agent.agentId} completedCount={agent.jobs.filter((j) => j.status === 'COMPLETED').length} />
        </SponsoredFallback>
      }
    />
  );
}
