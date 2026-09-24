import 'server-only';
import { getAppOrigin } from '@/lib/auth/origin';

/** Labels must outlive commit deployments. Production has no inferred fallback. */
export function getLabelOrigin(): { origin: string; preview: boolean } {
  const production =
    process.env.VERCEL_ENV === 'production' ||
    process.env.APP_ENV === 'production';
  if (production && !process.env.APP_ORIGIN) {
    throw new Error('APP_ORIGIN must be configured for production labels.');
  }
  if (
    process.env.VERCEL_ENV === 'preview' &&
    !process.env.APP_ORIGIN &&
    !process.env.VERCEL_BRANCH_URL
  ) {
    throw new Error('A stable preview origin is required for preview labels.');
  }
  const origin = getAppOrigin();
  if (production && !origin.startsWith('https://')) {
    throw new Error('Production label origin must use HTTPS.');
  }
  return { origin, preview: !production };
}
