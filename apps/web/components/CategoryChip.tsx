import type { CategorySlug } from '@/data/first-party-agents';

export const CAT_TOKEN: Record<CategorySlug, string> = {
  'rebalancing': 'var(--cat-rebalancing)',
  'grid-trading': 'var(--cat-grid)',
  'yield-optimisation': 'var(--cat-yield)',
  'health-factor-monitoring': 'var(--cat-health)',
};

export const CAT_LABEL: Record<CategorySlug, string> = {
  'rebalancing': 'Rebalancing',
  'grid-trading': 'Grid execution',
  'yield-optimisation': 'Yield optimisation',
  'health-factor-monitoring': 'Health factor',
};

export function CategoryChip({ slug }: { slug: CategorySlug }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      font: "500 10px/1 var(--mono)", letterSpacing: '0.12em', textTransform: 'uppercase',
      color: 'var(--text-muted)',
    }}>
      <span style={{ width: 7, height: 7, background: CAT_TOKEN[slug], display: 'inline-block' }} />
      {CAT_LABEL[slug]}
    </span>
  );
}

/** FIRST-PARTY badge. --accent is reserved in the reference for exactly two
 *  things: selection state and this badge. Never decoration. */
export function FirstPartyBadge() {
  return (
    <span style={{
      font: "500 9px/1 var(--mono)", letterSpacing: '0.12em', textTransform: 'uppercase',
      color: 'var(--accent)', border: '1px solid #4a0866', padding: '4px 6px',
    }}>
      First-party
    </span>
  );
}
