import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoomToolbar } from './room-toolbar';

function setupToolbar({ initialActive = true, canFocusSelected = true } = {}) {
  const onActiveChange = vi.fn();
  const onRequestFocus = vi.fn(),
    onCommand = vi.fn();
  function Toolbar() {
    const [active, setActive] = useState(initialActive);
    return (
      <RoomToolbar
        active={active}
        onActiveChange={(value) => {
          onActiveChange(value);
          setActive(value);
        }}
        canFocusSelected={canFocusSelected}
        onRequestFocus={onRequestFocus}
        onCommand={onCommand}
        mode="guided"
        onModeChange={vi.fn()}
        showLabels={false}
        onLabelsChange={vi.fn()}
        showCounts={false}
        onCountsChange={vi.fn()}
      />
    );
  }
  render(<Toolbar />);
  return { user: userEvent.setup(), onActiveChange, onRequestFocus, onCommand };
}

describe('revealing view actions dismiss controls', () => {
  it.each([
    ['Fit room', 'pointer', true],
    ['Fit room', 'keyboard', false],
    ['Center selected', 'pointer', false],
    ['Center selected', 'keyboard', true],
  ] as const)(
    '%s through %s preserves invoking focus and interaction %s',
    async (name, input, active) => {
      const { user, onActiveChange, onCommand, onRequestFocus } = setupToolbar({
        initialActive: active,
      });
      const more = screen.getByRole('button', { name: 'More map controls' });
      await user.click(more);
      await user.click(screen.getByRole('button', { name: 'Controls' }));
      const button = screen.getByRole('button', { name });
      if (input === 'pointer') await user.click(button);
      else {
        // Shift+Tab from Help traverses the actual nonmodal panel and toolbar.
        for (
          let step = 0;
          step < 24 && document.activeElement !== button;
          step++
        )
          await user.tab({ shift: true });
        expect(button).toHaveFocus();
        await user.keyboard('{Enter}');
      }
      expect(
        screen.queryByRole('region', { name: 'More map controls' }),
      ).not.toBeInTheDocument();
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(button).toHaveFocus();
      expect(document.activeElement).not.toBe(document.body);
      expect(onActiveChange).not.toHaveBeenCalled();
      expect(
        screen.getByRole('button', {
          name: active ? 'Done interacting with map' : 'Interact with map',
        }),
      ).toHaveAttribute('aria-pressed', String(active));
      if (name === 'Fit room') {
        expect(onCommand).toHaveBeenCalledExactlyOnceWith('fit');
        expect(onRequestFocus).not.toHaveBeenCalled();
      } else {
        expect(onRequestFocus).toHaveBeenCalledOnce();
        expect(onCommand).not.toHaveBeenCalled();
      }
      await user.click(more);
      expect(screen.getByRole('button', { name: 'Controls' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    },
  );
  it.each(['pointer', 'keyboard'])(
    'Recenter through %s returns focus to the surviving More trigger',
    async (input) => {
      const { user, onCommand, onActiveChange } = setupToolbar();
      const more = screen.getByRole('button', { name: 'More map controls' });
      await user.click(more);
      const recenter = screen.getByRole('button', { name: 'Recenter' });
      if (input === 'pointer') await user.click(recenter);
      else await user.keyboard(' ');
      expect(more).toHaveFocus();
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.queryByRole('region', { name: 'More map controls' }),
      ).not.toBeInTheDocument();
      expect(onCommand).toHaveBeenCalledExactlyOnceWith('recenter');
      expect(onActiveChange).not.toHaveBeenCalled();
    },
  );
  it('disabled Center selected does not dismiss or dispatch', async () => {
    const { user, onCommand, onRequestFocus, onActiveChange } = setupToolbar({
      canFocusSelected: false,
    });
    await user.click(screen.getByRole('button', { name: 'More map controls' }));
    await user.click(screen.getByRole('button', { name: 'Center selected' }));
    expect(
      screen.getByRole('region', { name: 'More map controls' }),
    ).toBeVisible();
    expect(onCommand).not.toHaveBeenCalled();
    expect(onRequestFocus).not.toHaveBeenCalled();
    expect(onActiveChange).not.toHaveBeenCalled();
  });
  it.each(['Pan right', 'Rotate left'])(
    'keeps %s available for repeated commands',
    async (name) => {
      const { user, onCommand } = setupToolbar();
      await user.click(
        screen.getByRole('button', { name: 'More map controls' }),
      );
      const button = screen.getByRole('button', { name });
      await user.click(button);
      await user.click(button);
      expect(
        screen.getByRole('region', { name: 'More map controls' }),
      ).toBeVisible();
      expect(button).toHaveFocus();
      expect(onCommand).toHaveBeenCalledTimes(2);
    },
  );
});

describe('room toolbar Escape', () => {
  it('focuses the first popover control then Escape disarms and restores Interact', async () => {
    const { user, onActiveChange } = setupToolbar();
    const more = screen.getByRole('button', { name: 'More map controls' });
    for (let index = 0; index < 6; index += 1) await user.tab();
    expect(more).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(
      screen.getByRole('region', { name: 'More map controls' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Recenter' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('region', { name: 'More map controls' }),
    ).not.toBeInTheDocument();
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByRole('button', { name: 'Interact with map' }),
    ).toHaveFocus();
    expect(onActiveChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(
      screen.getByRole('button', { name: 'Interact with map' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes from a panel descendant, resets help, and returns focus to More', async () => {
    const { user, onActiveChange } = setupToolbar();
    const more = screen.getByRole('button', { name: 'More map controls' });
    await user.click(more);
    const panel = screen.getByRole('region', { name: 'More map controls' });
    await user.click(within(panel).getByRole('button', { name: 'Controls' }));
    expect(
      within(panel).getByText(/Click or tap a location to select it/),
    ).toBeVisible();
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('region', { name: 'More map controls' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Interact with map' }),
    ).toHaveFocus();
    expect(onActiveChange).toHaveBeenCalledExactlyOnceWith(false);
    await user.click(more);
    expect(screen.getByRole('button', { name: 'Controls' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
