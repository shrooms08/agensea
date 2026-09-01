'use client';
/** Nav with a visible hover state and an indicated active route. */
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/marketplace', 'Marketplace'],
  ['/compare', 'Compare'],
  ['/agents', 'Registry'],
  ['/bazaar', 'Bazaar'],
] as const;

export function Nav() {
  const path = usePathname() ?? '/';
  return (
    <nav style={{ marginLeft: 'auto', display: 'flex', gap: 24 }}>
      {LINKS.map(([href, label]) => {
        const active = path === href || path.startsWith(href + '/');
        return (
          <a key={href} href={href} className="label navlink" data-active={active} aria-current={active ? 'page' : undefined}>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
