import { describe, expect, it } from 'vitest';
import corpus from '../../../data/unicode/option-label-corpus.json';
import {
  ambiguousOptionIds,
  normalizeOptionLabel,
  optionDisplayLabels,
  invalidOptionCollisionIds,
} from './option-label';
import { buildOptionIndex, designerIssues } from './designer-model';
import { metadataDefinition, type MetadataDefinition } from './contracts';
import { metadataDefinition as legacyDefinition } from '../../../tests/fixtures/metadata-baseline-contract';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
describe('pinned choice label identity', () => {
  it('matches the shared SQL corpus across the full official mapping and whitespace cases', () => {
    for (const { input, expected } of corpus)
      expect(normalizeOptionLabel(input), input).toBe(expected);
  });
  it('finds active ambiguity throughout the field and preserves display spelling and IDs', () => {
    const options = [
      { id: id(1), label: ' USB ', active: true },
      { id: id(2), label: 'usb', active: true },
      { id: id(3), label: 'USB', active: false },
      { id: id(4), label: 'usb', parent_id: id(1), active: true },
      { id: id(5), label: 'USB', parent_id: id(2), active: true },
    ];
    expect([...ambiguousOptionIds(options)]).toEqual([
      id(1),
      id(2),
      id(4),
      id(5),
    ]);
    expect(optionDisplayLabels(options).get(id(1))).toBe('USB');
    expect(buildOptionIndex(options).paths.get(id(4))).toBe('USB / usb (4)');
    expect(buildOptionIndex(options).paths.get(id(5))).toBe(
      'usb (2) / USB (5)',
    );
    options[2].active = true;
    expect(ambiguousOptionIds(options).has(id(3))).toBe(true);
  });
  it('reserves literal suffixes and includes inactive choices in revision order', () => {
    const options = [
      { id: id(1), label: 'Same', active: true },
      { id: id(2), label: 'same', active: false },
      { id: id(3), label: 'Same (2)', active: true },
      { id: id(4), label: 'Same', active: true },
    ];
    expect([...optionDisplayLabels(options).values()]).toEqual([
      'Same',
      'same (3)',
      'Same (2)',
      'Same (4)',
    ]);
    expect(optionDisplayLabels(options).get(id(2))).toBe(
      optionDisplayLabels(structuredClone(options)).get(id(2)),
    );
  });
  it('quotes literal path separators and quote characters without child-path ambiguity', () => {
    const options = [
      { id: id(1), label: 'A', active: true },
      { id: id(2), label: 'B', active: true, parent_id: id(1) },
      { id: id(3), label: 'A / B', active: true },
      { id: id(4), label: '"A / B"', active: true },
    ];
    const paths = [...buildOptionIndex(options).paths.values()];
    expect(new Set(paths).size).toBe(options.length);
    expect(paths[1]).toBe('A / B');
    expect(paths[2]).toBe('"A / B"');
  });
  it('reserves bare literal suffixes when retained whitespace-only labels normalize to an empty key', () => {
    const choices = [
      { id: id(1), label: '\u00a0', active: true },
      { id: id(2), label: '\ufeff', active: false },
      { id: id(3), label: '(2)', active: true },
    ];
    expect([...optionDisplayLabels(choices).values()]).toEqual([
      '\u00a0',
      '\ufeff (3)',
      '(2)',
    ]);
    expect(
      new Set(
        [...optionDisplayLabels(choices).values()].map(normalizeOptionLabel),
      ).size,
    ).toBe(3);
  });
  it('grandfathers only an entirely unchanged current published collision group', () => {
    const baseline = [
      { id: id(1), label: 'Café', active: true },
      { id: id(2), label: 'CAFÉ', active: true, parent_id: id(3) },
      { id: id(3), label: 'Parent', active: true },
    ];
    expect(
      invalidOptionCollisionIds([...baseline].reverse(), baseline).size,
    ).toBe(0);
    for (const patch of [
      { label: 'CAFÉ' },
      { label: ' Café ' },
      { parent_id: id(3) },
      { id: id(8) },
    ]) {
      const changed = baseline.map((option, index) =>
        index === 0 ? { ...option, ...patch } : option,
      );
      expect(invalidOptionCollisionIds(changed, baseline).size).toBe(2);
    }
    expect(
      invalidOptionCollisionIds(
        [...baseline, { id: id(9), label: 'café', active: true }],
        baseline,
      ).size,
    ).toBe(3);
    expect(
      invalidOptionCollisionIds(
        baseline,
        baseline.map((option, index) =>
          index === 0 ? { ...option, active: false } : option,
        ),
      ).size,
    ).toBe(2);
    expect(invalidOptionCollisionIds(baseline, []).size).toBe(2);
    expect(
      invalidOptionCollisionIds(
        baseline.map((option, index) =>
          index === 0 ? { ...option, active: false } : option,
        ),
        baseline,
      ).size,
    ).toBe(0);
    expect(
      invalidOptionCollisionIds(
        baseline.map((option, index) =>
          index === 0 ? { ...option, label: 'Unique' } : option,
        ),
        baseline,
      ).size,
    ).toBe(0);
  });
  it('reads ambiguous legacy definitions but blocks fresh designer publication', () => {
    const definition: MetadataDefinition = {
      fields: [
        {
          id: id(1),
          label: 'Connector',
          type: 'single_select',
          applies_to: ['quantity'],
          required: false,
          rules: {},
          options: [
            { id: id(2), label: 'Straße', active: true },
            { id: id(3), label: 'STRASSE', active: true },
          ],
        },
      ],
      layout: [],
    };
    expect(metadataDefinition.safeParse(definition).success).toBe(true);
    expect(legacyDefinition.safeParse(definition).success).toBe(true);
    expect(
      designerIssues(definition).filter((issue) =>
        issue.includes('indistinguishable'),
      ),
    ).toHaveLength(2);
    const baseline = structuredClone(definition);
    expect(
      designerIssues(definition, baseline).filter((issue) =>
        issue.includes('indistinguishable'),
      ),
    ).toHaveLength(0);
    const copied = structuredClone(definition);
    copied.fields[0].id = id(4);
    expect(
      designerIssues(copied, baseline).filter((issue) =>
        issue.includes('indistinguishable'),
      ),
    ).toHaveLength(2);
    definition.fields[0].options[1].active = false;
    expect(
      designerIssues(definition).some((issue) =>
        issue.includes('indistinguishable'),
      ),
    ).toBe(false);
  });
});
