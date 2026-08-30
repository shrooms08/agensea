/**
 * /dev/hero — isolated tuning route for the particle hero. noindex.
 * The caption figure is read live from registry_stats, same as everywhere else.
 */
import { getRegistryStats } from '@/lib/queries';
import { ParticleHero } from '@/components/ParticleHero';
import { int } from '@/lib/format';

export const metadata = {
  title: 'dev/hero',
  robots: { index: false, follow: false },
};
export const revalidate = 86400;

export default async function DevHero() {
  const stats = await getRegistryStats();
  const minted = int(Number(stats['agents_minted']!.value));
  const heard = int(Number(stats['agents_with_client']!.value));
  return (
    <>
      <ParticleHero
        caption={`${minted} minted. ${heard} ever heard from.`}
        sub="A marketplace and registry explorer for ERC-8004 on BNB Chain."
        fallback="static"
      />
      <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="label">— page continues below the hero —</span>
      </div>
    </>
  );
}
