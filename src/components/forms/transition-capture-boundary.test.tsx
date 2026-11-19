import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  hasBlockingPresentationAncestor,
  isCaptureInertOwner,
  TransitionCaptureBoundary,
} from './transition-capture-boundary';
import { holdTransitionCapture } from '../../../tests/helpers/transition-capture';

it.each(['release', 'unmount'])(
  'retires the capture-only inert capability on %s',
  async (ending) => {
    const capture = holdTransitionCapture(false);
    const page = render(
      <TransitionCaptureBoundary>
        <p>Title geometry</p>
      </TransitionCaptureBoundary>,
    );
    const title = screen.getByText('Title geometry');
    const fieldset = title.closest('fieldset')!;
    expect(isCaptureInertOwner(fieldset)).toBe(false);
    capture.begin();
    expect(isCaptureInertOwner(fieldset)).toBe(true);
    expect(hasBlockingPresentationAncestor(title)).toBe(false);
    try {
      if (ending === 'release') await act(capture.release);
      else page.unmount();
      expect(isCaptureInertOwner(fieldset)).toBe(false);
      fieldset.inert = true;
      expect(hasBlockingPresentationAncestor(title)).toBe(true);
    } finally {
      page.unmount();
      await act(capture.release);
      capture.dispose();
    }
  },
);

it.each(['capture-blur', 'outside-focus-blur', 'outside-pointer', 'history'])(
  'restores focus only while the boundary owns it after %s',
  async (interaction) => {
    const geometry = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue([{ width: 40, height: 20 }] as unknown as DOMRectList);
    const capture = holdTransitionCapture(false);
    const view = render(
      <>
        <button>Outside</button>
        <p>Outside background</p>
        <TransitionCaptureBoundary>
          <input aria-label="Name" defaultValue="Retained" />
          <input aria-label="Disabled" disabled />
        </TransitionCaptureBoundary>
      </>,
    );
    const input = screen.getByLabelText('Name');
    input.focus();
    capture.begin();
    try {
      expect(input).toBeDisabled();
      // jsdom will not blur a disabled input. Model the browser's capture blur
      // without changing the boundary's final disabled/inert ownership.
      const fieldset = input.closest('fieldset')!;
      fieldset.disabled = false;
      input.blur();
      fieldset.disabled = true;
      expect(document.activeElement).toBe(document.body);
      if (interaction === 'outside-focus-blur') {
        const outside = screen.getByRole('button', { name: 'Outside' });
        outside.focus();
        outside.blur();
      }
      if (interaction === 'outside-pointer')
        fireEvent.pointerDown(screen.getByText('Outside background'));
      if (interaction === 'history')
        act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      await act(capture.release);
      expect(input).toBeEnabled();
      expect(screen.getByLabelText('Disabled')).toBeDisabled();
      expect(input).toHaveValue('Retained');
      if (interaction === 'capture-blur') expect(input).toHaveFocus();
      else expect(input).not.toHaveFocus();
    } finally {
      view.unmount();
      await act(capture.release);
      capture.dispose();
      geometry.mockRestore();
    }
  },
);
