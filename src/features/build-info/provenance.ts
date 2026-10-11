export type BuildInputs = {
  APP_ENV?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  VERCEL_TARGET_ENV?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
};

export type BuildProvenance = Readonly<{
  environment: string;
  version: string;
  commit: string | null;
  buildStarted: string | null;
}>;

/** Only these nonsensitive fields may enter Next's publicly bundleable env literals. */
export function createBuildProvenance(
  inputs: BuildInputs,
  version: string,
  productionBuild: boolean,
  started: Date,
): BuildProvenance {
  if (!productionBuild)
    return Object.freeze({
      environment: 'Development',
      version,
      commit: null,
      buildStarted: null,
    });
  const labels: Record<string, string> = {
    local: 'Local',
    staging: 'Audit staging',
    preview: 'Preview',
    production: 'Production',
  };
  let environment = Object.hasOwn(labels, inputs.APP_ENV ?? '')
    ? labels[inputs.APP_ENV!]
    : 'Unknown';
  if (inputs.VERCEL === '1') {
    const target = inputs.VERCEL_TARGET_ENV;
    // A verified production target always wins over an application label.
    if (target === 'production' || inputs.VERCEL_ENV === 'production')
      environment = 'Production';
    else if (
      inputs.VERCEL_ENV === 'preview' &&
      (!target || target === 'preview' || target === 'staging')
    )
      environment = inputs.APP_ENV === 'staging' ? 'Audit staging' : 'Preview';
    else if (
      inputs.VERCEL_ENV === 'development' &&
      (!target || target === 'development')
    )
      environment = 'Development';
    else environment = 'Unknown';
  }
  return Object.freeze({
    environment,
    version,
    commit:
      inputs.VERCEL_GIT_COMMIT_SHA?.length === 40 &&
      /^[a-f0-9]{40}$/i.test(inputs.VERCEL_GIT_COMMIT_SHA)
        ? inputs.VERCEL_GIT_COMMIT_SHA!.toLowerCase()
        : null,
    buildStarted: started.toISOString(),
  });
}
