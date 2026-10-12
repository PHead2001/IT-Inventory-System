import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Form from './route-get-form';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
beforeEach(() => push.mockClear());

it('preserves successful controls, duplicate values, hidden filters and submitter', () => {
  render(
    <Form action="/history?old=ignored#activity-heading" aria-label="filters">
      <input name="category" defaultValue="parts" />
      <input type="hidden" name="category" value="tools" />
      <input disabled name="disabled" value="excluded" readOnly />
      <input type="checkbox" name="unchecked" />
      <button name="page" value="1">
        Apply
      </button>
    </Form>,
  );
  const form = screen.getByRole('form');
  fireEvent(
    form,
    new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter: screen.getByRole('button'),
    }),
  );
  expect(push).toHaveBeenCalledWith(
    '/history?category=parts&category=tools&page=1#activity-heading',
  );
});

it('handles Enter submission without a submitter and honors an existing prevent guard', () => {
  const view = render(
    <Form action="/history" aria-label="filters">
      <input name="q" defaultValue="cable" />
    </Form>,
  );
  fireEvent.submit(screen.getByRole('form'));
  expect(push).toHaveBeenCalledWith('/history?q=cable');
  push.mockClear();
  view.rerender(
    <Form
      action="/history"
      aria-label="filters"
      onSubmit={(event) => event.preventDefault()}
    >
      <input name="q" defaultValue="cable" />
    </Form>,
  );
  fireEvent.submit(screen.getByRole('form'));
  expect(push).not.toHaveBeenCalled();
});

it.each(['formAction', 'formMethod', 'formTarget', 'formEncType'] as const)(
  'leaves %s submitter overrides to native submission',
  (attribute) => {
    render(
      <Form action="/history" aria-label="filters">
        <button
          {...{
            [attribute]: attribute === 'formAction' ? '/inventory' : '_blank',
          }}
        >
          Apply
        </button>
      </Form>,
    );
    expect(
      fireEvent(
        screen.getByRole('form'),
        new SubmitEvent('submit', {
          bubbles: true,
          cancelable: true,
          submitter: screen.getByRole('button'),
        }),
      ),
    ).toBe(true);
    expect(push).not.toHaveBeenCalled();
  },
);

it('keeps modified, external and alternate-target submissions native', () => {
  const view = render(
    <Form action="/history" aria-label="filters">
      <button>Apply</button>
    </Form>,
  );
  fireEvent.click(screen.getByRole('button'), { ctrlKey: true });
  expect(push).not.toHaveBeenCalled();
  view.rerender(
    <Form action="https://example.test/history" aria-label="filters">
      <button>Apply</button>
    </Form>,
  );
  fireEvent.submit(screen.getByRole('form'));
  expect(push).not.toHaveBeenCalled();
  view.rerender(
    <Form action="/history" target="_blank" aria-label="filters">
      <button>Apply</button>
    </Form>,
  );
  fireEvent.submit(screen.getByRole('form'));
  expect(push).not.toHaveBeenCalled();
});
