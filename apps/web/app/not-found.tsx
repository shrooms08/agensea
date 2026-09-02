import Link from 'next/link';
import { ParticleCreature } from '@/components/ParticleCreature';

export default function NotFound() {
  return (
    <section style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
      <ParticleCreature tag="404" intensity={0.8} />
      {/* Solid --bg so the text stays readable when the creature passes under. */}
      <div style={{ background: 'var(--bg)', padding: '22px 28px', textAlign: 'center' }}>
        <p className="prose-sm prose-muted" style={{ margin: 0 }}>
          This page has never had a client.
        </p>
        <Link href="/" className="label" style={{ marginTop: 18, display: 'inline-block', color: 'var(--live)', border: '1px solid var(--border-strong)', padding: '8px 14px' }}>
          Back to the registry
        </Link>
      </div>
    </section>
  );
}
