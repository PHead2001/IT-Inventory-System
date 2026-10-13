import { act, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FieldSettings, makeField } from './field-settings';
import { holdTransitionCapture } from '../../../tests/helpers/transition-capture';

it.each(['release', 'unmount', 'disabled'])(
  'preserves field-name autofocus after capture and retires it on %s',
  async (outcome) => {
    const capture = holdTransitionCapture();
    const view = render(
      <FieldSettings
        field={makeField('short_text', 'Service')}
        change={() => {}}
        autoFocus={outcome !== 'disabled'}
      />,
    );
    try {
      const input = screen.getByLabelText('Field name');
      expect(input).not.toHaveFocus();
      if (outcome === 'unmount') view.unmount();
      await act(capture.release);
      if (outcome === 'release') expect(input).toHaveFocus();
      else expect(input).not.toHaveFocus();
    } finally {
      view.unmount();
      await act(capture.release);
      capture.dispose();
    }
  },
);
