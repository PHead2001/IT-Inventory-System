import type { OverviewSnapshot } from './contracts';

export type OverviewResult =
  | { ok: true; snapshot: OverviewSnapshot; mayEdit: boolean }
  | {
      ok: false;
      code: 'forbidden' | 'unexpected';
      clearSnapshot: boolean;
      mayEdit?: boolean;
    };
