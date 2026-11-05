import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { MagneticVisual } from './magnetic-visual';

it('preserves the stationary action name, keyboard focus, disabled state and click owner', () => {
  const click = vi.fn();
  const view = render(
    <Button className="experience-magnetic" onClick={click}>
      <MagneticVisual>Start camera</MagneticVisual>
    </Button>,
  );
  const button = screen.getByRole('button', { name: 'Start camera' });
  button.focus();
  expect(button).toHaveFocus();
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
  expect(button.querySelectorAll('.experience-magnetic-face')).toHaveLength(1);
  expect(button.querySelector('.experience-magnetic-face')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  expect(button.querySelector('.experience-magnetic-visual')?.textContent).toBe(
    'Start camera',
  );
  view.rerender(
    <Button className="experience-magnetic" disabled onClick={click}>
      <MagneticVisual>Starting…</MagneticVisual>
    </Button>,
  );
  expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
});
