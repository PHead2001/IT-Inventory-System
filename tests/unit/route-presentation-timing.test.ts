import { expect, it } from 'vitest';
import {
  routePresentationTiming,
  pairedBodyCrossfade,
  type RouteEffectTiming,
} from '../e2e/route-presentation-timing';

const effect = (
  changes: Partial<RouteEffectTiming> = {},
): RouteEffectTiming => ({
  pseudo: '::view-transition-group(title)',
  startTime: 100,
  endTime: 200,
  activeDuration: 200,
  playbackRate: 1,
  documentTimeline: true,
  paused: false,
  rateChanged: false,
  ...changes,
});
const stage = (...effects: RouteEffectTiming[]) => ({
  effects,
  timingErrors: [],
});

it('requires actual body old/new opacity effects concurrent with the exact title in the same stage', () => {
  const title = effect({ pseudo: '::view-transition-group(title)' });
  const old = effect({
    pseudo: '::view-transition-old(title-content)',
    opacityFrames: [1, 0],
  });
  const next = effect({
    pseudo: '::view-transition-new(title-content)',
    opacityFrames: [0, 1],
  });
  expect(pairedBodyCrossfade([stage(title, old, next)], 'title')).toBe(true);
  expect(pairedBodyCrossfade([stage(title)], 'title')).toBe(false);
  expect(pairedBodyCrossfade([stage(title), stage(old, next)], 'title')).toBe(
    false,
  );
  expect(
    pairedBodyCrossfade(
      [stage(title, old, { ...next, startTime: 400 })],
      'title',
    ),
  ).toBe(false);
  expect(
    pairedBodyCrossfade(
      [stage(title, old, { ...next, opacityFrames: [1, 1] })],
      'title',
    ),
  ).toBe(false);
});

it('measures concurrent title/content as one stage and sequential stages including their gap', () => {
  expect(
    routePresentationTiming([stage(effect(), effect({ startTime: 102 }))]),
  ).toEqual({
    animatedStages: 1,
    durationMs: 202,
  });
  expect(
    routePresentationTiming([
      stage(effect()),
      stage(effect({ startTime: 300 })),
    ]),
  ).toEqual({
    animatedStages: 2,
    durationMs: 400,
  });
  expect(
    routePresentationTiming([
      stage(effect()),
      stage(effect({ startTime: 350 })),
    ]).durationMs,
  ).toBe(450);
});

it('normalizes a fixed playback rate and includes delay/end delay in endTime', () => {
  expect(
    routePresentationTiming([stage(effect({ endTime: 240, playbackRate: 2 }))])
      .durationMs,
  ).toBe(120);
});

it.each([
  { startTime: null },
  { startTime: NaN },
  { endTime: Infinity },
  { activeDuration: Infinity },
  { playbackRate: 0 },
  { playbackRate: -1 },
  { paused: true },
  { rateChanged: true },
  { documentTimeline: false },
])('rejects unresolved or interrupted document-clock timing %j', (changes) => {
  expect(() => routePresentationTiming([stage(effect(changes))])).toThrow(
    'timing unavailable',
  );
});

it('rejects observation errors and does not count zero-duration captures as animated stages', () => {
  expect(() =>
    routePresentationTiming([
      { effects: [], timingErrors: ['ready rejected'] },
    ]),
  ).toThrow('ready rejected');
  expect(
    routePresentationTiming([stage(effect({ activeDuration: 0 })), stage()]),
  ).toEqual({
    animatedStages: 0,
    durationMs: 0,
  });
});
