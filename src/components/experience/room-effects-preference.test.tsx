import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  RoomEffectsPreference,
  useRoomEffectsQuality,
} from './room-effects-preference';

function Surface({ name }: { name: string }) {
  const quality = useRoomEffectsQuality();
  return <output aria-label={name}>{quality}</output>;
}
function clearPreference() {
  localStorage.removeItem('it-inventory-room-effects');
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'it-inventory-room-effects' }),
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  act(clearPreference);
});
it('shares the browser quality with full and newly opened embedded rooms independently of Reduced motion', () => {
  clearPreference();
  localStorage.setItem('it-inventory-reduce-motion', 'true');
  const view = render(
    <>
      <RoomEffectsPreference />
      <Surface name="Full room" />
    </>,
  );
  expect(screen.getByLabelText('Full room')).toHaveTextContent('standard');
  fireEvent.change(screen.getByLabelText('Room appearance in this browser'), {
    target: { value: 'low' },
  });
  view.rerender(
    <>
      <RoomEffectsPreference />
      <Surface name="Full room" />
      <Surface name="Detail room" />
      <Surface name="Picker room" />
    </>,
  );
  for (const name of ['Full room', 'Detail room', 'Picker room'])
    expect(screen.getByLabelText(name)).toHaveTextContent('low');
  fireEvent.change(screen.getByLabelText('Room appearance in this browser'), {
    target: { value: 'off' },
  });
  for (const name of ['Full room', 'Detail room', 'Picker room'])
    expect(screen.getByLabelText(name)).toHaveTextContent('off');
  expect(localStorage.getItem('it-inventory-reduce-motion')).toBe('true');
  expect(localStorage.getItem('it-inventory-room-effects')).toBe('off');
  act(() => {
    localStorage.setItem('it-inventory-room-effects', 'standard');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'it-inventory-room-effects' }),
    );
  });
  expect(screen.getByLabelText('Detail room')).toHaveTextContent('standard');
  localStorage.removeItem('it-inventory-reduce-motion');
});
it('keeps this tab usable with failed browser storage and ignores unknown stored values', () => {
  clearPreference();
  localStorage.setItem('it-inventory-room-effects', 'unknown');
  render(
    <>
      <RoomEffectsPreference />
      <Surface name="Full room" />
    </>,
  );
  expect(screen.getByLabelText('Full room')).toHaveTextContent('standard');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  fireEvent.change(screen.getByLabelText('Room appearance in this browser'), {
    target: { value: 'off' },
  });
  expect(screen.getByLabelText('Full room')).toHaveTextContent('off');
});

it('reads an externally changed preference after every subscriber unmounts and remounts', () => {
  clearPreference();
  const first = render(
    <>
      <RoomEffectsPreference />
      <Surface name="Full room" />
    </>,
  );
  fireEvent.change(screen.getByLabelText('Room appearance in this browser'), {
    target: { value: 'low' },
  });
  expect(localStorage.getItem('it-inventory-room-effects')).toBe('low');
  first.unmount();
  localStorage.setItem('it-inventory-room-effects', 'off');
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'it-inventory-room-effects' }),
  );
  render(
    <>
      <RoomEffectsPreference />
      <Surface name="Detail room" />
      <Surface name="Picker room" />
    </>,
  );
  expect(screen.getByLabelText('Room appearance in this browser')).toHaveValue(
    'off',
  );
  expect(screen.getByLabelText('Detail room')).toHaveTextContent('off');
  expect(screen.getByLabelText('Picker room')).toHaveTextContent('off');
});

it('retains an actual failed-write fallback when all subscribers unmount and remount', () => {
  clearPreference();
  localStorage.setItem('it-inventory-room-effects', 'standard');
  const first = render(
    <>
      <RoomEffectsPreference />
      <Surface name="Full room" />
    </>,
  );
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  fireEvent.change(screen.getByLabelText('Room appearance in this browser'), {
    target: { value: 'off' },
  });
  first.unmount();
  render(
    <>
      <RoomEffectsPreference />
      <Surface name="Detail room" />
    </>,
  );
  expect(localStorage.getItem('it-inventory-room-effects')).toBe('standard');
  expect(screen.getByLabelText('Detail room')).toHaveTextContent('off');
  expect(screen.getByLabelText('Room appearance in this browser')).toHaveValue(
    'off',
  );
});
