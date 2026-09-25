'use client';
import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export function InventoryListThumbnail({
  path,
  name,
}: {
  path: string;
  name: string;
}) {
  const [client] = useState(createSupabaseBrowserClient);
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      const timer = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void client.storage
      .from('inventory-files')
      .download(path)
      .then(({ data, error }) => {
        if (error || !data) return;
        objectUrl = URL.createObjectURL(data);
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else setUrl(objectUrl);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, path, visible]);
  return (
    <span
      ref={container}
      className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-800 text-xs text-slate-400"
    >
      {url ? (
        // Only a structurally validated, normalized JPEG can be ready here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="h-full w-full object-cover" />
      ) : (
        'Photo'
      )}
    </span>
  );
}
