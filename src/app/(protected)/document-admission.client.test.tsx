import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
const missing = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ notFound: missing }));
import { DocumentAdmission } from './document-admission';
afterEach(cleanup);

it('never replays document failure in the browser and preserves the child lifetime on recovery', () => {
  function Shell({ page }: { page: string }) {
    const [draft, setDraft] = useState('Original draft');
    return (
      <main>
        <h1>{page}</h1>
        <button onClick={() => setDraft('Retained draft')}>{draft}</button>
      </main>
    );
  }
  const view = render(
    <DocumentAdmission missing>
      <Shell page="Page-owned missing result" />
    </DocumentAdmission>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Original draft' }));
  for (const page of [
    'Inventory',
    'Page-owned missing result',
    'Valid record',
  ]) {
    // The cached layout still carries the original document flag, even when
    // a page-owned boundary returns or the original record becomes valid.
    view.rerender(
      <DocumentAdmission missing>
        <Shell page={page} />
      </DocumentAdmission>,
    );
    expect(screen.getByRole('heading', { name: page })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Retained draft' }),
    ).toBeVisible();
  }
  expect(missing).not.toHaveBeenCalled();
  view.unmount();
  render(
    <DocumentAdmission missing>
      <main>Original record now valid after boundary remount</main>
    </DocumentAdmission>,
  );
  expect(screen.getByRole('main')).toHaveTextContent(
    'Original record now valid',
  );
  expect(missing).not.toHaveBeenCalled();
});
