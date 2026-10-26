'use client';

import { createContext } from 'react';

/** Server primary's route identity, never readiness or privacy authority. */
export const RouteContentIdentityContext = createContext<{
  pathname: string | null;
  listHref: string;
  /** Exact server-primary source key; optional for unmanaged legacy callers. */
  rawRouteKey?: string;
} | null>(null);
