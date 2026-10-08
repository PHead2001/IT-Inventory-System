import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoomToolbar } from './room-toolbar';

function setupToolbar() {
  const onActiveChange = vi.fn();
  function Toolbar() {
    const [active, setActive] = useState(true);
    return (
      <RoomToolbar
        active={active}
        onActiveChange={(value) => {
          onActiveChange(value);
          setActive(value);
        }}
        canFocusSelected
        onRequestFocus={vi.fn()}
        onCommand={vi.fn()}
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
  return { user: userEvent.setup(), onActiveChange };
}

describe('room toolbar Escape', () => {
  it('closes keyboard-opened controls and disarms while focus remains on More', async () => {
    const { user, onActiveChange } = setupToolbar();
    const more = screen.getByRole('button', { name: 'More map controls' });
    for (let index = 0; index < 7; index += 1) await user.tab();
    expect(more).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(
      screen.getByRole('region', { name: 'More map controls' }),
    ).toBeVisible();
    expect(more).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('region', { name: 'More map controls' }),
    ).not.toBeInTheDocument();
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveFocus();
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
    expect(more).toHaveFocus();
    expect(onActiveChange).toHaveBeenCalledExactlyOnceWith(false);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Controls' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
