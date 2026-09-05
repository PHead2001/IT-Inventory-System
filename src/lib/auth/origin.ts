import { z } from 'zod';

// Server configuration only; never infer callback hosts from request headers.
export function getAppOrigin(): string {
  const branch = process.env.VERCEL_BRANCH_URL;
  const value =
    process.env.APP_ORIGIN ??
    (branch
      ? 'https://' + branch.replace(/^https?:\/\//i, '')
      : 'http://localhost:3000');
  return new URL(z.url({ protocol: /^https?$/ }).parse(value)).origin;
}
