import type { Page } from '@playwright/test';

const MAX_BYTES = 128 * 1024;
export async function enableRoomLayoutDiagnostics(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__roomLayoutDiagnosticsEnabled', {
      value: true,
    });
  });
}

/** Emit only fixture geometry and an allowlisted projection of existing telemetry. */
export async function reportRoomLayoutFailure(
  page: Page,
  allowedCodes: string[],
) {
  try {
    const report = await page.evaluate((codes) => {
      const allowed = new Set(codes);
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="room-viewer"] canvas',
      );
      const numeric = (value: string | undefined) => {
        if (value === undefined) return null;
        const result = Number(value);
        if (!Number.isFinite(result)) throw new Error('invalid-telemetry');
        return result;
      };
      const flag = (value: string | undefined) => {
        if (value === undefined) return null;
        if (value !== 'true' && value !== 'false')
          throw new Error('invalid-telemetry');
        return value === 'true';
      };
      const elements = [
        ...document.querySelectorAll<HTMLElement>('[data-room-label-code]'),
      ];
      if (elements.length > 96) throw new Error('telemetry-bound');
      const labels = elements.map((element) => {
        const code = element.dataset.roomLabelCode;
        if (!code || !allowed.has(code)) throw new Error('unknown-code');
        return {
          code,
          exposed: flag(element.dataset.roomExposed),
          suppressed: flag(element.dataset.labelSuppressed),
          compact: flag(element.dataset.labelCompact),
          dx: numeric(element.dataset.labelDx),
          dy: numeric(element.dataset.labelDy),
        };
      });
      return {
        stage: 'fit-open-selected-before-long-text',
        snapshot: window.__roomLabelLayoutSnapshot ?? null,
        telemetry: {
          revision: numeric(canvas?.dataset.labelLayoutRevision),
          pending: flag(canvas?.dataset.labelLayoutPending),
          layoutErrorPresent: !!canvas?.dataset.labelLayoutError,
          labels,
        },
      };
    }, allowedCodes);
    const encoded = JSON.stringify(report);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES)
      throw new Error('payload-bound');
    console.log('ROOM_LABEL_LAYOUT_DIAGNOSTIC ' + encoded);
  } catch {
    console.log(
      'ROOM_LABEL_LAYOUT_DIAGNOSTIC ' +
        JSON.stringify({
          stage: 'fit-open-selected-before-long-text',
          captureError: true,
          complete: false,
        }),
    );
  }
}
