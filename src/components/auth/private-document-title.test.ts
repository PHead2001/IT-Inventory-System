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

it('masks existing ordinary metadata before verification and restores only the verified route label', async () => {
  document.title = 'Inventory · IT Inventory';
  const owner = createPrivateDocumentTitleController();
  const retire = owner.mount();
  expect(document.title).toBe('IT Inventory');
  owner.accept({ ...grant(), navigation: '/inventory?search=Private+name' });
  expect(document.title).toBe('Inventory · IT Inventory');
  document.title = 'Old private record';
  await Promise.resolve();
  expect(document.title).toBe('Inventory · IT Inventory');
  owner.clear();
  expect(document.title).toBe('IT Inventory');
  document.title = 'Add quantity item · IT Inventory';
  await Promise.resolve();
  expect(document.title).toBe('IT Inventory');
  owner.accept({ ...grant(), navigation: '/inventory/quantity/new?' });
  expect(document.title).toBe('Add quantity item · IT Inventory');
  retire();
});

it('withdraws a previous private registration on verified ordinary navigation and fences late cleanup and metadata', async () => {
  const owner = createPrivateDocumentTitleController();
  const retire = owner.mount();
  const oldCleanup = owner.register('/owned', 'Previous private name');
  owner.accept(grant());
  expect(document.title).toBe('Previous private name');
  owner.clear();
  expect(document.title).toBe('IT Inventory');
  owner.accept({ ...grant(), navigation: '/inventory?' });
  expect(document.title).toBe('Inventory · IT Inventory');
  document.title = 'Previous private name';
  await Promise.resolve();
  expect(document.title).toBe('Inventory · IT Inventory');
  oldCleanup();
  expect(document.title).toBe('Inventory · IT Inventory');
  const stale = grant();
  revokePrivatePresentation();
  owner.accept({ ...stale, navigation: '/inventory?' });
  expect(document.title).toBe('IT Inventory');
  document.title = 'Inventory · IT Inventory';
  await Promise.resolve();
  expect(document.title).toBe('IT Inventory');
  retire();
});
it('restores only a static generic label for a verified missing private route and never replays prior document metadata', async () => {
  document.title = 'Private name from the last route';
  const owner = createPrivateDocumentTitleController();
  const retire = owner.mount();
  expect(document.title).toBe('IT Inventory');
  owner.accept({
    ...grant(),
    navigation: '/inventory/quantity/00000000-0000-4000-8000-000000000001?',
  });
  expect(document.title).toBe('Quantity item · IT Inventory');
  document.title = 'Private name from the last route';
  await Promise.resolve();
  expect(document.title).toBe('Quantity item · IT Inventory');
  owner.accept({ ...grant(), navigation: '/unknown/Private-name?' });
  expect(document.title).toBe('IT Inventory');
  retire();
});
