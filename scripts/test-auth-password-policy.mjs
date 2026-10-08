import { withLocalPasswordPolicy } from './local-auth-password-policy.mjs';
import { localStatus, localTestEnv, node, npm } from './runtime.mjs';

try {
  const status = localStatus();
  await withLocalPasswordPolicy(async () => {
    node(
      ['--import', 'tsx', 'tests/integration/auth-password-policy.ts'],
      localTestEnv(status),
    );
  });
  console.log(
    'Original local Auth container restored after password-policy validation.',
  );
  // Canonical E2E owns its own policy fixture; never nest two container owners.
  if (process.argv.includes('--browser'))
    npm(['run', 'test:e2e', '--', 'foundation.spec.ts']);
} catch {
  // Provider/engine errors can contain request credentials. Report only fixed copy.
  console.error(
    'Disposable local Auth policy validation failed. The fixture attempted to restore the original Auth container.',
  );
  process.exitCode = 1;
}
