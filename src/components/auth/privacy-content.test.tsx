import { renderToStaticMarkup } from 'react-dom/server';
import { StrictMode, Suspense } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from './privacy-readiness';
import {
  AcceptedPrivacyContent,
  ProtectedPrivacyContent,
} from './privacy-content';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';

it('never server-renders a private bootstrap consumer before readiness', () => {
  const bootstrap = vi.fn();
  function PrivateConsumer() {
    bootstrap();
    return <p>Private restored command</p>;
  }
  const html = renderToStaticMarkup(
    <PrivacyReadinessContext value={{ ready: false, generation: '' }}>
      <ProtectedPrivacyContent>
        <PrivateConsumer />
      </ProtectedPrivacyContent>
    </PrivacyReadinessContext>,
  );
  expect(bootstrap).not.toHaveBeenCalled();
  expect(html).not.toContain('Private restored command');
});

it('server-renders accepted content when its enclosing controller is ready', () => {
  const bootstrap = vi.fn();
  function PrivateConsumer() {
    bootstrap();
    return <p>Verified private command</p>;
  }
  const html = renderToStaticMarkup(
    <PrivacyReadinessContext value={{ ready: true, generation: 'absent' }}>
      <ProtectedPrivacyContent>
        <PrivateConsumer />
      </ProtectedPrivacyContent>
    </PrivacyReadinessContext>,
  );
  expect(bootstrap).toHaveBeenCalledOnce();
  expect(html).toContain('Verified private command');
});

it('rejects a queued positive admission after revocation, before late primary and original-scope restoration', async () => {
  let ready = false;
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  function LatePrimary() {
    if (!ready) throw promise;
    return <p>Obsolete proposed primary</p>;
  }
  const original = (
    <Suspense fallback={<p>Waiting</p>}>
      <input aria-label="Original owner" defaultValue="draft" />
    </Suspense>
  );
  const proposed = (
    <Suspense fallback={<p>Waiting</p>}>
      <LatePrimary />
    </Suspense>
  );
  const restored = (
    <Suspense fallback={<p>Waiting</p>}>
      <p>Current restored destination</p>
    </Suspense>
  );
  const tree = (children: React.ReactNode, granted: boolean) => (
    <StrictMode>
      <AcceptedPrivacyContent
        transitionAdmission
        ready={granted}
        visible={granted}
        generation="original"
        admissionRevision={readPrivacyRevocationRevision()}
        admissionEpoch={assignmentEpoch()}
      >
        {children}
      </AcceptedPrivacyContent>
    </StrictMode>
  );
  const view = render(tree(original, true));
  const input = screen.getByRole('textbox');
  view.rerender(tree(proposed, true));
  expect(screen.getByRole('textbox')).toBe(input);
  act(() => {
    revokePrivatePresentation();
    view.rerender(tree(restored, false));
  });
  expect(screen.queryByRole('textbox')).toBeNull();
  await act(async () => {
    ready = true;
    resolve();
    await promise;
  });
  expect(view.container.textContent).not.toContain('Obsolete proposed primary');
  view.rerender(tree(restored, true));
  await screen.findByText('Current restored destination');
  expect(view.container.textContent).not.toContain('Obsolete proposed primary');
});

it('superseding a suspended admission invalidates its source/generation ticket before late primary resolves', async () => {
  let ready = false;
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  function LatePrimary() {
    if (!ready) throw promise;
    return <p>Superseded proposed primary</p>;
  }
  const tree = (children: React.ReactNode, generation = 'original') => (
    <StrictMode>
      <AcceptedPrivacyContent
        transitionAdmission
        ready
        visible
        generation={generation}
        admissionRevision={readPrivacyRevocationRevision()}
        admissionEpoch={assignmentEpoch()}
      >
        {children}
      </AcceptedPrivacyContent>
    </StrictMode>
  );
  const view = render(
    tree(
      <Suspense fallback={<p>Waiting</p>}>
        <p>Original primary</p>
      </Suspense>,
    ),
  );
  view.rerender(
    tree(
      <Suspense fallback={<p>Waiting</p>}>
        <LatePrimary />
      </Suspense>,
    ),
  );
  view.rerender(
    tree(
      <Suspense fallback={<p>Waiting</p>}>
        <p>Replacement primary</p>
      </Suspense>,
      'replacement',
    ),
  );
  await screen.findByText('Replacement primary');
  await act(async () => {
    ready = true;
    resolve();
    await promise;
  });
  await waitFor(() =>
    expect(screen.getByText('Replacement primary')).toBeVisible(),
  );
  expect(view.container.textContent).not.toContain(
    'Superseded proposed primary',
  );
});
