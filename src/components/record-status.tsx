import { recordStatusLabel } from '@/lib/record-status';
export function RecordStatus({ status }: { status: string }) {
  return (
    <span className="experience-record-status" data-state={status}>
      {recordStatusLabel(status)}
    </span>
  );
}
