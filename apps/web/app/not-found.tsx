import { ParticleCreature } from '@/components/ParticleCreature';

export default function NotFound() {
  return (
    <section style={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
      <ParticleCreature tag="404" />
      <p className="prose-sm prose-muted" style={{ marginTop: 8, textAlign: 'center' }}>
        This page has never had a client.
      </p>
      <a href="/" className="label" style={{ marginTop: 18, color: 'var(--live)', border: '1px solid var(--border-strong)', padding: '8px 14px' }}>
        Back to the registry
      </a>
    </section>
  );
}
