export const metadata = { title: 'AgenSea — data layer probe' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body style={{ fontFamily: 'ui-monospace, monospace', padding: 24, lineHeight: 1.6 }}>{children}</body></html>;
}
