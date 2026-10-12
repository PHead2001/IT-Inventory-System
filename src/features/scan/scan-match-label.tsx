import type { ScanMatch } from './resolve.server';

/** Separate canonical display fields; never split a user name or combined label. */
export function ScanMatchLabel({ match }: { match: ScanMatch }) {
  if (match.name === undefined) return <>{match.label}</>;
  return (
    <>
      {match.name}
      {match.identifier && (
        <>
          {' '}
          (<span className="experience-code">{match.identifier}</span>)
        </>
      )}
    </>
  );
}

export function ScanMatchContext({ match }: { match: ScanMatch }) {
  return (
    <>
      {match.serialNumber && (
        <>
          {'Serial: '}
          <span className="experience-code">{match.serialNumber}</span>
          {' · '}
        </>
      )}
      {match.context}
    </>
  );
}
