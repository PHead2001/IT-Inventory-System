import { RouteLoading } from '@/components/experience/route-pending';
export default function LoadingFormDesigner() {
  return (
    <RouteLoading
      shape="designer"
      rows={4}
      label="Loading category form designer…"
    />
  );
}
