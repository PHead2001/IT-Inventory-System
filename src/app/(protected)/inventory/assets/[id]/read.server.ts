import 'server-only';
import { cache } from 'react';
import { getAssetDetail } from '@/features/inventory/queries.server';

// Request-scoped sharing for metadata and this page; action reads remain fresh.
export const readAssetPage = cache(getAssetDetail);
