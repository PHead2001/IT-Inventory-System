import { createBuildProvenance, type BuildInputs } from './provenance';

export const PRIVATE_BUILD_BRIDGE = '__IT_INVENTORY_BUILD_PROVENANCE';
const allowedLabels = new Set([
  'Development',
  'Local',
  'Audit staging',
  'Preview',
  'Production',
  'Unknown',
]);

function validateBridge(raw: string | undefined, version: string): string {
  if (!raw) throw new Error('Missing private build provenance snapshot');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid private build provenance snapshot');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !==
      'buildStarted,commit,environment,version' ||
    typeof record.environment !== 'string' ||
    !allowedLabels.has(record.environment) ||
    record.version !== version ||
    !(
      record.commit === null ||
      (typeof record.commit === 'string' &&
        record.commit.length === 40 &&
        /^[a-f0-9]{40}$/.test(record.commit))
    ) ||
    typeof record.buildStarted !== 'string' ||
    !Number.isFinite(Date.parse(record.buildStarted)) ||
    new Date(record.buildStarted).toISOString() !== record.buildStarted
  ) {
    throw new Error('Invalid private build provenance snapshot');
  }
  return raw;
}

/** One factory lifetime is one canonical Next CLI build process. */
export function createConfigSnapshotReader() {
  let parentSnapshot: string | undefined;
  return (
    env: BuildInputs & Record<string, string | undefined>,
    version: string,
    productionBuild: boolean,
    now: () => Date = () => new Date(),
  ) => {
    if (!productionBuild)
      return JSON.stringify(
        createBuildProvenance({}, version, false, new Date(0)),
      );
    // Pinned Next 16.3.6 reloads config in its Turbopack build worker.
    if (env.NEXT_PRIVATE_BUILD_WORKER === '1')
      return validateBridge(env[PRIVATE_BUILD_BRIDGE], version);
    parentSnapshot ??= JSON.stringify(
      createBuildProvenance(env, version, true, now()),
    );
    // Never trust an externally supplied or prior-build bridge in the parent.
    env[PRIVATE_BUILD_BRIDGE] = parentSnapshot;
    return parentSnapshot;
  };
}
