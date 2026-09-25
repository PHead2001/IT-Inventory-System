import { npm } from './runtime.mjs';
try {
  for (const script of [
    'typecheck',
    'lint',
    'format:check',
    'test',
    'test:preview-access',
    'test:export:memory',
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
