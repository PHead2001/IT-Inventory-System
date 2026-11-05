import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { safeWebLink, WebLinkValue } from './web-link-value';
describe('saved web links', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'https://user:pass@example.com',
    'https://example.com:99999',
    'https://example.com\\@evil.test',
    'https://example.com/\nscript',
  ])('keeps unsafe retained value %s inert', (value) => {
    expect(safeWebLink(value)).toBeNull();
    render(<WebLinkValue value={value} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be opened here/)).toBeVisible();
  });
  it('opens a complete safe destination with safe external attributes and copies exact text', async () => {
    const href = 'https://example.com/manual?device=USB-C#page-2';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<WebLinkValue value={href} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', href);
    expect(link).toHaveClass('min-h-11', 'min-w-11', 'max-w-full');
    expect(screen.getByRole('button', { name: `Copy ${href}` })).toHaveClass(
      'min-h-11',
      'min-w-11',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: `Copy ${href}` }));
    expect(await screen.findByText('Link copied.')).toBeVisible();
    expect(writeText).toHaveBeenCalledWith(href);
  });
  it('offers the full selectable destination when clipboard access fails', async () => {
    const href = `https://example.com/${'long'.repeat(200)}`;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<WebLinkValue value={href} />);
    fireEvent.click(screen.getByRole('button', { name: `Copy ${href}` }));
    const text = await screen.findByLabelText('Full link for manual copying');
    expect(text).toHaveValue(href);
    const select = screen.getByRole('button', { name: 'Select full link' });
    expect(select).toHaveClass('min-h-11', 'min-w-11');
    fireEvent.click(select);
    expect(text).toHaveFocus();
    expect((text as HTMLTextAreaElement).selectionEnd).toBe(href.length);
  });
});
