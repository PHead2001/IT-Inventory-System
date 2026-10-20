export type RouteEffectTiming = {
  pseudo: string;
  startTime: number | null;
  endTime: number;
  activeDuration: number;
  playbackRate: number;
  documentTimeline: boolean;
  paused: boolean;
  rateChanged: boolean;
  delay?: number;
  opacityFrames?: number[];
};

export type RoutePresentationStage = {
  effects: RouteEffectTiming[];
  timingErrors: string[];
};

export type RouteVisibleCapture = {
  name: string;
  region: string;
  bounds: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  hidden: boolean;
  canvas: boolean;
};

/** Every visible authored conventional root needs its own concurrent fade.
 * An offscreen root has no bitmap to invent; a visible incoming root still
 * requires its new fade even when its outgoing counterpart was offscreen. */
export function visibleRouteContentFades(
  stage: RoutePresentationStage & {
    content: { old: RouteVisibleCapture[]; next: RouteVisibleCapture[] };
  },
  titleName: string,
) {
  const missing: string[] = [];
  let checked = 0;
  const titleEffects = stage.effects.filter(
    (effect) =>
      effect.pseudo.endsWith(`(${titleName})`) && effect.activeDuration > 0,
  );
  for (const side of ['old', 'next'] as const) {
    for (const capture of stage.content[side]) {
      const { bounds: b, viewport: v } = capture;
      if (
        capture.hidden ||
        b.width <= 0 ||
        b.height <= 0 ||
        b.x >= v.width ||
        b.y >= v.height ||
        b.x + b.width <= 0 ||
        b.y + b.height <= 0
      )
        continue;
      checked++;
      const name =
        titleName +
        '-content' +
        (capture.region === 'body' ? '' : '-' + capture.region);
      const kind = side === 'old' ? 'old' : 'new';
      const fades = stage.effects.some((effect) => {
        const opacity = effect.opacityFrames ?? [];
        const start =
          effect.startTime === null
            ? NaN
            : effect.startTime + (effect.delay ?? 0) / effect.playbackRate;
        const end = start + effect.activeDuration / effect.playbackRate;
        return (
          effect.pseudo === `::view-transition-${kind}(${name})` &&
          opacity.length >= 2 &&
          opacity[0] === (kind === 'old' ? 1 : 0) &&
          opacity.at(-1) === (kind === 'old' ? 0 : 1) &&
          titleEffects.some((title) => {
            const titleStart =
              title.startTime === null
                ? NaN
                : title.startTime + (title.delay ?? 0) / title.playbackRate;
            return (
              Math.max(start, titleStart) <
              Math.min(
                end,
                titleStart + title.activeDuration / title.playbackRate,
              )
            );
          })
        );
      });
      if (capture.canvas || capture.name !== name || !fades)
        missing.push(kind + ':' + capture.region);
    }
  }
  return { checked, missing };
}

/** Animation document-clock spans, including delays and gaps between stages.
 * Native ready/finished Promise delivery is a separate wall-clock diagnostic. */
export function routePresentationTiming(stages: RoutePresentationStage[]) {
  let earliest = Infinity;
  let latest = -Infinity;
  let animatedStages = 0;
  for (const stage of stages) {
    if (stage.timingErrors.length)
      throw new Error(
        'Route animation timing unavailable: ' + stage.timingErrors.join(', '),
      );
    let animated = false;
    for (const effect of stage.effects) {
      if (effect.activeDuration === 0) continue;
      if (
        effect.startTime === null ||
        !Number.isFinite(effect.startTime) ||
        !Number.isFinite(effect.endTime) ||
        !Number.isFinite(effect.activeDuration) ||
        effect.endTime <= 0 ||
        effect.activeDuration < 0 ||
        !Number.isFinite(effect.playbackRate) ||
        effect.playbackRate <= 0 ||
        !effect.documentTimeline ||
        effect.paused ||
        effect.rateChanged
      )
        throw new Error(
          'Route animation timing unavailable for ' + effect.pseudo,
        );
      animated = true;
      earliest = Math.min(earliest, effect.startTime);
      latest = Math.max(
        latest,
        effect.startTime + effect.endTime / effect.playbackRate,
      );
    }
    if (animated) animatedStages++;
  }
  return {
    animatedStages,
    durationMs: animatedStages ? latest - earliest : 0,
  };
}

/** The rest of the primary must actually fade in the same title capture. */
export function pairedBodyCrossfade(
  stages: RoutePresentationStage[],
  titleName: string,
) {
  const interval = (effect: RouteEffectTiming) => [
    effect.startTime! + (effect.delay ?? 0) / effect.playbackRate,
    effect.startTime! +
      ((effect.delay ?? 0) + effect.activeDuration) / effect.playbackRate,
  ];
  return stages.some((stage) => {
    const titles = stage.effects.filter(
      (effect) =>
        effect.pseudo.endsWith(`(${titleName})`) && effect.activeDuration > 0,
    );
    const overlaps = (effect: RouteEffectTiming) =>
      titles.some((title) => {
        const [a, b] = interval(effect),
          [c, d] = interval(title);
        return Math.max(a, c) < Math.min(b, d);
      });
    return ['old', 'new'].every((kind) =>
      stage.effects.some((effect) => {
        const opacity = effect.opacityFrames ?? [];
        return (
          effect.pseudo === `::view-transition-${kind}(${titleName}-content)` &&
          opacity.length >= 2 &&
          opacity[0] === (kind === 'old' ? 1 : 0) &&
          opacity.at(-1) === (kind === 'old' ? 0 : 1) &&
          overlaps(effect)
        );
      }),
    );
  });
}
