import { expect, it } from 'vitest';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import { createPrivateDocumentTitleController } from './private-document-title';
const grant = () => ({
  navigation: '/owned?',
  binding: 'owner',
  revocation: readPrivacyRevocationRevision(),
  callbacks: assignmentEpoch(),
});
it('fences old registration cleanup and stale observers after revocation and replacement', async () => {
  const owner = createPrivateDocumentTitleController();
  const retire = owner.mount();
  const oldCleanup = owner.register('/owned', 'Old private name');
  owner.accept(grant());
  const currentCleanup = owner.register('/owned', 'Current private name');
  oldCleanup();
  expect(document.title).toBe('Current private name');
  revokePrivatePresentation();
  document.title = 'Generic metadata';
  await Promise.resolve();
  expect(document.title).toBe('IT Inventory');
  owner.accept(grant());
  oldCleanup();
  expect(document.title).toBe('Current private name');
  currentCleanup();
  expect(document.title).toBe('IT Inventory');
  retire();
  owner.accept(grant());
  expect(document.title).toBe('IT Inventory');
});
it('a retired provider cannot clear its replacement title', () => {
  const first = createPrivateDocumentTitleController();
  const retireFirst = first.mount();
  first.register('/owned', 'First private name');
  first.accept(grant());
  const second = createPrivateDocumentTitleController();
  const retireSecond = second.mount();
  second.register('/owned', 'Second private name');
  second.accept(grant());
  retireFirst();
  first.clear();
  expect(document.title).toBe('Second private name');
  retireSecond();
  expect(document.title).toBe('IT Inventory');
});

it('preserves ordinary verified route metadata with no private registration', async () => {
  const owner = createPrivateDocumentTitleController();
  const retire = owner.mount();
  owner.accept(grant());
  document.title = 'Inventory · IT Inventory';
  await Promise.resolve();
  expect(document.title).toBe('Inventory · IT Inventory');
  owner.clear();
  expect(document.title).toBe('IT Inventory');
  retire();
});
