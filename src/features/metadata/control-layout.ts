import type { CSSProperties } from 'react';
import type { MetadataDefinition } from './contracts';

export type ControlWidth =
  MetadataDefinition['layout'][number]['controls'][number]['width'];

// The 12-column span describes a preferred basis, not a forced grid track.
// Controls wrap in document order when their minimum usable width will not fit.
const GAP_REM = 0.75;
const NORMAL_MIN_REM = 14;
const SHORT_MIN_REM = 7;

export function controlLayoutStyle(
  width: ControlWidth,
  short = false,
): CSSProperties {
  const span = width === 'Auto' ? (short ? 3 : 4) : width;
  const minimum = short ? SHORT_MIN_REM : NORMAL_MIN_REM;
  const fraction = span / 12;
  const preferred = `calc(${(fraction * 100).toFixed(6)}% - ${((1 - fraction) * GAP_REM).toFixed(6)}rem)`;

  return {
    flexBasis: `max(min(100%, ${minimum}rem), ${preferred})`,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: `min(100%, ${minimum}rem)`,
    maxWidth: '100%',
  };
}
