export type RouteEffectTiming = {
  pseudo: string;
  startTime: number | null;
  endTime: number;
  activeDuration: number;
  playbackRate: number;
  documentTimeline: boolean;
  paused: boolean;
  rateChanged: boolean;
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
