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
        <header style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 32px' }}>
            <MarkSparse size={20} />
            <Wordmark height={18} />
            <nav style={{ marginLeft: 'auto', display: 'flex', gap: 24 }}>
              <a className="label" href="/marketplace">Marketplace</a>
              <a className="label" href="/agents">Registry</a>
              <a className="label" href="/bazaar">Bazaar</a>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
