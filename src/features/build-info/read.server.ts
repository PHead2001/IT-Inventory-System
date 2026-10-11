import 'server-only';
import type { BuildProvenance } from './provenance';

/** Next replaces this exact access with the config's immutable build literal. */
export function readBuildProvenance(): BuildProvenance {
  return Object.freeze(
    JSON.parse(process.env.APP_BUILD_PROVENANCE!) as BuildProvenance,
  );
}
