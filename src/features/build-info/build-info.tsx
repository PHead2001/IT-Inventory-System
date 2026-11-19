import type { BuildProvenance } from './provenance';

export function BuildInfo({ provenance }: { provenance: BuildProvenance }) {
  return (
    <section
      aria-labelledby="build-heading"
      className="experience-surface min-w-0 space-y-3 p-5"
    >
      <h2 id="build-heading" className="text-lg font-semibold">
        Build & environment
      </h2>
      <p className="text-sm">
        {provenance.environment} · Version {provenance.version}
      </p>
      <details className="text-sm">
        <summary className="list-item min-h-11 min-w-11 cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-cyan-300">
          Build support details
        </summary>
        <dl className="mt-3 space-y-3">
          <div>
            <dt className="experience-muted">Commit</dt>
            <dd className="break-all font-mono">
              {provenance.commit ?? 'Unavailable'}
            </dd>
          </div>
          <div>
            <dt className="experience-muted">Build started</dt>
            <dd>
              {provenance.buildStarted ? (
                <time dateTime={provenance.buildStarted}>
                  {new Date(provenance.buildStarted).toUTCString()}
                </time>
              ) : (
                'Unavailable in development'
              )}
            </dd>
          </div>
        </dl>
        <p className="experience-muted mt-3">
          Identifies this served build. Release and staging sync status are
          checked separately.
        </p>
      </details>
    </section>
  );
}
