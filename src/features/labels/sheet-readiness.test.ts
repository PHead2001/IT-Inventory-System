import { afterEach, expect, it, vi } from 'vitest';
import { waitForSheetReadiness } from './sheet-readiness';

afterEach(() => {
  document.body.replaceChildren();
});

function sheet(generation = 'new') {
  const root = document.createElement('div');
  root.className = 'label-print-root';
  root.dataset.sheetGeneration = generation;
  root.innerHTML = `<article class="label-card" data-sheet-generation="${generation}" data-code-ready="false" data-text-measured="false" data-text-overflow="false" data-code-failed="false"></article>`;
  document.body.append(root);
  return { root, card: root.querySelector<HTMLElement>('.label-card')! };
}

it('waits for code and final fit from the current sheet generation', async () => {
  const { root, card } = sheet();
  const controller = new AbortController();
  let completed = false;
  const pending = waitForSheetReadiness(
    root,
    'new',
    1,
    controller.signal,
    () => true,
    100,
  );
  void pending.then(() => {
    completed = true;
  });
  card.dataset.textMeasured = 'true';
  await Promise.resolve();
  expect(completed).toBe(false);
  card.dataset.codeReady = 'true';
  expect(await pending).toBe('ready');
});

it.each([
  ['final text overflow', 'textOverflow'],
  ['failed code generation', 'codeFailed'],
] as const)('blocks %s', async (_name, attribute) => {
  const { root, card } = sheet();
  const controller = new AbortController();
  const pending = waitForSheetReadiness(
    root,
    'new',
    1,
    controller.signal,
    () => true,
    100,
  );
  card.dataset.textMeasured = 'true';
  card.dataset[attribute] = 'true';
  expect(await pending).toBe('invalid');
});

it('does not accept ready flags from an older generation', async () => {
  const { root, card } = sheet();
  card.dataset.sheetGeneration = 'old';
  card.dataset.codeReady = 'true';
  card.dataset.textMeasured = 'true';
  const controller = new AbortController();
  const pending = waitForSheetReadiness(
    root,
    'new',
    1,
    controller.signal,
    () => true,
    100,
  );
  card.dataset.sheetGeneration = 'new';
  card.dataset.codeReady = 'false';
  card.dataset.textMeasured = 'false';
  card.dataset.textMeasured = 'true';
  card.dataset.codeReady = 'true';
  expect(await pending).toBe('ready');
});

it('cancels on queue invalidation, unmount, and a replaced generation', async () => {
  const cases = [
    (root: HTMLElement, controller: AbortController) => controller.abort(),
    (root: HTMLElement) => root.remove(),
    (root: HTMLElement) => {
      root.dataset.sheetGeneration = 'replacement';
    },
  ];
  for (const cancel of cases) {
    const { root } = sheet();
    const controller = new AbortController();
    const pending = waitForSheetReadiness(
      root,
      'new',
      1,
      controller.signal,
      () => true,
      100,
    );
    cancel(root, controller);
    expect(await pending).toBe('cancelled');
    root.remove();
  }
});

it('times out when a current card never becomes ready', async () => {
  const { root } = sheet();
  const controller = new AbortController();
  expect(
    await waitForSheetReadiness(
      root,
      'new',
      1,
      controller.signal,
      () => true,
      10,
    ),
  ).toBe('timeout');
});

it('decodes the same image nodes and sources that are finally granted readiness', async () => {
  const { root, card } = sheet();
  card.dataset.textMeasured = 'true';
  card.dataset.codeReady = 'true';
  const first = document.createElement('img');
  first.src = 'data:image/png;base64,first';
  Object.defineProperties(first, {
    complete: { value: true },
    naturalWidth: { value: 10 },
  });
  let finishFirst!: () => void;
  first.decode = () =>
    new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
  card.append(first);
  const controller = new AbortController();
  const pending = waitForSheetReadiness(
    root,
    'new',
    1,
    controller.signal,
    () => true,
    100,
  );
  const second = document.createElement('img');
  second.src = 'data:image/png;base64,second';
  Object.defineProperties(second, {
    complete: { value: true },
    naturalWidth: { value: 10 },
  });
  second.decode = vi.fn(async () => {});
  first.replaceWith(second);
  finishFirst();
  expect(await pending).toBe('ready');
  expect(second.decode).toHaveBeenCalledOnce();
});
