import { describe, expect, it, vi } from 'vitest';
import {
  pushNodeOptions,
  runPushValidation,
} from '../../scripts/validate-push.mjs';

describe('bounded local push validation', () => {
  it('runs only canonical cheap checks sequentially with two Vitest workers', () => {
    const run = vi.fn();
    const env = {
      NODE_OPTIONS: '--trace-warnings --max-old-space-size=512',
      FIXTURE: 'retained',
    };
    runPushValidation({ run, env });
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ['run', 'typecheck'],
      ['run', 'lint'],
      ['run', 'format:check'],
      ['run', 'test', '--', '--maxWorkers=2'],
    ]);
    for (const [args, options] of run.mock.calls)
      expect(options.env).toEqual({
        NODE_OPTIONS: `--trace-warnings --max-old-space-size=${args[1] === 'typecheck' ? 2048 : 1024}`,
        FIXTURE: 'retained',
      });
    expect(env.NODE_OPTIONS).toBe('--trace-warnings --max-old-space-size=512');
  });

  it.each([0, 1, 2, 3])('stops immediately when check %s fails', (failure) => {
    const run = vi.fn(() => {
      if (run.mock.calls.length === failure + 1) throw new Error('gate failed');
    });
    expect(() => runPushValidation({ run, env: {} })).toThrow('gate failed');
    expect(run).toHaveBeenCalledTimes(failure + 1);
  });

  it.each([
    undefined,
    '',
    '--max-old-space-size=512',
    '--max_old_space_size=8192',
    '--max-old-space-size 512',
    '--max_old_space_size "8192"',
    '"--max-old-space-size=512"',
    '--max-old-space-size="512"',
    '--max-old-space-size=512 --max-old-space-size=4096',
    '--max-old-space-size-percentage=90 --max_old_space_size_percentage 80',
  ])(
    'replaces inherited heap flags with the fixed local budget: %s',
    (options) => {
      expect(pushNodeOptions(options)).toBe('--max-old-space-size=1024');
      expect(pushNodeOptions(options, 2048)).toBe('--max-old-space-size=2048');
    },
  );

  it.each([0, 512, 4096, '2048', null, NaN, Infinity])(
    'refuses arbitrary heap budgets: %s',
    (heapMiB) => {
      expect(() => pushNodeOptions('', heapMiB)).toThrow(
        'Unsupported local push heap budget',
      );
    },
  );

  it('preserves unrelated quoted and escaped options without shell interpretation', () => {
    const preserved =
      '--require="C:\\Program Files\\fixture.cjs" --trace-warnings';
    expect(pushNodeOptions(preserved + ' --max-old-space-size 512')).toBe(
      preserved + ' --max-old-space-size=1024',
    );
  });

  it.each([
    '--require="unfinished',
    '--max-old-space-size',
    '--max-old-space-size --trace-warnings',
  ])(
    'rejects malformed inherited options before running any checks: %s',
    (NODE_OPTIONS) => {
      const run = vi.fn();
      expect(() => runPushValidation({ run, env: { NODE_OPTIONS } })).toThrow(
        'NODE_OPTIONS',
      );
      expect(run).not.toHaveBeenCalled();
    },
  );
});
