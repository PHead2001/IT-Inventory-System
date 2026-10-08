import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const foundationGates = Object.freeze([
  'checkout',
  'node_setup',
  'npm_setup',
  'install',
  'revision',
  'app',
  'db_start',
  'db_reset',
  'db_tests',
  'db_types',
  'browser_install',
  'e2e',
  'db_stop',
]);

// Actions exposes names, not YAML step IDs. These names are the evidence contract.
export const foundationStepNames = Object.freeze({
  checkout: 'Checkout tested revision',
  node_setup: 'Set up pinned Node',
  npm_setup: 'Set up pinned npm',
  install: 'Install locked dependencies',
  revision: 'Verify tested revision',
  app: 'Validate application',
  db_start: 'Start disposable database',
  db_reset: 'Reset disposable database',
  db_tests: 'Validate database',
  db_types: 'Verify database types',
  browser_install: 'Prepare browser',
  e2e: 'Validate browser workflows',
  db_stop: 'Stop disposable database',
});
export const fullCompletionStepName = 'Require every foundation gate';
export const requiredDecisionStepName = 'Require validation decision';
export const workflowSourceStepPrefix = 'Verify executed workflow ';

export function assertFoundationGates(outcomes) {
  const unsuccessful = foundationGates.filter(
    (gate) => outcomes[gate] !== 'success',
  );
  if (unsuccessful.length)
    throw new Error(
      'Unsuccessful foundation gates: ' + unsuccessful.join(', '),
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    assertFoundationGates(
      Object.fromEntries(
        foundationGates.map((gate) => [
          gate,
          process.env['FOUNDATION_' + gate.toUpperCase()],
        ]),
      ),
    );
    console.log('Every foundation gate passed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
