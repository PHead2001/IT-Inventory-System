import Link from 'next/link';
import {
  Boxes,
  Map,
  MapPin,
  History,
  LayoutDashboard,
  ScanLine,
  Tags,
} from 'lucide-react';
import { requireMember } from '@/lib/auth/session.server';
import { logout } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
export const dynamic = 'force-dynamic';
export default async function ApplicationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { member } = await requireMember();
  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-slate-900 focus:p-4"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-800 px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <Link
            href="/inventory"
            className="flex items-center gap-3 font-semibold"
          >
            <span className="rounded-lg bg-cyan-400/10 p-2 text-cyan-300">
              <Boxes size={22} />
            </span>
            IT Inventory
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400">
              {member.display_name}
              <span className="ml-2 rounded border border-slate-700 px-2 py-1 text-xs capitalize">
                {member.role}
              </span>
            </span>
            <form action={logout}>
              <Button variant="outline">Sign out</Button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-6 md:grid-cols-[190px_1fr] sm:px-8">
        <nav
          aria-label="Main navigation"
          className="flex flex-wrap gap-2 md:flex-col"
        >
          <Link
            className="flex min-h-11 items-center gap-3 rounded-md border border-slate-800 px-3 text-sm hover:bg-slate-900"
            href="/dashboard"
          >
            <LayoutDashboard size={18} />
            Overview
          </Link>
          <Link
            className="flex min-h-11 items-center gap-3 rounded-md border border-slate-800 px-3 text-sm hover:bg-slate-900"
            href="/inventory"
          >
            <Boxes size={18} />
            Inventory
          </Link>
          <Link
            className="flex min-h-11 items-center gap-3 rounded-md border border-slate-800 px-3 text-sm hover:bg-slate-900"
            href="/scan"
          >
            <ScanLine size={18} />
            Scan
          </Link>
          <Link
            className="flex min-h-11 items-center gap-3 rounded-md border border-slate-800 px-3 text-sm hover:bg-slate-900"
            href="/labels"
          >
            <Tags size={18} />
            Labels
          </Link>
          <Link
            className="flex min-h-11 items-center gap-3 rounded-md border border-slate-800 px-3 text-sm hover:bg-slate-900"
            href="/room"
          >
            <Map size={18} />
            Room
          </Link>
          <Link
            className="flex min-h-11 items-center gap-3 rounded-md border border-slate-800 px-3 text-sm hover:bg-slate-900"
            href="/locations"
          >
            <MapPin size={18} />
            Locations
          </Link>
          <Link
            className="flex min-h-11 items-center gap-3 rounded-md border border-slate-800 px-3 text-sm hover:bg-slate-900"
            href="/history"
          >
            <History size={18} />
            History
          </Link>
        </nav>
        <main id="main-content" className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
