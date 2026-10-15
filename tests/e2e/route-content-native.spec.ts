import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { freemem } from 'node:os';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

type Box = { x: number; y: number; width: number; height: number };
type FixturePage = Box & { id: string; old: boolean };
type NativeProof = {
  callbacks: string[];
  errors: string[];
  finished: boolean;
  ready: boolean;
  animations: Array<{
    pseudo: string;
    frames: Array<Record<string, unknown>>;
    duration: number;
  }>;
};

declare global {
  interface Window {
    routeGeometry: {
      proof: NativeProof;
      begin(value: FixturePage | null, freeze?: boolean): void;
      frame(time: number): void;
      mutateTrailing(height: number): void;
      release(): void;
      policy(mode: 'full' | 'reduced', privateReady: boolean): void;
      cssPolicy(mode: 'full' | 'reduced', privateReady: boolean): void;
      interrupt(): void;
    };
  }
}

const fixtures = {
  forward: {
    old: { id: 'list', old: true, x: 20, y: -602, width: 1100, height: 1429 },
    next: {
      id: 'detail',
      old: false,
      x: 40,
      y: -77,
      width: 1180,
      height: 7622,
    },
  },
  back: {
    old: { id: 'detail', old: true, x: 40, y: 151, width: 1180, height: 7622 },
    next: { id: 'list', old: false, x: 20, y: -602, width: 1100, height: 1429 },
  },
} satisfies Record<string, { old: FixturePage; next: FixturePage }>;

// This fixture bundles the installed Next React runtime and the actual helpers.
// It does not wrap startViewTransition or impersonate an application navigation.
// Pixel checkpoints pause only this fictional fixture's real snapshot effects;
// they prove compositing geometry, not normal-speed application performance.
async function fixtureScript(
  initial: FixturePage | null,
  baseline = false,
  forcedIncoming = false,
) {
  const result = await build({
    stdin: {
      contents: `
        import React, {startTransition, useState, ViewTransition} from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import {routeContentMotion} from './src/components/experience/route-content-motion';
        import {sharedTitleMotion} from './src/components/experience/shared-title-motion';
        import {cancelRouteSnapshots} from './src/components/experience/route-motion-state';
        let current = true, mode = 'full', privateReady = true, freeze = true;
        let owned = [], cleanups = [];
        const fresh = () => ({callbacks:[], errors:[], finished:false, ready:false, animations:[]});
        const valid = () => current && mode === 'full' && privateReady;
        const state = window.routeGeometry = {proof:fresh()};
        const relevant = animation => animation.effect?.pseudoElement?.includes('(geometry-');
        const observe = kind => {
          state.proof.callbacks.push(kind);
          const transition = document.activeViewTransition;
          if (!transition) { state.proof.errors.push('Missing actual native transition'); return; }
          transition.finished.then(() => {state.proof.finished = true;}, () => {state.proof.errors.push('Native finish rejected');});
          queueMicrotask(() => {
            owned = document.getAnimations().filter(relevant);
            state.proof.animations = owned.map(animation => ({pseudo:animation.effect.pseudoElement, frames:animation.effect.getKeyframes(), duration:Number(animation.effect.getComputedTiming().activeDuration)}));
            if (freeze) for (const animation of owned) {animation.pause();animation.currentTime=0;}
            state.proof.ready = true;
          });
        };
        function Panel({value}) {
          const enabled = valid();
          const body = instance => {
            let cleanup;
            if (${baseline}) {
              // Historical failing CSS had no body geometry preservation.
              for (const animation of document.getAnimations()) if (animation.effect?.pseudoElement === '::view-transition-group('+instance.name+')') animation.cancel();
            } else {
              cleanup = routeContentMotion(instance, valid, () => state.proof.errors.push('Body fallback'));
              if (cleanup) cleanups.push(cleanup);
              if (${forcedIncoming}) {
                // Negative control recreates the prior incoming size override.
                // Opacity/translation and the corrected group/old path stay real.
                const captured = getComputedStyle(document.documentElement, '::view-transition-group('+instance.name+')');
                const box = {width:captured.width, height:captured.height};
                const forced = document.documentElement.animate([box,box], {duration:200,fill:'both',pseudoElement:'::view-transition-new('+instance.name+')'});
                cleanups.push(()=>forced.cancel());
              }
            }
            observe('share-body');
            return cleanup;
          };
          const title = instance => {
            const cleanup = sharedTitleMotion(instance, valid, () => state.proof.errors.push('Title fallback'));
            if (cleanup) cleanups.push(cleanup);
            return cleanup;
          };
          const ys = value.y < 0 ? [110,420,790] : [220,420,870];
          const landmark = value.old ? '#ff0000' : '#0000ff';
          const xs = value.old ? [24,value.width-50] : [90,value.width-110];
          const heroHeight = Math.max(1000, ...ys.map(y=>y-value.y+24));
          return <ViewTransition default="none" name="geometry-body" share={enabled?'route-content':'none'} enter={enabled?'route-content':'none'} exit={enabled?'route-content':'none'} onShare={body} onEnter={()=>observe('enter-body')} onExit={()=>observe('exit-body')}>
            <article data-body={value.id} style={{position:'absolute',left:value.x,top:value.y,width:value.width,height:'auto',margin:0}}>
              <div data-hero style={{height:heroHeight}}>
              {xs.flatMap((x,xi)=>ys.map((y,yi)=><i key={xi+'-'+yi} data-landmark style={{position:'absolute',left:x,top:y-value.y,width:32,height:24,background:landmark}}/>))}
              <ViewTransition default="none" name="geometry-title" share={enabled?'record-title':'none'} onShare={title}>
                <h1 style={{position:'absolute',left:220,top:300-value.y,width:value.old?180:260,height:value.old?32:48,margin:0,fontSize:16,color:'#00ff00',background:'#00ff00'}}>Fictional title</h1>
              </ViewTransition>
              </div>
              <div data-trailing style={{height:value.height-heroHeight}} />
            </article>
          </ViewTransition>;
        }
        function App() {
          const [value,setValue] = useState(${JSON.stringify(initial)});
          const [,rerender] = useState(0);
          state.begin = (next,hold=true) => {freeze=hold;current=true;state.proof=fresh();cleanups=[];startTransition(()=>setValue(next));};
          state.mutateTrailing = height => {
            const body = document.querySelector('[data-body]');
            const hero = body.querySelector('[data-hero]');
            body.querySelector('[data-trailing]').style.height = (height-Number.parseFloat(hero.style.height))+'px';
          };
          state.frame = time => {for(const animation of owned){animation.pause();animation.currentTime=time;}};
          state.release = () => {for(const animation of owned)animation.play();};
          state.policy = (next,admitted) => {mode=next;privateReady=admitted;document.documentElement.dataset.motion=next;document.documentElement.dataset.routeMotionPrivate=String(admitted);flushSync(()=>rerender(n=>n+1));};
          // Deliberately do not update React state, classes or validity here.
          // The CSS-only test must keep the same native snapshot owners alive.
          state.cssPolicy = (next,admitted) => {document.documentElement.dataset.motion=next;document.documentElement.dataset.routeMotionPrivate=String(admitted);};
          state.interrupt = () => {current=false;privateReady=false;document.documentElement.dataset.routeMotionPrivate='false';cancelRouteSnapshots();for(const cleanup of cleanups)cleanup();};
          return value ? <Panel key={value.id} value={value}/> : <p id="empty">No fictional page</p>;
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

async function mount(
  page: Page,
  initial: FixturePage | null,
  baseline = false,
  forcedIncoming = false,
) {
  const css = await readFile(resolve('src/app/globals.css'), 'utf8');
  const start = css.indexOf('@keyframes route-content-in');
  const end = css.indexOf("html[data-motion='reduced'] *,", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const token = (name: string) => {
    const match = css.match(new RegExp(name + ':\\s*([^;]+);'));
    expect(match).not.toBeNull();
    return match![1];
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setContent(
    `<style>:root{--motion-route:${token('--motion-route')};--ease-workspace:${token('--ease-workspace')}}html,body{margin:0;background:#000;overflow:hidden} ${css.slice(start, end)} ${forcedIncoming ? '::view-transition-new(.route-content){object-fit:fill;}' : ''}</style><div id="root"></div>`,
  );
  await page.locator('html').evaluate((element) => {
    element.dataset.motion = 'full';
    element.dataset.routeMotionPrivate = 'true';
  });
  await page.addScriptTag({
    content: await fixtureScript(initial, baseline, forcedIncoming),
  });
  await page.waitForFunction(() => Boolean(window.routeGeometry?.begin));
  if (initial)
    await expect(page.locator('[data-body]')).toHaveAttribute(
      'data-body',
      initial.id,
    );
}

async function begin(page: Page, next: FixturePage | null, freeze = true) {
  await page.evaluate(
    ({ next, freeze }) => window.routeGeometry.begin(next, freeze),
    { next, freeze },
  );
  await page.waitForFunction(
    () => window.routeGeometry.proof.ready,
    undefined,
    { polling: 10 },
  );
  const proof = await page.evaluate(() => window.routeGeometry.proof);
  expect(proof.errors).toEqual([]);
  return proof;
}

function pixels(png: PNG, box: Box, color: 'red' | 'blue' | 'green') {
  let count = 0;
  for (
    let y = Math.max(0, Math.ceil(box.y));
    y < Math.min(png.height, box.y + box.height);
    y++
  ) {
    for (
      let x = Math.max(0, Math.ceil(box.x));
      x < Math.min(png.width, box.x + box.width);
      x++
    ) {
      const at = (y * png.width + x) * 4;
      const [r, g, b] = [png.data[at], png.data[at + 1], png.data[at + 2]];
      if (
        color === 'red'
          ? r > 0 && g === 0 && b === 0
          : color === 'blue'
            ? b > 6 && r < 4 && g < 4
            : g > 6 && r < 4 && b < 4
      )
        count++;
    }
  }
  return count;
}

async function frame(
  page: Page,
  testInfo: TestInfo,
  name: string,
  time: number,
) {
  await page.evaluate((time) => window.routeGeometry.frame(time), time);
  // The controlled effects remain paused while a real compositor frame paints.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const path = testInfo.outputPath(name + '.png');
  const styles = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) =>
        (animation.effect as KeyframeEffect | null)?.pseudoElement?.includes(
          '(geometry-',
        ),
      )
      .map((animation) => {
        const pseudo = (animation.effect as KeyframeEffect).pseudoElement!;
        const style = getComputedStyle(document.documentElement, pseudo);
        return {
          pseudo,
          time: animation.currentTime,
          state: animation.playState,
          opacity: style.opacity,
          width: style.width,
          height: style.height,
          transform: style.transform,
          objectFit: style.objectFit,
          objectPosition: style.objectPosition,
        };
      }),
  );
  const bytes = await page.screenshot({ path, animations: 'allow' });
  const png = PNG.sync.read(bytes);
  const sampleCoordinate = name.startsWith('back')
    ? { x: 64, y: 220 }
    : { x: 44, y: 110 };
  const sampleAt = (sampleCoordinate.y * png.width + sampleCoordinate.x) * 4;
  await writeFile(
    testInfo.outputPath(name + '.json'),
    JSON.stringify(
      {
        styles,
        sampleCoordinate,
        sampleRGBA: [...png.data.slice(sampleAt, sampleAt + 4)],
      },
      null,
      2,
    ),
  );
  await testInfo.attach(name, { path, contentType: 'image/png' });
  return { png, styles };
}

let memoryTimer: ReturnType<typeof setInterval> | undefined;
test.beforeAll(async ({ browser }) => {
  if (process.env.NATIVE_GEOMETRY_MEMORY_GUARD !== '1') return;
  expect(
    freemem() / 1024 ** 3,
    'Authorized local browser start requires 8 GiB free',
  ).toBeGreaterThanOrEqual(8);
  memoryTimer = setInterval(() => {
    if (freemem() < 6 * 1024 ** 3) void browser.close();
  }, 2000);
});
test.afterAll(() => {
  if (memoryTimer) clearInterval(memoryTimer);
});

for (const direction of ['forward', 'back'] as const) {
  test(`native body preserves ${direction} bitmap landmarks across unequal captured boxes`, async ({
    page,
  }, testInfo) => {
    const { old, next } = fixtures[direction];
    await mount(page, old);
    const proof = await begin(page, next);
    const body = proof.animations.filter((animation) =>
      animation.pseudo.includes('(geometry-body)'),
    );
    expect(body).toHaveLength(3);
    expect(
      proof.callbacks.filter((callback) => callback === 'share-body'),
    ).toHaveLength(1);
    const incoming = body.find(
      (animation) =>
        animation.pseudo === '::view-transition-new(geometry-body)',
    )!;
    expect(incoming.frames[0].transform).toBe('translateY(8px)');
    expect(incoming.frames.at(-1)!.transform).toBe('translateY(0px)');
    for (const keyframe of incoming.frames) {
      expect(keyframe).not.toHaveProperty('width');
      expect(keyframe).not.toHaveProperty('height');
    }
    for (const animation of body) {
      expect(animation.duration).toBe(200);
      expect(animation.frames[0].width).toBe(animation.frames.at(-1)!.width);
      expect(animation.frames[0].height).toBe(animation.frames.at(-1)!.height);
    }
    const ys = old.y < 0 ? [110, 420, 790] : [220, 420, 870];
    for (const time of [0, 60, 130]) {
      const { png, styles } = await frame(
        page,
        testInfo,
        `${direction}-${time}ms`,
        time,
      );
      const image = styles.find(
        (style) => style.pseudo === '::view-transition-old(geometry-body)',
      )!;
      const group = styles.find(
        (style) => style.pseudo === '::view-transition-group(geometry-body)',
      )!;
      expect(image.width).toBe(old.width + 'px');
      expect(image.height).toBe(old.height + 'px');
      const translation = (value: string) =>
        value
          .slice(value.indexOf('(') + 1, -1)
          .split(',')
          .map(Number);
      const imageMatrix = translation(image.transform),
        groupMatrix = translation(group.transform);
      expect(imageMatrix.slice(0, 4)).toEqual([1, 0, 0, 1]);
      expect(groupMatrix[4] + imageMatrix[4]).toBe(old.x);
      expect(groupMatrix[5] + imageMatrix[5]).toBe(old.y);
      // The actual late fade is ~0.02024: red over black quantizes to 5/255.
      // Assert real compositing rather than requiring an arbitrary visibility cutoff.
      const expectedRed = Math.round(255 * Number(image.opacity));
      const incomingStyle = styles.find(
        (style) => style.pseudo === '::view-transition-new(geometry-body)',
      )!;
      const incomingY = translation(incomingStyle.transform)[5];
      expect(incomingY).toBeGreaterThanOrEqual(0);
      expect(incomingY).toBeLessThanOrEqual(8);
      if (time === 0) expect(incomingY).toBe(8);
      else {
        const at =
          ((Math.ceil(110 + incomingY) + 4) * png.width + next.x + 94) * 4;
        expect(
          Math.abs(
            png.data[at + 2] - Math.round(255 * Number(incomingStyle.opacity)),
          ),
          'Incoming pixels follow the real 8px settle without stretching',
        ).toBeLessThanOrEqual(1);
      }
      for (const x of [old.x + 24, old.x + old.width - 50])
        for (const y of ys) {
          if (time <= 60)
            expect(
              pixels(png, { x, y, width: 32, height: 24 }, 'red'),
              `Visible original ${direction} landmark ${x},${y} at ${time}ms`,
            ).toBeGreaterThan(700);
          const at = (y * png.width + x) * 4;
          expect(
            Math.abs(png.data[at] - expectedRed),
            'Native outgoing opacity must match its actual unshifted pixel',
          ).toBeLessThanOrEqual(1);
          expect(
            pixels(png, { x: x - 5, y: y - 5, width: 42, height: 34 }, 'red'),
          ).toBeLessThanOrEqual(768);
        }
      expect(
        pixels(png, { x: 180, y: 200, width: 400, height: 220 }, 'green'),
        'Shared title fills the named child instead of leaving a snapshot hole',
      ).toBeGreaterThan(100);
    }
    await page.evaluate(() => window.routeGeometry.release());
    await page.waitForFunction(
      () => window.routeGeometry.proof.finished,
      undefined,
      { polling: 10 },
    );
    expect(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) =>
              (
                animation.effect as KeyframeEffect | null
              )?.pseudoElement?.includes('(geometry-'),
            ).length,
      ),
    ).toBe(0);
    await testInfo.attach('native-proof', {
      body: JSON.stringify(proof),
      contentType: 'application/json',
    });
  });
}

// Mutate only trailing flow content after native capture. The hero, shared title
// and colored landmarks retain their live document geometry throughout.
for (const direction of ['forward', 'back'] as const) {
  for (const change of ['shrink', 'grow'] as const) {
    test(`native incoming keeps hero pixels natural when trailing content ${change}s after ${direction} capture`, async ({
      page,
    }, testInfo) => {
      const { old } = fixtures[direction];
      const next = {
        ...fixtures[direction].next,
        height: direction === 'forward' ? 7320 : 2400,
      };
      const height = next.height + (change === 'shrink' ? -880 : 880);
      await mount(page, old);
      await begin(page, next);
      const before = await page.locator('[data-hero]').boundingBox();
      await page.evaluate(
        (height) => window.routeGeometry.mutateTrailing(height),
        height,
      );
      expect(await page.locator('[data-hero]').boundingBox()).toEqual(before);
      expect((await page.locator('[data-body]').boundingBox())!.height).toBe(
        height,
      );
      for (const time of [60, 130, 199]) {
        const { png, styles } = await frame(
          page,
          testInfo,
          `${direction}-${change}-${time}ms`,
          time,
        );
        const group = styles.find(
          (style) => style.pseudo === '::view-transition-group(geometry-body)',
        )!;
        const incoming = styles.find(
          (style) => style.pseudo === '::view-transition-new(geometry-body)',
        )!;
        const outgoing = styles.find(
          (style) => style.pseudo === '::view-transition-old(geometry-body)',
        )!;
        expect(Number.parseFloat(group.height)).toBe(next.height);
        expect(Number.parseFloat(incoming.height)).toBe(height);
        expect(Number.parseFloat(incoming.width)).toBe(next.width);
        expect(incoming.objectFit).toBe('none');
        expect(incoming.objectPosition).toBe('0px 0px');
        expect(Number.parseFloat(outgoing.height)).toBe(old.height);
        expect(Number.parseFloat(outgoing.width)).toBe(old.width);
        const matrix = incoming.transform
          .slice(incoming.transform.indexOf('(') + 1, -1)
          .split(',')
          .map(Number);
        expect(matrix.slice(0, 4)).toEqual([1, 0, 0, 1]);
        for (const x of [next.x + 90, next.x + next.width - 110]) {
          for (const y of [110, 420, 790]) {
            expect(
              pixels(
                png,
                { x, y: y + matrix[5], width: 32, height: 24 },
                'blue',
              ),
              `Natural ${direction}/${change} hero landmark ${x},${y} at ${time}ms`,
            ).toBeGreaterThan(700);
          }
        }
      }
      await page.evaluate(() => window.routeGeometry.release());
      await page.waitForFunction(
        () => window.routeGeometry.proof.finished,
        undefined,
        { polling: 10 },
      );
      const live = PNG.sync.read(
        await page.screenshot({ animations: 'allow' }),
      );
      expect(
        pixels(live, { x: next.x + 90, y: 790, width: 32, height: 24 }, 'blue'),
      ).toBe(768);
    });
  }
}
for (const change of ['shrink', 'grow'] as const) {
  test(`forced incoming sizing negative control distorts fixed hero pixels after trailing content ${change}s`, async ({
    page,
  }, testInfo) => {
    const old = fixtures.forward.old;
    const next = { ...fixtures.forward.next, height: 7320 };
    const height = next.height + (change === 'shrink' ? -880 : 880);
    await mount(page, old, false, true);
    await begin(page, next);
    await page.evaluate(
      (height) => window.routeGeometry.mutateTrailing(height),
      height,
    );
    const { png, styles } = await frame(
      page,
      testInfo,
      `forced-incoming-${change}`,
      130,
    );
    const incoming = styles.find(
      (style) => style.pseudo === '::view-transition-new(geometry-body)',
    )!;
    expect(Number.parseFloat(incoming.height)).toBe(next.height);
    expect(incoming.objectFit).toBe('fill');
    const matrix = incoming.transform
      .slice(incoming.transform.indexOf('(') + 1, -1)
      .split(',')
      .map(Number);
    expect(
      pixels(
        png,
        { x: next.x + 90, y: 790 + matrix[5], width: 32, height: 24 },
        'blue',
      ),
      'The old forced height must fail the natural fixed-hero landmark requirement',
    ).toBeLessThan(100);
    await page.evaluate(() => window.routeGeometry.release());
    await page.waitForFunction(
      () => window.routeGeometry.proof.finished,
      undefined,
      { polling: 10 },
    );
  });
}

test('pixel control reproduces the historical shifted bitmap without body preservation', async ({
  page,
}, testInfo) => {
  await mount(page, fixtures.forward.old, true);
  await begin(page, fixtures.forward.next);
  const { png } = await frame(
    page,
    testInfo,
    'historical-body-origin-control',
    0,
  );
  expect(
    pixels(
      png,
      { x: fixtures.forward.old.x + 24, y: 110, width: 32, height: 24 },
      'red',
    ),
  ).toBeLessThan(20);
  expect(
    pixels(png, { x: 0, y: 0, width: 1280, height: 900 }, 'red'),
  ).toBeGreaterThan(700);
  await page.evaluate(() => window.routeGeometry.release());
  await page.waitForFunction(
    () => window.routeGeometry.proof.finished,
    undefined,
    { polling: 10 },
  );
});

test('native single-sided entry and exit finish without a paused group', async ({
  page,
}) => {
  await mount(page, null);
  const enter = await begin(page, fixtures.forward.next, false);
  expect(enter.callbacks).toContain('enter-body');
  await page.waitForFunction(
    () => window.routeGeometry.proof.finished,
    undefined,
    { polling: 10 },
  );
  const exit = await begin(page, null, false);
  expect(exit.callbacks).toContain('exit-body');
  await page.waitForFunction(
    () => window.routeGeometry.proof.finished,
    undefined,
    { polling: 10 },
  );
  await expect(page.locator('#empty')).toBeVisible();
});

test('native interruption retires owned effects and a later transition completes', async ({
  page,
}) => {
  await mount(page, fixtures.forward.old);
  await begin(page, fixtures.forward.next);
  await page.evaluate(() => window.routeGeometry.interrupt());
  await page.waitForFunction(
    () => window.routeGeometry.proof.finished,
    undefined,
    { polling: 10 },
  );
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((animation) =>
            (
              animation.effect as KeyframeEffect | null
            )?.pseudoElement?.includes('(geometry-'),
          ).length,
    ),
  ).toBe(0);
  await page.evaluate(() => window.routeGeometry.policy('full', true));
  await begin(page, { ...fixtures.forward.old, id: 'recovered-list' }, false);
  await page.waitForFunction(
    () => window.routeGeometry.proof.finished,
    undefined,
    { polling: 10 },
  );
});

async function pausedBodyEffects(page: Page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) =>
        (animation.effect as KeyframeEffect | null)?.pseudoElement?.includes(
          '(geometry-body)',
        ),
      )
      .map((animation) => ({
        pseudo: (animation.effect as KeyframeEffect).pseudoElement,
        state: animation.playState,
        time: animation.currentTime,
      }))
      .sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo))),
  );
}

test('real Reduced and privacy CSS alone hide still-owned paused native snapshots', async ({
  page,
}, testInfo) => {
  for (const policy of [
    { mode: 'reduced' as const, privateReady: true },
    { mode: 'full' as const, privateReady: false },
  ]) {
    await mount(page, fixtures.forward.old);
    await begin(page, fixtures.forward.next);
    const before = await pausedBodyEffects(page);
    expect(before).toHaveLength(3);
    expect(before.every((effect) => effect.state === 'paused')).toBe(true);
    await page.evaluate(
      ({ mode, privateReady }) =>
        window.routeGeometry.cssPolicy(mode, privateReady),
      policy,
    );
    expect(await pausedBodyEffects(page)).toEqual(before);
    const path = testInfo.outputPath(
      `snapshot-hidden-${policy.mode}-${policy.privateReady}.png`,
    );
    const png = PNG.sync.read(
      await page.screenshot({ path, animations: 'allow' }),
    );
    expect(pixels(png, { x: 0, y: 0, width: 1280, height: 900 }, 'red')).toBe(
      0,
    );
    expect(
      await page.evaluate(() =>
        ['geometry-body', 'geometry-title'].map(
          (name) =>
            getComputedStyle(
              document.documentElement,
              `::view-transition-group(${name})`,
            ).display,
        ),
      ),
    ).toEqual(['none', 'none']);
    await testInfo.attach(
      `snapshot-hidden-${policy.mode}-${policy.privateReady}`,
      { path, contentType: 'image/png' },
    );
    await page.evaluate(() => window.routeGeometry.interrupt());
    await page.waitForFunction(
      () => window.routeGeometry.proof.finished,
      undefined,
      { polling: 10 },
    );
    // The actual cancellation helper removes the root snapshot overlay; CSS
    // hiding alone deliberately reveals no captured private image underneath.
    const livePath = testInfo.outputPath(
      `live-after-cancel-${policy.mode}-${policy.privateReady}.png`,
    );
    const live = PNG.sync.read(
      await page.screenshot({ path: livePath, animations: 'allow' }),
    );
    expect(
      pixels(live, { x: 0, y: 0, width: 1280, height: 900 }, 'blue'),
    ).toBeGreaterThan(700);
    expect(pixels(live, { x: 0, y: 0, width: 1280, height: 900 }, 'red')).toBe(
      0,
    );
  }
});

test('CSS-disabled withdrawal control retains old pixels with the same paused owners', async ({
  page,
}, testInfo) => {
  await mount(page, fixtures.forward.old);
  await begin(page, fixtures.forward.next);
  const before = await pausedBodyEffects(page);
  expect(before).toHaveLength(3);
  await page.addStyleTag({
    content:
      "html[data-route-motion-private='false']::view-transition-group(*) {display:block !important;}",
  });
  await page.evaluate(() => window.routeGeometry.cssPolicy('full', false));
  expect(await pausedBodyEffects(page)).toEqual(before);
  const path = testInfo.outputPath('css-disabled-private-snapshot-control.png');
  const png = PNG.sync.read(
    await page.screenshot({ path, animations: 'allow' }),
  );
  expect(
    pixels(png, { x: 44, y: 110, width: 32, height: 24 }, 'red'),
  ).toBeGreaterThan(700);
  await testInfo.attach(
    'CSS-disabled control fails the zero-old-pixels requirement',
    { path, contentType: 'image/png' },
  );
  await page.evaluate(() => window.routeGeometry.interrupt());
  await page.waitForFunction(
    () => window.routeGeometry.proof.finished,
    undefined,
    { polling: 10 },
  );
});
