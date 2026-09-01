/**
 * An operator's listing. Deliberately NOT the first-party card: no FIRST-PARTY
 * badge, a status chip stating it is not hireable here, and a dashed border so
 * it never reads as one of ours at a glance.
 */
import { CAT_TOKEN, CAT_LABEL } from '@/components/CategoryChip';
import type { CategorySlug } from '@/data/first-party-agents';
import type { Listing } from '@/lib/server/listings';

export function ListingCard({ l }: { l: Listing }) {
  const slug = l.category as CategorySlug | null;
  return (
    <a href={`/listing/${l.agent_id}`} className="listing-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {slug && (
          <span className="label" style={{ fontSize: 10, color: CAT_TOKEN[slug], display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, background: CAT_TOKEN[slug], flex: 'none' }} />
            {CAT_LABEL[slug]}
          </span>
        )}
        <span className="listing-chip">listed · not yet hireable through AgenSea</span>
      </div>
      <div style={{ font: "500 16px/1.3 var(--display)", color: 'var(--text)', marginTop: 16 }}>{l.name}</div>
      {l.description && <p className="prose-sm prose-muted listing-desc">{l.description}</p>}
      <div className="listing-foot">
        <span className="data" style={{ color: 'var(--text-muted)' }}>
          agent #{l.agent_id} · owner {l.owner.slice(0, 6)}…{l.owner.slice(-4)}
        </span>
        <span className="data" style={{ color: 'var(--text-muted)' }}>
          {l.price_u !== null ? `${Number(l.price_u)} $U` : 'price not set'} →
        </span>
      </div>
    </a>
  );
}
