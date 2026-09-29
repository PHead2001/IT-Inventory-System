export type SheetReadiness = 'ready' | 'invalid' | 'timeout' | 'cancelled';

/** Wait for the exact rendered sheet, including effects that measure text after fonts load. */
export function waitForSheetReadiness(
  sheet: HTMLElement,
  generation: string,
  expectedCards: number,
  signal: AbortSignal,
  isCurrent: () => boolean,
  timeoutMs = 10_000,
): Promise<SheetReadiness> {
  return new Promise((resolve) => {
    let finished = false;
    let decoding = false;
    const finish = (result: SheetReadiness) => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      sheet.removeEventListener('load', check, true);
      sheet.removeEventListener('error', check, true);
      signal.removeEventListener('abort', abort);
      clearTimeout(timeout);
      resolve(result);
    };
    const abort = () => finish('cancelled');
    const check = () => {
      if (finished) return;
      if (signal.aborted || !isCurrent()) return finish('cancelled');
      if (!sheet.isConnected || sheet.dataset.sheetGeneration !== generation)
        return finish('cancelled');
      const cards = Array.from(
        sheet.querySelectorAll<HTMLElement>('.label-card'),
      );
      if (cards.length !== expectedCards) return;
      if (cards.some((card) => card.dataset.sheetGeneration !== generation))
        return;
      if (
        cards.some(
          (card) =>
            card.dataset.codeFailed === 'true' ||
            (card.dataset.textMeasured === 'true' &&
              card.dataset.textOverflow === 'true'),
        )
      )
        return finish('invalid');
      if (
        cards.some(
          (card) =>
            card.dataset.codeReady !== 'true' ||
            card.dataset.textMeasured !== 'true',
        )
      )
        return;
      if (document.fonts && document.fonts.status !== 'loaded') return;
      const images = Array.from(
        sheet.querySelectorAll<HTMLImageElement>('img'),
      );
      if (images.some((image) => !image.complete)) return;
      if (images.some((image) => image.naturalWidth === 0))
        return finish('invalid');
      if (decoding) return;
      decoding = true;
      const imageSources = images.map((image) => image.currentSrc || image.src);
      void Promise.all(images.map((image) => image.decode?.()))
        .then(() => {
          decoding = false;
          if (finished) return;
          // Decode may resolve after a replacement sheet has rendered.
          if (
            signal.aborted ||
            !isCurrent() ||
            !sheet.isConnected ||
            sheet.dataset.sheetGeneration !== generation
          )
            return finish('cancelled');
          const currentCards = Array.from(
            sheet.querySelectorAll<HTMLElement>('.label-card'),
          );
          const currentImages = Array.from(
            sheet.querySelectorAll<HTMLImageElement>('img'),
          );
          if (
            currentCards.length === expectedCards &&
            currentCards.every(
              (card) =>
                card.dataset.sheetGeneration === generation &&
                card.dataset.codeReady === 'true' &&
                card.dataset.textMeasured === 'true' &&
                card.dataset.textOverflow === 'false' &&
                card.dataset.codeFailed !== 'true',
            ) &&
            currentImages.length === images.length &&
            currentImages.every(
              (image, index) =>
                image === images[index] &&
                (image.currentSrc || image.src) === imageSources[index] &&
                image.complete &&
                image.naturalWidth > 0,
            ) &&
            (!document.fonts || document.fonts.status === 'loaded')
          )
            finish('ready');
          else check();
        })
        .catch(() => finish('invalid'));
    };
    const observer = new MutationObserver(check);
    observer.observe(sheet, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'data-sheet-generation',
        'data-code-ready',
        'data-code-failed',
        'data-text-measured',
        'data-text-overflow',
        'src',
      ],
    });
    sheet.addEventListener('load', check, true);
    sheet.addEventListener('error', check, true);
    signal.addEventListener('abort', abort, { once: true });
    const timeout = window.setTimeout(
      () =>
        finish(
          signal.aborted ||
            !isCurrent() ||
            !sheet.isConnected ||
            sheet.dataset.sheetGeneration !== generation
            ? 'cancelled'
            : 'timeout',
        ),
      timeoutMs,
    );
    void document.fonts?.ready.then(check, () => finish('invalid'));
    check();
  });
}
