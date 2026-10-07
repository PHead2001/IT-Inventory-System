import { describe, expect, it } from 'vitest';
import corpus from '../../../data/unicode/option-label-corpus.json';
import {
  ambiguousOptionIds,
  normalizeOptionLabel,
  optionDisplayLabels,
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
  it('scopes active ambiguity to siblings and preserves display spelling and IDs', () => {
    const options = [
      { id: id(1), label: ' USB ', active: true },
      { id: id(2), label: 'usb', active: true },
      { id: id(3), label: 'USB', active: false },
      { id: id(4), label: 'usb', parent_id: id(1), active: true },
      { id: id(5), label: 'USB', parent_id: id(2), active: true },
    ];
    expect([...ambiguousOptionIds(options)]).toEqual([id(1), id(2)]);
    expect(optionDisplayLabels(options).get(id(1))).toBe(
      ` USB  [choice ${id(1)}]`,
    );
    expect(buildOptionIndex(options).paths.get(id(4))).toBe(
      ` USB  [choice ${id(1)}] / usb`,
    );
    expect(buildOptionIndex(options).paths.get(id(5))).toBe(
      `usb [choice ${id(2)}] / USB`,
    );
    options[2].active = true;
    expect(ambiguousOptionIds(options).has(id(3))).toBe(true);
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
    definition.fields[0].options[1].active = false;
    expect(
      designerIssues(definition).some((issue) =>
        issue.includes('indistinguishable'),
      ),
    ).toBe(false);
  });
});
