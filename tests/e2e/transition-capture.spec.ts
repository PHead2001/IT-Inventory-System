import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

declare global {
  interface Window {
    captureHarness: {
      held: boolean;
      finished: boolean;
      transition(): void;
      release(): void;
    };
  }
}

// Real bundled React + native capture, independent of accounts, fixtures and DB.
// Holding the native update deterministically exposes React's event-disabled gap.
async function harness(guarded: boolean, focusNew = false) {
  const result = await build({
    stdin: {
      contents: `
        import React, {startTransition, useState, useLayoutEffect, ViewTransition} from 'react';
        import {createRoot} from 'react-dom/client';
        import {TransitionCaptureBoundary} from './src/components/forms/transition-capture-boundary';
        import {afterTransitionCapture} from './src/components/forms/transition-capture';
        const native = document.startViewTransition;
        window.captureHarness = {held:false, finished:false};
        document.startViewTransition = function(options) {
          const transition = native.call(this, {...options, update: async () => {
            await new Promise(resolve => {
              window.captureHarness.release = resolve;
              window.captureHarness.held = true;
            });
            return options.update();
          }});
          transition.finished.then(() => {window.captureHarness.finished = true;});
          return transition;
        };
        function App() {
          const [step, setStep] = useState(0);
          const [name, setName] = useState('Original');
          useLayoutEffect(() => { if (step && ${focusNew}) return afterTransitionCapture(document, () => document.getElementById('destination').focus()); }, [step]);
          window.captureHarness.transition = () => startTransition(() => setStep(n => n+1));
          const form = <section><h1>Step {step}</h1><form onSubmit={e=>e.preventDefault()}>
            <input aria-label="Name" value={name} onChange={e=>setName(e.target.value)}/>
            <input aria-label="Domain disabled" disabled value="Locked" readOnly/>
            <input id="destination" aria-label="Destination"/>
            <output>{name}</output></form></section>;
          return <><button id="outside">Outside</button><ViewTransition name="capture-fixture" update="capture-fixture">
            ${guarded ? '<TransitionCaptureBoundary>{form}</TransitionCaptureBoundary>' : '{form}'}
          </ViewTransition></>;
        }
        createRoot(document.getElementById('root')).render(<App/>);
      `,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: resolve('node_modules/next/dist/compiled/react'),
      'react-dom/client': resolve(
        'node_modules/next/dist/compiled/react-dom/client',
      ),
      'react-dom': resolve('node_modules/next/dist/compiled/react-dom'),
    },
  });
  return result.outputFiles[0].text;
}

test('capture preserves destination layout-effect focus ownership', async ({
  page,
}) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: await harness(true, true) });
  await page.getByRole('textbox', { name: 'Name', exact: true }).focus();
  await page.evaluate(() => window.captureHarness.transition());
  await page.waitForFunction(() => window.captureHarness.held, undefined, {
    polling: 10,
  });
  await page.evaluate(() => window.captureHarness.release());
  await expect(page.getByRole('heading')).toHaveText('Step 1');
  await expect(
    page.getByRole('textbox', { name: 'Destination', exact: true }),
  ).toBeFocused();
});

for (const interaction of ['outside-focus-blur', 'outside-pointer'] as const) {
  test(`capture retires earlier focus restoration after ${interaction}`, async ({
    page,
  }) => {
    await page.setContent(
      '<div id="root"></div><p id="outside-background">Outside background</p>',
    );
    await page.addScriptTag({ content: await harness(true) });
    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    await name.focus();
    await page.evaluate(() => window.captureHarness.transition());
    await page.waitForFunction(() => window.captureHarness.held, undefined, {
      polling: 10,
    });
    await expect(name).toBeDisabled();
    if (interaction === 'outside-focus-blur') {
      await page
        .getByRole('button', { name: 'Outside' })
        .evaluate((node: HTMLButtonElement) => {
          node.focus();
          node.blur();
        });
    } else await page.locator('#outside-background').click();
    await page.evaluate(() => window.captureHarness.release());
    await expect(page.getByRole('heading')).toHaveText('Step 1');
    await expect(name).toBeEnabled();
    await expect(name).not.toBeFocused();
    await expect(name).toHaveValue('Original');
  });
}

for (const guarded of [false, true]) {
  test(`native capture ${guarded ? 'protects editable state until event dispatch resumes' : 'reproduces dropped React input without the boundary'}`, async ({
    page,
  }) => {
    await page.setContent(
      '<style>::view-transition-group(*) {animation-duration:10s}</style><div id="root"></div>',
    );
    await page.addScriptTag({ content: await harness(guarded) });
    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    await expect(name).toHaveValue('Original');
    await name.focus();
    await name.evaluate((node: HTMLInputElement) =>
      node.setSelectionRange(2, 4),
    );
    await page.evaluate(() => window.captureHarness.transition());
    // Native capture suspends animation frames; use a timer observation rather
    // than accidentally waiting for Chromium's capture timeout to release it.
    await page.waitForFunction(() => window.captureHarness.held, undefined, {
      polling: 10,
    });
    if (guarded) {
      await expect(name).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Outside' })).toBeEnabled();
      await page.keyboard.type('lost');
      await expect(name).toHaveValue('Original');
    } else {
      await name.fill('Dropped input');
      await expect(name).toHaveValue('Dropped input');
    }
    await page.evaluate(() => window.captureHarness.release());
    await expect(page.getByRole('heading')).toHaveText('Step 1');
    if (guarded) {
      await expect(name).toBeEnabled();
      await expect(name).toBeFocused();
      expect(
        await name.evaluate((node: HTMLInputElement) => [
          node.selectionStart,
          node.selectionEnd,
        ]),
      ).toEqual([2, 4]);
      await expect(
        page.getByRole('textbox', { name: 'Domain disabled' }),
      ).toBeDisabled();
      expect(await page.evaluate(() => window.captureHarness.finished)).toBe(
        false,
      );
      await name.fill('Retained input');
      await expect(page.locator('output')).toHaveText('Retained input');
      await expect(name).toHaveValue('Retained input');
    } else {
      await expect(page.locator('output')).toHaveText('Original');
      await expect(name).toHaveValue('Original');
    }
  });
}
