export default function WorkspaceLoading() {
  return (
    <div className="space-y-5" data-route-loading="true" aria-busy="true">
      <p className="experience-eyebrow">Workspace</p>
      <p role="status" className="text-lg font-semibold text-cyan-200">
        Opening workspace…
      </p>
      <p className="experience-muted text-sm">Loading current information.</p>
      <div aria-hidden="true" className="experience-surface space-y-4 p-5">
        <div className="h-5 w-2/5 rounded bg-slate-700/60" />
        <div className="h-3 w-4/5 rounded bg-slate-800" />
        <div className="h-3 w-3/5 rounded bg-slate-800" />
      </div>
    </div>
  );
}
