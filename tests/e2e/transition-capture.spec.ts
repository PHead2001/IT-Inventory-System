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
    regionHarness: {
      transition(): void;
      proof: {
        old: NativeRegionCapture[];
        next: NativeRegionCapture[];
        effects: string[];
        ready: boolean;
        finished: boolean;
        error: string | null;
      };
    };
  }
}

type NativeRegionCapture = {
  region: string;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
};

type NativeRegionCase =
  | 'visible paired body'
  | 'below viewport paired body'
  | 'unmatched visible header'
  | 'matching outgoing header';

/** Exercise the installed production React traversal, not a ViewTransition mock.
 * The keyed ancestor has default=none like PageArrival's nested capture boundary.
 * The title is always a real visible shared pair; all content is ordinary flow. */
async function regionHarness(kind: NativeRegionCase) {
  const below = kind === 'below viewport paired body';
  const header = kind.includes('header');
  const matchingHeader = kind === 'matching outgoing header';
  const result = await build({
    stdin: {
      contents: `
        import React, {startTransition, useState, ViewTransition} from 'react';
        import {createRoot} from 'react-dom/client';
        const proof = {old:[], next:[], effects:[], ready:false, finished:false, error:null};
        const capture = () => Array.from(document.querySelectorAll('[data-region]')).map(element => {
          const {x,y,width,height} = element.getBoundingClientRect();
          return {region:element.dataset.region, name:getComputedStyle(element).viewTransitionName,
            bounds:{x,y,width,height}, viewport:{width:innerWidth,height:innerHeight}};
        });
        const native = document.startViewTransition.bind(document);
        document.startViewTransition = options => {
          proof.old = capture();
          const update = typeof options === 'function' ? options : options.update;
          const wrapped = async () => { await update(); proof.next = capture(); };
          const transition = native(typeof options === 'function' ? wrapped : {...options,update:wrapped});
          const sample = () => {
            for (const animation of document.getAnimations()) {
              const pseudo = animation.effect?.pseudoElement;
              if (pseudo?.startsWith('::view-transition') && !proof.effects.includes(pseudo)) proof.effects.push(pseudo);
            }
            if (!proof.finished) requestAnimationFrame(sample);
          };
          transition.ready.then(() => { proof.ready = true; sample(); }, error => {proof.error = error.name;});
          transition.finished.then(() => {proof.finished = true;}, error => {proof.error = error.name; proof.finished = true;});
          return transition;
        };
        function App() {
          const [step,setStep] = useState(0);
          window.regionHarness = {proof, transition:() => startTransition(() => setStep(n => n+1))};
          const title = <ViewTransition name="fixture-title" default="none" share="fixture-region">
            <h1 data-region="title">{step ? 'Record details' : 'Inventory'}</h1>
          </ViewTransition>;
          const heading = <header data-region="header">{title}<p>Visible route description {step}</p></header>;
          return <ViewTransition key={step} default="none" update="none">
            <main>
              {${header} && (step || ${matchingHeader}) ?
                <ViewTransition name="fixture-header" default="none" share="fixture-region" enter="fixture-region" exit="fixture-region">{heading}</ViewTransition> : heading}
              <ViewTransition name="fixture-body" default="none" share="fixture-region" enter="fixture-region" exit="fixture-region">
                <section data-region="body" style={{marginTop:${below ? 1100 : 24},padding:20,background:'#eee'}}>
                  <p>{step ? 'Current record quantity and storage location' : 'Inventory records and locations'}</p>
                  <button>{step ? 'Move inventory' : 'Open record'}</button>
                </section>
              </ViewTransition>
            </main>
          </ViewTransition>;
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

for (const kind of [
  'visible paired body',
  'below viewport paired body',
  'unmatched visible header',
  'matching outgoing header',
] as const) {
  test(`native region traversal: ${kind}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.setContent(`<style>
      html {view-transition-name:none}
      ::view-transition-group(*) {animation-duration:180ms}
      ::view-transition-old(*), ::view-transition-new(*) {animation-duration:180ms}
    </style><div id="root"></div>`);
    await page.addScriptTag({ content: await regionHarness(kind) });
    await expect(page.getByRole('heading')).toHaveText('Inventory');
    await page.evaluate(() => window.regionHarness.transition());
    await expect(page.getByRole('heading')).toHaveText('Record details');
    await page.waitForFunction(() => window.regionHarness.proof.finished);
    const proof = await page.evaluate(() => window.regionHarness.proof);
    await info.attach('native-region-traversal', {
      body: JSON.stringify({ kind, ...proof }, null, 2),
      contentType: 'application/json',
    });
    const diagnostic = JSON.stringify({ kind, ...proof });
    expect(proof.error, diagnostic).toBeNull();
    expect(proof.ready, diagnostic).toBe(true);
    const hasPair = (name: string) =>
      ['old', 'new'].every((side) =>
        proof.effects.includes(`::view-transition-${side}(${name})`),
      );
    expect(hasPair('fixture-title'), diagnostic).toBe(true);
    for (const captures of [proof.old, proof.next]) {
      const body = captures.find((entry) => entry.region === 'body')!;
      expect(body.bounds.height, diagnostic).toBeGreaterThan(0);
      expect(body.bounds.y >= body.viewport.height, diagnostic).toBe(
        kind === 'below viewport paired body',
      );
      expect(body.name, diagnostic).toBe(
        kind === 'below viewport paired body' ? 'none' : 'fixture-body',
      );
    }
    expect(hasPair('fixture-body'), diagnostic).toBe(
      kind !== 'below viewport paired body',
    );
    expect(
      proof.effects.some((pseudo) => pseudo.includes('(fixture-body)')),
      diagnostic,
    ).toBe(kind !== 'below viewport paired body');
    expect(hasPair('fixture-header'), diagnostic).toBe(
      kind === 'matching outgoing header',
    );
    if (kind === 'unmatched visible header') {
      expect(
        proof.effects.some((pseudo) => pseudo.includes('(fixture-header)')),
        diagnostic,
      ).toBe(false);
      const header = proof.next.find((entry) => entry.region === 'header')!;
      expect(header.bounds.y, diagnostic).toBeLessThan(header.viewport.height);
      expect(header.name, diagnostic).toBe('none');
    }
  });
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
