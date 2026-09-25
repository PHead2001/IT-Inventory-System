'use client';
import { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

const bucket = 'inventory-files';
type Card = {
  id: string;
  name: string;
  filename: string;
  uploader: string;
  ready_at: string | null;
  type: string;
  bytes: number;
  purpose: string;
  state: string;
  created_at: string;
  version: string;
  replaces_file_id: string | null;
  reviewed_replaced_file_version: string | null;
};
type FileHistory = {
  id: string;
  action: string;
  actor_name: string;
  created_at: string;
  before_title: string | null;
  title: string;
  file_type: string;
  file_bytes: number;
  collection_revision: string;
};
type CardsEnvelope = { revision: string; files: Card[] };
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: { message: string; code?: string } | null;
}>;

export function FilesPanel({
  parentType,
  parentId,
  active,
  staff,
}: {
  parentType: 'asset' | 'quantity';
  parentId: string;
  active: boolean;
  staff: boolean;
}) {
  const [client] = useState(createSupabaseBrowserClient);
  const [cards, setCards] = useState<Card[]>([]);
  const [collectionRevision, setCollectionRevision] = useState('1');
  const [history, setHistory] = useState<FileHistory[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyMore, setHistoryMore] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(
    null,
  );
  const [rpc] = useState(() => client.rpc.bind(client) as unknown as Rpc);
  const load = useCallback(async () => {
    const { data, error } = await rpc('inventory_file_cards', {
      p_parent_type: parentType,
      p_parent_id: parentId,
    });
    if (error) {
      setMessage('Files could not be loaded.');
      return;
    }
    const envelope = data as CardsEnvelope;
    setCards(Array.isArray(envelope?.files) ? envelope.files : []);
    setCollectionRevision(envelope?.revision ?? '1');
  }, [rpc, parentType, parentId]);
  useEffect(() => {
    let cancelled = false;
    void rpc('inventory_file_cards', {
      p_parent_type: parentType,
      p_parent_id: parentId,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setMessage('Files could not be loaded.');
      else {
        const envelope = data as CardsEnvelope;
        setCards(Array.isArray(envelope?.files) ? envelope.files : []);
        setCollectionRevision(envelope?.revision ?? '1');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [rpc, parentType, parentId]);
  useEffect(() => {
    let cancelled = false;
    void rpc('inventory_file_history', {
      p_parent_type: parentType,
      p_parent_id: parentId,
      p_page: historyPage,
    }).then(({ data, error }) => {
      if (cancelled || error) return;
      const result = data as { rows?: FileHistory[]; has_more?: boolean };
      setHistory((previous) =>
        historyPage === 1
          ? (result.rows ?? [])
          : [...previous, ...(result.rows ?? [])],
      );
      setHistoryMore(result.has_more === true);
    });
    return () => {
      cancelled = true;
    };
  }, [rpc, parentType, parentId, historyPage, historyRefresh]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  async function read(
    card: Card,
    variant: 'source' | 'display' | 'thumbnail',
    download: boolean,
  ) {
    setMessage('');
    const { data: path, error } = await rpc('inventory_file_read', {
      p_file_id: card.id,
      p_variant: variant,
    });
    if (error || typeof path !== 'string') {
      setMessage('This file is unavailable.');
      return;
    }
    const response = await client.storage.from(bucket).download(path);
    if (response.error || !response.data) {
      setMessage('This file could not be downloaded.');
      return;
    }
    const url = URL.createObjectURL(response.data);
    if (download) {
      const link = document.createElement('a');
      link.href = url;
      link.download = card.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else setPreview({ name: card.name, url });
  }

  async function validate(
    fileId: string,
    expectedFileVersion: string | null,
    requestId = crypto.randomUUID(),
  ) {
    const response = await fetch('/api/inventory-files/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId,
        requestId,
        expectedRevision: collectionRevision,
        expectedFileVersion,
      }),
    });
    const body: { message?: string } = await response.json();
    if (!response.ok)
      throw new Error(body.message ?? 'Validation could not be confirmed.');
    await fetch('/api/inventory-files/cleanup', { method: 'POST' }).catch(
      () => null,
    );
    window.location.reload();
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      if (file.size < 1 || file.size > 20971520)
        throw new Error('Choose a file up to 20 MiB.');
      if (
        ![
          'image/jpeg',
          'image/png',
          'image/webp',
          ...(parentType === 'asset' ? ['application/pdf'] : []),
        ].includes(file.type)
      )
        throw new Error(
          'Choose a JPEG, PNG, still WebP, or PDF file. HEIC needs conversion first.',
        );
      const safeName = file.name
        .trim()
        .replace(/[\x00-\x1f\x7f/\\]/g, '_')
        .slice(0, 200);
      if (!safeName) throw new Error('Choose a file with a name.');
      const { data, error } = await rpc('inventory_file_reserve', {
        p_parent_type: parentType,
        p_parent_id: parentId,
        p_expected_revision: collectionRevision,
        p_name: safeName,
        p_type: file.type,
        p_bytes: file.size,
        p_replaces: replace || null,
        p_expected_file_version:
          cards.find((card) => card.id === replace)?.version ?? null,
      });
      if (error)
        throw new Error(
          error.code === 'P1002'
            ? 'Files changed. Refresh and review them before uploading.'
            : 'A reservation could not be created.',
        );
      const reservation = data as { id: string; path: string };
      const uploaded = await client.storage
        .from(bucket)
        .upload(reservation.path, file, {
          contentType: file.type,
          upsert: false,
        });
      if (uploaded.error) throw new Error('The file could not be uploaded.');
      const marked = await rpc('inventory_file_uploaded', {
        p_file_id: reservation.id,
      });
      if (marked.error)
        throw new Error('The uploaded file could not be confirmed.');
      setFile(null);
      await validate(
        reservation.id,
        cards.find((card) => card.id === replace)?.version ?? null,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Upload could not be confirmed.',
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function pendingAction(card: Card, action: 'validate' | 'cancel') {
    setBusy(true);
    setMessage('');
    try {
      if (action === 'validate') {
        const replacementVersion = card.replaces_file_id
          ? cards.find(
              (ready) =>
                ready.id === card.replaces_file_id && ready.state === 'ready',
            )?.version
          : null;
        if (card.replaces_file_id && !replacementVersion)
          throw new Error(
            'The replacement target is no longer ready. Cancel this pending file and start a new upload.',
          );
        await validate(card.id, replacementVersion ?? null);
      } else {
        const { error } = await rpc('inventory_file_cancel', {
          p_file_id: card.id,
        });
        if (error) throw new Error('The pending file could not be cancelled.');
        await load();
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'File action failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(card: Card) {
    setBusy(true);
    setMessage('');
    const { error } = await rpc('inventory_file_remove', {
      p_file_id: card.id,
      p_expected_revision: collectionRevision,
      p_expected_file_version: card.version,
      p_request_id: crypto.randomUUID(),
    });
    if (error)
      setMessage(
        error.code === 'P1002'
          ? 'Files changed. Refresh and review them before removing.'
          : 'Removal could not be confirmed.',
      );
    else {
      await fetch('/api/inventory-files/cleanup', { method: 'POST' }).catch(
        () => null,
      );
      window.location.reload();
    }
    setBusy(false);
  }

  async function rename(card: Card) {
    const title = window.prompt('File title', card.name)?.trim();
    if (title === undefined || title === card.name) return;
    setBusy(true);
    setMessage('');
    const { error } = await rpc('inventory_file_rename', {
      p_file_id: card.id,
      p_expected_revision: collectionRevision,
      p_expected_file_version: card.version,
      p_title: title,
      p_request_id: crypto.randomUUID(),
    });
    if (error)
      setMessage(
        error.code === 'P1002'
          ? 'Files changed. Refresh and review them before renaming.'
          : 'Rename could not be confirmed.',
      );
    else {
      await load();
      setHistoryPage(1);
      setHistoryRefresh((value) => value + 1);
    }
    setBusy(false);
  }

  return (
    <section
      aria-label="Inventory files"
      className="my-6 rounded-xl border border-slate-800 bg-slate-900/50 p-5"
    >
      <h2 className="text-xl font-semibold">
        {parentType === 'quantity'
          ? 'Recognition photo'
          : 'Photos and documents'}
      </h2>
      <p className="mt-2 text-sm text-slate-400">
        JPEG, PNG, still WebP{parentType === 'asset' ? ', or PDF' : ''} · Up to
        20 MiB. Photos are normalized before display. PDFs download as
        attachments.
      </p>
      {message && (
        <p role="alert" className="mt-3 text-amber-200">
          {message}
        </p>
      )}
      <ul className="mt-4 space-y-3">
        {cards
          .filter((card) => card.state === 'ready' || staff)
          .map((card) => (
            <li
              key={card.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-700 p-3"
            >
              <FileThumb card={card} read={read} />
              <div className="min-w-0 flex-1">
                <p className="break-all font-medium">{card.name}</p>
                <p className="break-all text-xs text-slate-400">
                  Original: {card.filename}
                </p>
                <p className="text-xs text-slate-400">
                  {card.state} · {(card.bytes / 1048576).toFixed(1)} MiB ·{' '}
                  {card.type} · {card.uploader} ·{' '}
                  {new Date(card.ready_at ?? card.created_at).toLocaleString()}
                </p>
              </div>
              {card.state === 'ready' && (
                <button
                  type="button"
                  className="min-h-11 text-cyan-300 underline"
                  onClick={() =>
                    void read(
                      card,
                      card.type === 'application/pdf' ? 'source' : 'display',
                      card.type === 'application/pdf',
                    )
                  }
                >
                  {card.type === 'application/pdf'
                    ? 'Download PDF'
                    : 'View photo'}
                </button>
              )}
              {staff && card.state === 'ready' && (
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-11 text-cyan-300 underline disabled:opacity-50"
                  onClick={() => void rename(card)}
                >
                  Rename
                </button>
              )}
              {staff && card.state === 'ready' && (
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-11 text-amber-200 underline disabled:opacity-50"
                  onClick={() => void remove(card)}
                >
                  Remove
                </button>
              )}
              {staff && card.state !== 'ready' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-11 text-cyan-300 underline disabled:opacity-50"
                    onClick={() => void pendingAction(card, 'validate')}
                  >
                    Review and publish
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-11 text-amber-200 underline disabled:opacity-50"
                    onClick={() => void pendingAction(card, 'cancel')}
                  >
                    Cancel
                  </button>
                </>
              )}
            </li>
          ))}
      </ul>
      {!cards.some((card) => card.state === 'ready') && (
        <p className="mt-3 text-sm text-slate-400">No ready files yet.</p>
      )}
      {staff && (
        <div className="mt-5 space-y-3 border-t border-slate-700 pt-4">
          <label className="block text-sm font-medium" htmlFor="inventory-file">
            Add{' '}
            {parentType === 'quantity' ? 'recognition photo' : 'photo or PDF'}
          </label>
          <input
            id="inventory-file"
            type="file"
            className="block w-full min-h-11 text-sm"
            accept={
              parentType === 'quantity'
                ? 'image/jpeg,image/png,image/webp'
                : 'image/jpeg,image/png,image/webp,application/pdf'
            }
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {cards.some((card) => card.state === 'ready') && (
            <label className="block text-sm">
              Replace a ready file
              <select
                className="mt-1 block min-h-11 w-full rounded border border-slate-700 bg-slate-950 p-2"
                value={replace}
                onChange={(event) => setReplace(event.target.value)}
              >
                <option value="">Add without replacing</option>
                {cards
                  .filter((card) => card.state === 'ready')
                  .map((card) => (
                    <option key={card.id} value={card.id}>
                      {card.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={!file || busy}
            className="min-h-11 rounded bg-cyan-700 px-4 py-2 disabled:opacity-50"
            onClick={() => void upload()}
          >
            {busy ? 'Working…' : 'Upload and review'}
          </button>
        </div>
      )}
      {!active && staff && (
        <p className="mt-3 text-sm text-slate-400">
          This record is archived or retired; its files remain manageable.
        </p>
      )}
      <div className="mt-5 border-t border-slate-700 pt-4">
        <h3 className="font-semibold">File history</h3>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No file changes yet.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {history.map((event) => (
              <li key={event.id} className="text-sm text-slate-300">
                {new Date(event.created_at).toLocaleString()} ·{' '}
                {event.actor_name} {event.action}{' '}
                {event.before_title && event.before_title !== event.title
                  ? `${event.before_title} → `
                  : ''}
                {event.title} · revision {event.collection_revision}
              </li>
            ))}
          </ol>
        )}
        {historyMore && (
          <button
            type="button"
            className="mt-2 min-h-11 text-cyan-300 underline"
            onClick={() => setHistoryPage((page) => page + 1)}
          >
            More file history
          </button>
        )}
      </div>
      {preview && (
        <div
          role="dialog"
          aria-label={preview.name}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 p-4"
        >
          <button
            type="button"
            className="mb-3 min-h-11 self-end text-cyan-300 underline"
            onClick={() => setPreview(null)}
          >
            Close photo
          </button>
          {/* Blob URL contains only a normalized, validated JPEG. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.url}
            alt={preview.name}
            className="max-h-[80vh] max-w-full object-contain"
          />
        </div>
      )}
    </section>
  );
}

function FileThumb({
  card,
  read,
}: {
  card: Card;
  read: (card: Card, variant: 'thumbnail', download: boolean) => Promise<void>;
}) {
  const [client] = useState(createSupabaseBrowserClient);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (card.state !== 'ready' || card.type === 'application/pdf') return;
    let cancelled = false;
    let localUrl: string | null = null;
    const rpc = client.rpc.bind(client) as unknown as Rpc;
    void rpc('inventory_file_read', {
      p_file_id: card.id,
      p_variant: 'thumbnail',
    }).then(async ({ data, error }) => {
      if (error || typeof data !== 'string') return;
      const result = await client.storage.from(bucket).download(data);
      if (result.error || !result.data) return;
      localUrl = URL.createObjectURL(result.data);
      if (!cancelled) setUrl(localUrl);
      else URL.revokeObjectURL(localUrl);
    });
    return () => {
      cancelled = true;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [card.id, card.state, card.type, client]);
  if (card.state !== 'ready' || card.type === 'application/pdf')
    return (
      <span className="rounded bg-slate-800 px-3 py-2 text-xs">
        {card.type === 'application/pdf' ? 'PDF' : 'File'}
      </span>
    );
  return (
    <button
      type="button"
      aria-label={'Preview ' + card.name}
      className="min-h-11 min-w-16 rounded bg-slate-800 text-xs text-cyan-300"
      onClick={() => void read(card, 'thumbnail', false)}
    >
      {url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="h-16 w-16 rounded object-cover" />
        </>
      ) : (
        'Photo'
      )}
    </button>
  );
}
