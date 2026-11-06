import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { npm, node, localStatus, localTestEnv } from './runtime.mjs';
import {
  installLocalStorageVersion,
  verifyLocalStorageRuntime,
} from './local-storage-version.mjs';
import {
  prepareLocalAuthTemplates,
  verifyLocalAuthTemplates,
} from './local-auth-templates.mjs';
import { preflightLocalSupabasePorts } from './local-supabase-ports.mjs';
const command = process.argv[2];
const cli = (...args) => npm(['exec', '--', 'supabase', ...args]);
const types = (check) => {
  localStatus();
  const generated =
    npm(
      [
        'exec',
        '--',
        'supabase',
        'gen',
        'types',
        'typescript',
        '--local',
        '--schema',
        'public',
      ],
      { capture: true },
    )
      .replace(/\r\n/g, '\n')
      .trimEnd() + '\n';
  const target = 'src/lib/supabase/database.types.ts';
  if (!check) {
    writeFileSync(target, generated);
    return;
  }
  if (readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== generated) {
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/database.types.ts', generated);
    throw new Error(
      'Generated database types differ. Run npm run db:types; CI generated output is in the failure artifact.',
    );
  }
};
const reset = async () => {
  localStatus();
  verifyLocalStorageRuntime();
  prepareLocalAuthTemplates();
  cli('db', 'reset', '--local');
  await verifyLocalAuthTemplates('reset');
};
const test = () => {
  const status = localStatus();
  verifyLocalStorageRuntime();
  cli('test', 'db');
  node(
    ['--import', 'tsx', 'tests/integration/foundation.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/inventory.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/low-stock-cap-cleanup.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/low-stock.ts'],
    localTestEnv(status),
  );
  node(
    [
      '--test',
      '--import',
      'tsx',
      'tests/integration/overview-contract.test.ts',
    ],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/overview.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/command-palette-timeout.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/configuration.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/metadata.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/metadata-form-save.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/metadata-compatibility.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/item-code.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/audit-three-contracts.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/custody.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/custody-reads.ts'],
    localTestEnv(status),
  );
  node(
    ['--import', 'tsx', 'tests/integration/files-completion.ts'],
    localTestEnv(status),
  );
  node(['tests/integration/preview-file-keys.mjs'], localTestEnv(status));
  node(['--import', 'tsx', 'tests/integration/files.ts'], localTestEnv(status));
};
try {
  if (command === 'start') {
    preflightLocalSupabasePorts();
    installLocalStorageVersion();
    prepareLocalAuthTemplates();
    cli('start');
    verifyLocalStorageRuntime();
    await verifyLocalAuthTemplates('startup');
  } else if (command === 'stop') cli('stop');
  else if (command === 'reset') await reset();
  else if (command === 'types') types(false);
  else if (command === 'types-check') types(true);
  else if (command === 'test') test();
  else if (command === 'test-form-save') {
    const status = localStatus();
    verifyLocalStorageRuntime();
    node(
      ['--import', 'tsx', 'tests/integration/metadata-form-save.ts'],
      localTestEnv(status),
    );
  } else if (command === 'test-compatibility') {
    const status = localStatus();
    verifyLocalStorageRuntime();
    node(
      ['--import', 'tsx', 'tests/integration/metadata-compatibility.ts'],
      localTestEnv(status),
    );
  } else if (command === 'validate') {
    await reset();
    test();
    types(true);
  } else throw new Error('Unknown local database command');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
