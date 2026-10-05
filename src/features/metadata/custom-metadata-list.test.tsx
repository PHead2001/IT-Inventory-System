import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CustomMetadataList } from './custom-metadata-list';
import { OperationalTimeProvider } from '@/components/operational-time';
import * as operationalTime from '@/lib/operational-time';

const field = '00000000-0000-4000-8000-000000000005';
const revision = '00000000-0000-4000-8000-000000000006';
it('formats only typed datetime values, preserving raw subseconds, date-only values and ISO-shaped text', () => {
  const zone = vi
    .spyOn(operationalTime, 'browserDisplayTimeZone')
    .mockReturnValue({ timeZone: 'America/Los_Angeles', fallback: false });
  const raw = '2026-10-03T05:23:06.123456Z';
  const common = {
    validated_revision_id: revision,
    option_paths: [],
    legacy: false,
  };
  const values = {
    datetime: {
      ...common,
      label: 'Observed instant',
      field_type: 'datetime',
      value: raw,
    },
    date: {
      ...common,
      label: 'Calendar day',
      field_type: 'date',
      value: '2024-02-29',
    },
    text: {
      ...common,
      label: 'Literal text',
      field_type: 'short_text',
      value: raw,
    },
  };
  const before = structuredClone(values);
  try {
    const { container } = render(
      <OperationalTimeProvider>
        <CustomMetadataList values={values} />
      </OperationalTimeProvider>,
    );
    expect(container.querySelectorAll('time')).toHaveLength(1);
    expect(container.querySelector('time')).toHaveAttribute('datetime', raw);
    expect(
      screen.getByText('2 Oct 2026, 22:23:06 UTC-07:00 (America/Los_Angeles)'),
    ).toBeVisible();
    expect(screen.getByText('2024-02-29')).toBeVisible();
    expect(screen.getByText(raw, { exact: true })).toBeVisible();
    expect(screen.getByText('Recorded timestamp: ' + raw)).not.toBeVisible();
    expect(values).toEqual(before);
  } finally {
    zone.mockRestore();
  }
});

it('shows historical labels, option paths, provenance and legacy status without replacing the value', () => {
  render(
    <CustomMetadataList
      needsMetadata
      values={{
        [field]: {
          label: 'Old location class',
          field_type: 'hierarchical_select',
          value: '00000000-0000-4000-8000-000000000007',
          validated_revision_id: revision,
          option_paths: [['Room', 'Cabinet', 'Shelf']],
          legacy: true,
        },
      }}
    />,
  );
  const region = screen.getByRole('region', { name: 'Custom metadata' });
  expect(region).toHaveTextContent('Old location class');
  expect(region).toHaveTextContent('Room / Cabinet / Shelf');
  expect(region).toHaveTextContent(`validated revision ${revision}`);
  expect(region).toHaveTextContent('Legacy value');
  expect(region).toHaveTextContent('needs metadata review');
});
