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
