import type { NextConfig } from 'next';
export function createNextConfig(
  platform: NodeJS.Platform = process.platform,
  env: { CI?: string; VERCEL?: string } = {
    CI: process.env.CI,
    VERCEL: process.env.VERCEL,
  },
): NextConfig {
  return {
    poweredByHeader: false,
    // Page-data/static-generation workers share the host with local test tools.
    ...(platform === 'win32' && !env.CI && !env.VERCEL
      ? { experimental: { cpus: 2 } }
      : {}),
    outputFileTracingIncludes: {
      '/api/inventory-files/validate': [
        './src/features/files/inspect-worker.cjs',
        './node_modules/pdf-lib/**/*',
        './node_modules/sharp/**/*',
        './node_modules/@img/**/*',
      ],
    },
    async headers() {
      return [
        {
          source: '/:path*',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'no-referrer' },
            { key: 'X-Frame-Options', value: 'DENY' },
          ],
        },
      ];
    },
  };
}
export default createNextConfig();
