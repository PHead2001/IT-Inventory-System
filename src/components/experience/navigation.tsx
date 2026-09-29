'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import { MotionToggle } from './motion-preference';
import {
  Boxes,
  Map,
  MapPin,
  Building2,
  History,
  LayoutDashboard,
  ScanLine,
  Tags,
  Settings,
  Menu,
  X,
} from 'lucide-react';

const groups = [
  {
    name: 'Operations',
    items: [
      { href: '/dashboard', label: 'Overview', Icon: LayoutDashboard },
      { href: '/inventory', label: 'Inventory', Icon: Boxes },
    ],
  },
  {
    name: 'Spatial',
    items: [
      { href: '/room', label: 'Spaces & maps', Icon: Map },
      { href: '/locations', label: 'Locations', Icon: MapPin },
      { href: '/sites', label: 'Properties / sites', Icon: Building2 },
    ],
  },
  {
    name: 'Tools',
    items: [
      { href: '/scan', label: 'Scan', Icon: ScanLine },
      { href: '/labels', label: 'Labels', Icon: Tags },
      { href: '/history', label: 'History', Icon: History },
    ],
  },
  {
    name: 'Configuration',
    items: [{ href: '/settings', label: 'Settings', Icon: Settings }],
  },
];

export function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = groups
    .flatMap((group) => group.items)
    .filter(
      (item) => pathname === item.href || pathname?.startsWith(`${item.href}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <>
      <div className="experience-nav-controls">
        <button
          type="button"
          className="experience-mobile-menu"
          aria-controls="experience-navigation"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <X size={18} aria-hidden="true" />
          ) : (
            <Menu size={18} aria-hidden="true" />
          )}
          {open ? 'Close menu' : 'Menu'}
        </button>
        <MotionToggle />
      </div>
      <nav
        id="experience-navigation"
        aria-label="Main navigation"
        className={`experience-navigation ${open ? 'is-open' : ''}`}
      >
        <LayoutGroup id="primary-navigation">
          {groups.map((group) => (
            <div className="experience-nav-group" key={group.name}>
              <p className="experience-nav-heading">{group.name}</p>
              {group.items.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className="experience-nav-link"
                  aria-current={active === href ? 'page' : undefined}
                >
                  {active === href && (
                    <motion.span
                      layoutId="navigation-active"
                      className="experience-nav-indicator"
                      transition={{
                        type: 'spring',
                        stiffness: 520,
                        damping: 43,
                      }}
                    />
                  )}
                  <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          ))}
        </LayoutGroup>
      </nav>
    </>
  );
}
