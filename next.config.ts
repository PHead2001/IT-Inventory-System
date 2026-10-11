import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import {
  createBuildProvenance,
  type BuildInputs,
} from './src/features/build-info/provenance';
import { version } from './package.json';
import { createConfigSnapshotReader } from './src/features/build-info/config-snapshot';
const configurationStarted = new Date();
const configSnapshot = createConfigSnapshotReader();
export function createNextConfig(
  platform: NodeJS.Platform = process.platform,
  env: BuildInputs & { CI?: string } = {
    CI: process.env.CI,
    VERCEL: process.env.VERCEL,
    APP_ENV: process.env.APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_TARGET_ENV: process.env.VERCEL_TARGET_ENV,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  },
  phase?: string,
  compiledSnapshot?: string,
): NextConfig {
  return {
    env: {
      APP_BUILD_PROVENANCE:
        compiledSnapshot ??
        JSON.stringify(
          createBuildProvenance(
            env,
            version,
            phase === PHASE_PRODUCTION_BUILD,
            configurationStarted,
          ),
        ),
    },
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
export default function nextConfig(phase: string) {
  const productionBuild =
    phase === PHASE_PRODUCTION_BUILD &&
    (process.argv[2] === 'build' ||
      process.env.NEXT_PRIVATE_BUILD_WORKER === '1');
  return createNextConfig(
    process.platform,
    undefined,
    phase,
    configSnapshot(process.env, version, productionBuild),
  );
}
