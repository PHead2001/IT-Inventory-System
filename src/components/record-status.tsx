export function RecordStatus({ status }: { status: string }) {
  const labels: Record<string, string> = {
    active: 'Active',
    retired: 'Retired',
    archived: 'Archived',
    pending: 'Pending',
  };
  return (
    <span className="experience-record-status" data-state={status}>
      {labels[status] ?? 'Status unavailable'}
    </span>
  );
}
