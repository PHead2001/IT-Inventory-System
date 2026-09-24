import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CustomMetadataList } from './custom-metadata-list';

const field = '00000000-0000-4000-8000-000000000005';
const revision = '00000000-0000-4000-8000-000000000006';

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
