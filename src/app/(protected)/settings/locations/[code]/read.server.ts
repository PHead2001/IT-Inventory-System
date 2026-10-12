import 'server-only';
import { cache } from 'react';
import { getManagedLocations } from '@/features/custody/queries.server';

export const readManagedLocationPage = cache(async (code: string) => {
  const locations = await getManagedLocations();
  return locations.find((location) => location.code === code) ?? null;
});
