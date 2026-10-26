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
  opacityOffsets?: number[];
  easing?: string;
};

export type RoutePresentationStage = {
  effects: RouteEffectTiming[];
  timingErrors: string[];
};

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
