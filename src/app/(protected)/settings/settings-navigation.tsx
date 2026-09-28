'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const sections = [
  { href: '/settings/categories', label: 'Categories' },
  { href: '/settings/forms', label: 'Forms & fields' },
  { href: '/settings/locations', label: 'Storage locations' },
  { href: '/settings/sites', label: 'Properties & sites' },
  { href: '/settings/labels', label: 'Labels & printing' },
];

export function SettingsNavigation() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings sections"
      className="mb-6 flex flex-wrap gap-2 border-b border-slate-700 pb-4"
    >
      <Link
        href="/settings"
        aria-current={pathname === '/settings' ? 'page' : undefined}
        className="rounded px-3 py-2 text-sm text-cyan-200 hover:bg-slate-800 aria-[current=page]:bg-cyan-950 aria-[current=page]:text-white"
      >
        All settings
      </Link>
      {sections.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={
            pathname === href || pathname.startsWith(`${href}/`)
              ? 'page'
              : undefined
          }
          className="rounded px-3 py-2 text-sm text-cyan-200 hover:bg-slate-800 aria-[current=page]:bg-cyan-950 aria-[current=page]:text-white"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
