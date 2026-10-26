// @vitest-environment node
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
import { DocumentAdmission } from './document-admission';

it('throws the document failure before rendering any protected shell or Suspense child', () => {
  const shell = vi.fn(() => <main>Private shell</main>);
  const Shell = shell;
  expect(() =>
    renderToString(
      <DocumentAdmission missing>
        <Shell />
      </DocumentAdmission>,
    ),
  ).toThrow('NOT_FOUND');
  expect(shell).not.toHaveBeenCalled();
});

it('renders admitted document content normally', () => {
  expect(
    renderToString(
      <DocumentAdmission missing={false}>
        <main>Admitted record</main>
      </DocumentAdmission>,
    ),
  ).toContain('Admitted record');
});
