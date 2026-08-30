import type { Metadata } from 'next';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import { Mark, Wordmark } from '@/components/Logo';
import { Nav } from '@/components/Nav';
import './globals.css';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['400','500','700'], variable: '--font-display', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400','500'], variable: '--font-mono', display: 'swap' });

/**
 * Icons and OG images are wired by Next's FILE conventions, not by this object:
 *   app/favicon.ico        -> <link rel="icon"> (16 + 32 in one ICO container)
 *   app/icon.svg           -> scalable icon, preferred by modern browsers
 *   app/apple-icon.png     -> <link rel="apple-touch-icon"> (180x180)
 *   app/opengraph-image.png / app/twitter-image.png -> og:image / twitter:image
 * Verified against node_modules/next/dist/docs/.../01-metadata/app-icons.md —
 * note the filename is apple-icon, NOT apple-touch-icon.
 *
 * metadataBase makes the OG image resolve to an absolute URL, which Discord,
 * Twitter and Telegram all require; a relative path renders no card.
 */
export const metadata: Metadata = {
  metadataBase: new URL('https://agensea-navy.vercel.app'),
  title: {
    // template applies to CHILD segments only, and default is required with it.
    // app/page.tsx shares the root segment, so "/" renders the bare default.
    default: 'AgenSea',
    template: '%s — AgenSea',
  },
  // Kept under ~160 chars: opengraph.xyz flagged the previous 185-char version
  // as one Google would truncate in search results.
  description:
    'A marketplace and registry explorer for ERC-8004 on BNB Chain. Every figure measured '
    + 'from a full sweep; every agent deliverable verifiable on-chain.',
  applicationName: 'AgenSea',
  openGraph: {
    type: 'website',
    siteName: 'AgenSea',
    title: 'AgenSea — most agents on chain have never been used',
    description:
      'A marketplace and registry explorer for ERC-8004 on BNB Chain. Every figure measured, '
      + 'every deliverable verifiable.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgenSea — most agents on chain have never been used',
    description:
      'A marketplace and registry explorer for ERC-8004 on BNB Chain. Every figure measured, '
      + 'every deliverable verifiable.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>
        <header className="site-header">
          <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 32px' }}>
            <a href="/" className="brand" aria-label="AgenSea home">
              <Mark size={22} />
              <Wordmark height={18} />
            </a>
            <Nav />
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
