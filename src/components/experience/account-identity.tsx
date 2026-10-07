/** Identity is supplied by the verified layout session, never cached in browser storage. */
export function AccountIdentity({
  name,
  role,
}: {
  name: string;
  role: string;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => [...part][0])
      .join('')
      .toLocaleUpperCase() || '?';
  return (
    <details className="relative min-w-0">
      <summary
        aria-label={`Account: ${name}, ${role}`}
        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-600 px-2 text-sm text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-300"
      >
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cyan-300/10 text-xs font-semibold text-cyan-100"
        >
          {initials}
        </span>
        <span className="hidden max-w-44 truncate md:block">{name}</span>
      </summary>
      <div className="experience-surface absolute right-0 z-50 mt-2 w-60 max-w-[calc(100vw-2rem)] p-4 [overflow-wrap:anywhere]">
        <p className="font-semibold">{name}</p>
        <p className="mt-1 capitalize text-slate-300">{role}</p>
      </div>
    </details>
  );
}
