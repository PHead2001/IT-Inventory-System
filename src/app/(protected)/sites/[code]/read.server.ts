import 'server-only';
import { cache } from 'react';
import { getSite } from '@/features/custody/queries.server';

// Request-scoped sharing for metadata and this page; action reads remain fresh.
export const readSitePage = cache(getSite);
