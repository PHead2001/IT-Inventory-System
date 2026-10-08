import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { useFormValidation, ValidationSummary } from './validation';

it('retains native constraints, orders actionable errors, links focus and preserves help and zero', async () => {
  const saved = vi.fn();
  function Form() {
    const validation = useFormValidation();
    return (
      <form
        {...validation.formProps}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (validation.validate(event.currentTarget))
            saved(new FormData(event.currentTarget));
        }}
      >
        <label htmlFor="name">Name</label>
        <input
          id="name"
          name="name"
          required
          {...validation.props('name', 'name-help')}
        />
        <p id="name-help">Use a readable name.</p>
        {validation.error('name')}
        <label htmlFor="units">Units</label>
        <input
          id="units"
          name="units"
          type="number"
          min={0}
          step={1}
          required
          {...validation.props('units')}
        />
        {validation.error('units')}
        <label htmlFor="notes">Notes</label>
        <input id="notes" name="notes" />
        <ValidationSummary issues={validation.issues} />
        <button>Save</button>
        <button type="button">Cancel</button>
      </form>
    );
  }
  const user = userEvent.setup();
  render(<Form />);
  await user.type(screen.getByLabelText('Name'), '  ');
  await user.type(screen.getByLabelText('Units'), '1.5');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(saved).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Name')).toHaveFocus();
  expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(
    /Use a readable name.*Enter a value/,
  );
  await user.click(screen.getByRole('link', { name: 'Units' }));
  expect(screen.getByLabelText('Units')).toHaveFocus();
  expect(screen.getByLabelText('Units')).toHaveValue(1.5);
  await user.clear(screen.getByLabelText('Name'));
  await user.type(screen.getByLabelText('Name'), 'Cable');
  expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
  expect(screen.getByLabelText('Name')).toHaveFocus();
  expect(screen.queryByRole('link', { name: 'Name' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Units' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('Units'), { target: { value: '0' } });
  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(saved).toHaveBeenCalledOnce();
  expect(saved.mock.calls[0][0].get('units')).toBe('0');
  expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(
    'Use a readable name.',
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('starts live native and domain validation after a valid first Review, without stealing edit focus, until clear', async () => {
  const reviewed = vi.fn();
  function Form() {
    const [name, setName] = useState('Cable');
    const [reserved, setReserved] = useState(false);
    const validation = useFormValidation(() =>
      reserved
        ? [
            {
              id: 'review-name',
              label: 'Name',
              message: 'Choose an available name.',
            },
          ]
        : [],
    );
    return (
      <form
        {...validation.formProps}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (validation.validate(event.currentTarget)) reviewed();
        }}
      >
        <label htmlFor="review-name">Name</label>
        <input
          id="review-name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          {...validation.props('review-name')}
        />
        {validation.error('review-name')}
        <label>
          <input
            type="checkbox"
            checked={reserved}
            onChange={(event) => setReserved(event.target.checked)}
          />
          Reserved name
        </label>
        <ValidationSummary issues={validation.issues} />
        <button>Review</button>
        <button type="button" onClick={validation.clear}>
          Start again
        </button>
      </form>
    );
  }
  const user = userEvent.setup();
  render(<Form />);
  const name = screen.getByLabelText('Name');
  await user.click(screen.getByRole('button', { name: 'Review' }));
  expect(reviewed).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.clear(name);
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(name).toHaveAccessibleDescription('Enter a value for Name.');
  expect(screen.getByRole('alert')).toHaveTextContent('Name');
  expect(name).toHaveFocus();
  await user.type(name, 'Adapter');
  expect(name).not.toHaveAttribute('aria-invalid');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(name).toHaveFocus();
  const reserved = screen.getByRole('checkbox', { name: 'Reserved name' });
  await user.click(reserved);
  expect(name).toHaveAccessibleDescription('Choose an available name.');
  expect(screen.getByRole('link', { name: 'Name' })).toBeVisible();
  expect(reserved).toHaveFocus();
  await user.click(reserved);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(reserved).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Start again' }));
  await user.clear(name);
  expect(name).not.toHaveAttribute('aria-invalid');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Review' }));
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(name).toHaveFocus();
  expect(reviewed).toHaveBeenCalledOnce();
});
