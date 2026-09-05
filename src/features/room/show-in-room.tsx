import Link from 'next/link';
import { roomHref } from './navigation';

export function ShowInRoom({ code }: { code: string }) {
  return (
    <Link
      className="inline-flex min-h-11 items-center py-2 text-sm text-cyan-300 underline"
      href={roomHref(code)}
      aria-label={'Show ' + code + ' in room'}
    >
      Show in room
    </Link>
  );
}
