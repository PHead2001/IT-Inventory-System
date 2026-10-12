import { notFound } from 'next/navigation';

export function recordTitle(name: string | undefined, section?: string) {
  if (!name) notFound();
  return {
    title: {
      absolute: [name, section, 'IT Inventory'].filter(Boolean).join(' · '),
    },
  };
}
