'use client';

import { createContext } from 'react';

/** Identity of the content admitted by canonical privacy, never live authority. */
export const RouteContentIdentityContext = createContext<{
  pathname: string | null;
  listHref: string;
} | null>(null);
