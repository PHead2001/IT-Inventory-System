const labels: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  removed: 'Removed',
  retired: 'Retired',
  archived: 'Archived',
  pending: 'Pending',
};
export function recordStatusLabel(status: string) {
  return labels[status] ?? 'Status unavailable';
}
