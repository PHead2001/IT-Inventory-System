import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import {
  assignmentEpoch,
  invalidateAssignmentCallbacks,
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

describe('all retained head title nodes', () => {
  const cleanups: (() => void)[] = [];
  beforeEach(() => {
    document.head.querySelectorAll('title').forEach((node) => node.remove());
  });
  afterEach(() => {
    cleanups
      .splice(0)
      .reverse()
      .forEach((cleanup) => cleanup());
    document.head.querySelectorAll('title').forEach((node) => node.remove());
  });
  const mount = () => {
    const controller = createPrivateDocumentTitleController();
    const retire = controller.mount();
    cleanups.push(retire);
    return { controller, retire };
  };
  const appendTitles = (values: string[]) =>
    values.map((value) => {
      const node = document.createElement('title');
      node.textContent = value;
      document.head.append(node);
      return node;
    });
  const expectTitles = (
    expected: string,
    nodes = [...document.head.querySelectorAll('title')],
  ) => {
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.map((node) => node.textContent)).toEqual(
      nodes.map(() => expected),
    );
    expect(nodes.every((node) => document.head.contains(node))).toBe(true);
  };

  it.each([
    { order: 'safe first', values: ['IT Inventory', 'Retained private name'] },
    {
      order: 'private first',
      values: ['Retained private name', 'IT Inventory'],
    },
    {
      order: 'three nodes',
      values: ['IT Inventory', 'Retained private name', 'Another private name'],
    },
  ])(
    'clear synchronously sanitizes and preserves retained nodes: $order',
    ({ values }) => {
      const { controller } = mount();
      controller.register('/owned', 'Authorized private name');
      controller.accept(grant());
      document.head.querySelectorAll('title').forEach((node) => node.remove());
      const nodes = appendTitles(values);
      controller.clear();
      expectTitles('IT Inventory', nodes);
      expect([...document.head.querySelectorAll('title')]).toEqual(nodes);
    },
  );

  it('mount synchronously masks every preexisting title without replacing the nodes', () => {
    const nodes = appendTitles([
      'IT Inventory',
      'Preexisting private name',
      'Other private name',
    ]);
    mount();
    expectTitles('IT Inventory', nodes);
    expect([...document.head.querySelectorAll('title')]).toEqual(nodes);
  });

  it('creates a normal title when head has none, then scrubs every title on mount and fresh authority', () => {
    const { controller } = mount();
    expectTitles('IT Inventory');
    document.head.querySelectorAll('title').forEach((node) => node.remove());
    controller.register('/owned', 'Authorized private name');
    expectTitles('IT Inventory');
    const nodes = appendTitles(['Old private one', 'Old private two']);
    controller.accept(grant());
    expectTitles('Authorized private name');
    expect(nodes.every((node) => node.isConnected)).toBe(true);
    controller.accept({ ...grant(), navigation: '/inventory?' });
    expectTitles('Inventory · IT Inventory');
  });

  it.each([
    'unregister',
    'revocation epoch',
    'callback epoch',
    'unmount',
  ] as const)('%s removes authority from every retained title', (action) => {
    const { controller, retire } = mount();
    const unregister = controller.register('/owned', 'Authorized private name');
    const authority = grant();
    controller.accept(authority);
    const nodes = appendTitles([
      'Retained private one',
      'Retained private two',
    ]);
    if (action === 'unregister') unregister();
    else if (action === 'unmount') retire();
    else {
      if (action === 'revocation epoch') revokePrivatePresentation();
      else invalidateAssignmentCallbacks();
      controller.accept(authority);
    }
    expectTitles('IT Inventory');
    expect(nodes.every((node) => node.isConnected)).toBe(true);
  });

  it('sanitizes late Next head append, replacement and text mutation after clear', async () => {
    const { controller } = mount();
    controller.register('/owned', 'Authorized private name');
    controller.accept(grant());
    controller.clear();
    const nodes = appendTitles(['IT Inventory', 'Late private append']);
    await waitFor(() => expectTitles('IT Inventory'));
    const replacement = document.createElement('title');
    replacement.textContent = 'Late private replacement';
    nodes[1].replaceWith(replacement);
    await waitFor(() => expectTitles('IT Inventory'));
    replacement.firstChild!.textContent = 'Late private character data';
    await waitFor(() => expectTitles('IT Inventory'));
    controller.accept(grant());
    expectTitles('Authorized private name');
  });

  it('sanitizes titles appended or replaced inside a retained head wrapper', async () => {
    const { controller } = mount();
    controller.clear();
    const wrapper = document.createElement('div');
    const nested = document.createElement('title');
    nested.textContent = 'Late wrapped private name';
    wrapper.append(nested);
    document.head.append(wrapper);
    cleanups.push(() => wrapper.remove());
    await waitFor(() => expectTitles('IT Inventory'));
    const replacement = document.createElement('div');
    const next = document.createElement('title');
    next.textContent = 'Replacement wrapped private name';
    replacement.append(next);
    wrapper.replaceWith(replacement);
    cleanups.push(() => replacement.remove());
    await waitFor(() => expectTitles('IT Inventory'));
    expect(next.isConnected).toBe(true);
  });

  it('a retired controller and its registration cleanup cannot rewrite its replacement nodes', async () => {
    const first = mount();
    const unregister = first.controller.register('/owned', 'Old private owner');
    first.controller.accept(grant());
    const nodes = appendTitles(['Old private one', 'Old private two']);
    const second = mount();
    second.controller.register('/owned', 'Replacement private owner');
    second.controller.accept(grant());
    first.retire();
    first.controller.clear();
    first.controller.accept(grant());
    unregister();
    expectTitles('Replacement private owner');
    nodes[1].textContent = 'Late old metadata';
    await waitFor(() => expectTitles('Replacement private owner'));
    second.retire();
    expectTitles('IT Inventory');
    first.controller.accept(grant());
    expectTitles('IT Inventory');
  });

  it('refreshes authority and remounts with a new grant without replaying an old title', async () => {
    const { controller, retire } = mount();
    controller.register('/owned', 'Owned private name');
    const stale = grant();
    controller.accept(stale);
    appendTitles(['Old retained one', 'Old retained two']);
    revokePrivatePresentation();
    controller.accept(stale);
    expectTitles('IT Inventory');
    controller.accept(grant());
    expectTitles('Owned private name');
    retire();
    controller.accept(grant());
    expectTitles('IT Inventory');
    const unmountAgain = controller.mount();
    cleanups.push(unmountAgain);
    controller.accept({ ...grant(), navigation: '/inventory?' });
    expectTitles('Inventory · IT Inventory');
    controller.register('/inventory', 'Current authorized name');
    expectTitles('Current authorized name');
    appendTitles(['Late Next title']);
    await waitFor(() => expectTitles('Current authorized name'));
  });

  it('skips already-correct nodes and converges after repairing head mutations', async () => {
    const { controller } = mount();
    const nodes = appendTitles(['IT Inventory', 'Private one', 'Private two']);
    const writes: Node[] = [];
    const observer = new MutationObserver((records) =>
      writes.push(...records.map((record) => record.target)),
    );
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    cleanups.push(() => observer.disconnect());
    controller.clear();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expectTitles('IT Inventory');
    expect(writes).toEqual([nodes[1], nodes[2]]);
    writes.length = 0;
    controller.clear();
    controller.accept(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toEqual([]);
  });
});
