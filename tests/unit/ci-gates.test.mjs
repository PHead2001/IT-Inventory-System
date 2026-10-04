import { describe, expect, it } from 'vitest';
import {
  assertFoundationGates,
  foundationGates,
} from '../../scripts/ci-gates.mjs';

const successful = () =>
  Object.fromEntries(foundationGates.map((gate) => [gate, 'success']));

describe('required foundation completion', () => {
  it('accepts the complete successful gate', () => {
    expect(() => assertFoundationGates(successful())).not.toThrow();
  });

  it.each(foundationGates)(
    'rejects missing, failed, skipped or cancelled %s',
    (gate) => {
      for (const status of [undefined, 'failure', 'skipped', 'cancelled', '']) {
        const outcomes = successful();
        outcomes[gate] = status;
        expect(() => assertFoundationGates(outcomes)).toThrow(gate);
      }
    },
  );

  it('reports only fixed gate names, never untrusted result contents', () => {
    const outcomes = successful();
    outcomes.e2e = 'untrusted diagnostic contents';
    expect(() => assertFoundationGates(outcomes)).toThrow(
      'Unsuccessful foundation gates: e2e',
    );
  });
});
