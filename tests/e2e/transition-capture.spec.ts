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
      release?(): void;
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
  canvasAncestors?: string[];
};

type NativeRegionCase =
  | 'visible paired body'
  | 'below viewport paired body'
  | 'unmatched visible header'
  | 'matching outgoing header';

/** Exercise the installed production React traversal, not a ViewTransition mock.
 * This negative deliberately replaces the disabled ancestor with the page.
 * PageArrival is stable; its distinct traversal is exercised below.
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

// Model the actual stable Privacy/Suspense/PageArrival boundaries separately from
// the keyed-disabled-ancestor negative above. Only Next's page/template changes.
type StableTopology =
  'keyed template' | 'retained Activity' | 'delayed Suspense';
async function stableRegionHarness(topology: StableTopology, reverse: boolean) {
  const result = await build({
    stdin: {
      contents: `
        import React, {Activity, Suspense, use, startTransition, useState, ViewTransition} from 'react';
        import {createRoot} from 'react-dom/client';
        import {TransitionCaptureBoundary} from './src/components/forms/transition-capture-boundary';
        const proof = {old:[], next:[], effects:[], ready:false, finished:false, error:null};
        let resolveGate;
        const gate = new Promise(resolve => {resolveGate = resolve;});
        const capture = () => Array.from(document.querySelectorAll('[data-region]')).map(element => {
          const {x,y,width,height} = element.getBoundingClientRect();
          const canvasAncestors = [];
          for (const canvas of element.querySelectorAll('canvas')) {
            for (let ancestor = canvas; ancestor; ancestor = ancestor.parentElement) {
              const name = getComputedStyle(ancestor).viewTransitionName;
              if (name && name !== 'none') canvasAncestors.push(name);
            }
          }
          return {region:element.dataset.region, name:getComputedStyle(element).viewTransitionName,
            bounds:{x,y,width,height}, viewport:{width:innerWidth,height:innerHeight},canvasAncestors};
        });
        const native = document.startViewTransition.bind(document);
        document.startViewTransition = options => {
          proof.old = capture();
          const update = typeof options === 'function' ? options : options.update;
          const wrapped = async () => {await update(); proof.next = capture();};
          const transition = native(typeof options === 'function' ? wrapped : {...options,update:wrapped});
          const sample = () => {
            for (const animation of document.getAnimations()) {
              const pseudo = animation.effect?.pseudoElement;
              if (pseudo?.startsWith('::view-transition') && !proof.effects.includes(pseudo)) proof.effects.push(pseudo);
            }
            if (!proof.finished) requestAnimationFrame(sample);
          };
          transition.ready.then(() => {proof.ready = true; sample();}, error => {proof.error = error.name;});
          transition.finished.then(() => {proof.finished = true;}, error => {proof.error = error.name; proof.finished = true;});
          return transition;
        };
        function Page({step}) {
          if (${topology === 'delayed Suspense'} && step === 1) use(gate);
          const title = <ViewTransition name="stable-title" default="none" update="none" share="fixture-region">
            <h1 data-region="title">{step ? 'Record details' : 'Inventory'}</h1>
          </ViewTransition>;
          const heading = <header data-region="header">{title}<p>Visible route summary</p></header>;
          return <main>
            {step === 1 ? <ViewTransition name="stable-header" default="none" update="none" share="fixture-region" enter="fixture-region" exit="fixture-region" onEnter={() => {}} onExit={() => {}}>
              {heading}
            </ViewTransition> : heading}
            <ViewTransition name="stable-body" default="none" update="none" share="fixture-region" enter="fixture-region" exit="fixture-region">
              <section data-region="body"><p>{step ? 'Item details: manufacturer and description' : 'Matching inventory records'}</p><button>Ordinary action</button></section>
            </ViewTransition>
            <div data-region="canvas-slot"><canvas aria-label="Map excluded from capture" width="200" height="60" /></div>
          </main>;
        }
        function App() {
          const [step,setStep] = useState(${reverse ? 1 : 0});
          window.regionHarness = {proof, transition:() => startTransition(() => setStep(n => 1-n)), release:resolveGate};
          const pages = ${topology === 'retained Activity' ? '[0,1].map(page => <Activity key={page} mode={page === step ? "visible" : "hidden"}><Page step={page}/></Activity>)' : '<Page key={step} step={step}/>'};
          const guarded = <TransitionCaptureBoundary>{pages}</TransitionCaptureBoundary>;
          const inner = <ViewTransition default="none" update="none">{guarded}</ViewTransition>;
          const content = <div data-page-arrival data-route-path={step}>{inner}</div>;
          return <div id="privacy"><Suspense fallback={<p>Loading destination</p>}>
            <ViewTransition default="none" update="none">{content}</ViewTransition>
          </Suspense></div>;
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

for (const topology of [
  'keyed template',
  'retained Activity',
  'delayed Suspense',
] as const) {
  for (const reverse of topology === 'delayed Suspense'
    ? [false]
    : [false, true]) {
    test(`native stable PageArrival traversal: ${topology} ${reverse ? 'source-only header exits' : 'destination-only header enters'}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 1000, height: 700 });
      await page.setContent(`<style>
        html {view-transition-name:none}
        ::view-transition-group(*) {animation-duration:200ms}
        ::view-transition-old(*), ::view-transition-new(*) {animation-duration:200ms}
      </style><div id="root"></div>`);
      await page.addScriptTag({
        content: await stableRegionHarness(topology, reverse),
      });
      await expect(page.getByRole('heading')).toHaveText(
        reverse ? 'Record details' : 'Inventory',
      );
      if (topology === 'retained Activity') {
        // Verify the destination really exists as a hidden retained Activity,
        // rather than accidentally testing a fresh keyed mount again.
        await expect(page.locator('main')).toHaveCount(2);
      }
      await page.evaluate(() => window.regionHarness.transition());
      if (topology === 'delayed Suspense') {
        await expect(page.getByRole('heading')).toHaveText('Inventory');
        expect(
          await page.evaluate(() => window.regionHarness.proof.ready),
        ).toBe(false);
        await page.evaluate(() => window.regionHarness.release!());
      }
      await expect(page.getByRole('heading')).toHaveText(
        reverse ? 'Inventory' : 'Record details',
      );
      await page.waitForFunction(() => window.regionHarness.proof.finished);
      const proof = await page.evaluate(() => window.regionHarness.proof);
      await info.attach('native-stable-page-arrival', {
        body: JSON.stringify({ topology, reverse, ...proof }, null, 2),
        contentType: 'application/json',
      });
      const diagnostic = JSON.stringify({
        ancestors,
        topology,
        reverse,
        ...proof,
      });
      expect(proof.error, diagnostic).toBeNull();
      expect(proof.ready, diagnostic).toBe(true);
      for (const name of ['stable-title', 'stable-body']) {
        expect(proof.effects, diagnostic).toContain(
          `::view-transition-old(${name})`,
        );
        expect(proof.effects, diagnostic).toContain(
          `::view-transition-new(${name})`,
        );
      }
      expect(proof.effects, diagnostic).toContain(
        `::view-transition-${reverse ? 'old' : 'new'}(stable-header)`,
      );
      expect(proof.effects, diagnostic).not.toContain(
        `::view-transition-${reverse ? 'new' : 'old'}(stable-header)`,
      );
      for (const captures of [proof.old, proof.next]) {
        const body = captures.find(
          (entry) => entry.region === 'body' && entry.bounds.height > 0,
        )!;
        expect(body.name, diagnostic).toBe('stable-body');
        expect(body.bounds.y, diagnostic).toBeLessThan(body.viewport.height);
        for (const capture of captures)
          expect(capture.canvasAncestors, diagnostic).toEqual([]);
      }
    });
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
