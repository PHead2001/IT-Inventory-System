'use client';
import { useRef, useState } from 'react';

/** Retained values are untrusted too. No requests or metadata previews are made. */
export function safeWebLink(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    [...value].length > 2048 ||
    !/^https?:\/\/[^/?#@:\s]+(:[0-9]{1,5})?([/?#][^\s]*)?$/.test(value) ||
    /[\x00-\x1f\x7f\\]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}
export function WebLinkValue({ value }: { value: unknown }) {
  const href = safeWebLink(value);
  const [message, setMessage] = useState('');
  const [manual, setManual] = useState(false);
  const fallback = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="min-w-0 space-y-2">
      <span className="block [overflow-wrap:anywhere]">
        {typeof value === 'string' ? value : String(value)}
      </span>
      {href ? (
        <div className="flex flex-wrap gap-3">
          <a
            className="inline-flex min-h-11 min-w-11 max-w-full items-center [overflow-wrap:anywhere] text-cyan-200 underline"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${href} in a new tab`}
          >
            Open link
          </a>
          <button
            type="button"
            className="min-h-11 min-w-11 text-cyan-200 underline"
            aria-label={`Copy ${href}`}
            onClick={async () => {
              try {
                if (!navigator.clipboard?.writeText)
                  throw new Error('Clipboard unavailable');
                await navigator.clipboard.writeText(href);
                setMessage('Link copied.');
              } catch {
                setManual(true);
                setMessage(
                  'Automatic copying is unavailable. Select the full link below and copy it manually.',
                );
              }
            }}
          >
            Copy link
          </button>
        </div>
      ) : (
        <p className="text-xs text-amber-200">
          This retained value is not a safe HTTP or HTTPS link and cannot be
          opened here.
        </p>
      )}
      {manual && (
        <label className="block text-xs">
          Full link for manual copying
          <textarea
            ref={fallback}
            readOnly
            value={href ?? ''}
            className="block min-h-20 w-full break-all rounded bg-slate-950 p-2"
            onFocus={(event) => event.target.select()}
          />
          <button
            type="button"
            className="min-h-11 min-w-11 underline"
            onClick={() => {
              fallback.current?.focus();
              fallback.current?.select();
            }}
          >
            Select full link
          </button>
        </label>
      )}
      <span role="status" className="block text-xs text-slate-400">
        {message}
      </span>
    </div>
  );
}
