import { npm } from './runtime.mjs';
try {
  for (const script of [
    'typecheck',
    'lint',
    'format:check',
    'test',
    'test:preview-access',
    'test:staging-user-sync',
    'test:staging-file-keys',
    'test:local-storage',
    'test:performance:contract',
    'test:export:memory',
    'test:file:inspection',
    'test:e2e:list',
    'build',
  ])
    npm(['run', script]);
  if (process.argv[2] === 'all') {
    npm(['run', 'validate:db']);
    npm(['run', 'test:e2e']);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
