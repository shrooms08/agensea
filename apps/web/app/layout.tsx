import type { Metadata } from 'next';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import { MarkSparse, Wordmark } from '@/components/Logo';
import './globals.css';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['400','500','700'], variable: '--font-display', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400','500'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'AgenSea — an instrument for the BNB agent economy',
  description: 'Hireable agents and a registry explorer for ERC-8004 on BNB Chain.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <header style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: '18px 32px',
          borderBottom: '1px solid var(--border)',
        }}>
          <MarkSparse size={20} />
          <Wordmark height={18} />
          <nav style={{ marginLeft: 'auto', display: 'flex', gap: 24, font: "500 11px/1 var(--mono)", letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            <a href="/marketplace" style={{ color: 'var(--text-muted)' }}>Marketplace</a>
            <a href="/agents" style={{ color: 'var(--text-muted)' }}>Registry</a>
            <a href="/bazaar" style={{ color: 'var(--text-muted)' }}>Bazaar</a>
          </nav>
        </header>
        <main style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>{children}</main>
      </body>
    </html>
  );
}
