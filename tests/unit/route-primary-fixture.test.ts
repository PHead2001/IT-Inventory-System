// @vitest-environment node
import { expect, it } from 'vitest';
import { routePrimaryFixture } from '../helpers/route-primary-fixture';

it.each(['primary', 'paired'] as const)(
  'bundles the actual %s region topology and installed Next React without a fixture body boundary',
  async (kind) => {
    const fixture = await routePrimaryFixture(kind);
    for (const source of [
      'route-ready.tsx',
      'inventory-capture-region.tsx',
      'paired-inventory-content.tsx',
      'auxiliary-route-capture.ts',
    ])
      expect(fixture.inputs.some((input) => input.endsWith('/' + source))).toBe(
        true,
      );
    expect(
      fixture.inputs.some((input) =>
        input.includes('next/dist/compiled/react-dom/'),
      ),
    ).toBe(true);
    expect(
      fixture.inputs.some((input) =>
        input.endsWith('loading-skeleton.module.css'),
      ),
    ).toBe(true);
    expect(fixture.styles.length).toBeGreaterThan(0);
    expect(fixture.script).toContain('startTransition');
    expect(fixture.script).not.toContain('geometry-body');
  },
);
