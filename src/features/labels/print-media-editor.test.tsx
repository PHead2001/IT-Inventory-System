import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PrintMediaEditor } from './print-media-editor';
it('retains invalid raw fields and requires valid custom geometry or explicit reset', () => {
  const changed = vi.fn();
  render(<PrintMediaEditor size="90x50" page="letter" onChange={changed} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Output' }), {
    target: { value: 'sheet' },
  });
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ mode: 'sheet', sheetWidth: 2159 }),
    true,
  );
  fireEvent.change(screen.getByLabelText('Label width (mm)'), {
    target: { value: '90.' },
  });
  expect(screen.getByLabelText('Label width (mm)')).toHaveValue('90.');
  expect(changed).toHaveBeenLastCalledWith(null, false);
  fireEvent.change(screen.getByLabelText('Label width (mm)'), {
    target: { value: '90.1' },
  });
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ labelWidth: 901 }),
    true,
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Output' }), {
    target: { value: 'single' },
  });
  expect(changed).toHaveBeenLastCalledWith(
    { version: 1, mode: 'single', labelWidth: 901, labelHeight: 500 },
    true,
  );
  expect(screen.queryByLabelText('Top margin (mm)')).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Output' }), {
    target: { value: 'preset' },
  });
  expect(changed).toHaveBeenLastCalledWith(null, true);
});
