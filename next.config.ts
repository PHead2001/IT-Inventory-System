import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
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
export default config;
