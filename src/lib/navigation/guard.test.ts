import { fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { registerNavigationGuard, requestAppNavigation } from './guard';

it('shares one cancelable decision between ordinary links and programmatic commands', () => {
  const allow = vi.fn(() => false);
  const remove = registerNavigationGuard(allow);
  const anchor = document.createElement('a');
  anchor.href = '/sites';
  document.body.append(anchor);
  try {
    expect(fireEvent.click(anchor)).toBe(false);
    expect(requestAppNavigation('/sites', anchor)).toBe(false);
    expect(allow).toHaveBeenCalledTimes(2);
    expect(allow.mock.calls[0]).toEqual(allow.mock.calls[1]);
    allow.mockReturnValue(true);
    expect(requestAppNavigation('/scan', anchor)).toBe(true);
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'])
      fireEvent.click(anchor, { [modifier]: true });
    expect(allow).toHaveBeenCalledTimes(3);
  } finally {
    remove();
    anchor.remove();
  }
});
