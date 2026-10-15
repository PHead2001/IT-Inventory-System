'use client';
import { afterTransitionCapture } from '@/components/forms/transition-capture';
import {
  LoadingAnnouncement,
  LoadingReveal,
} from '@/components/ui/loading-skeleton';
import { OperationalTimestamp } from '@/components/operational-time';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { formatFileSize } from '@/lib/file-size';
import {
  cleanupResultSchema,
  inventoryFileCardsSchema,
  type CleanupResult,
  type InventoryFileCard as Card,
  type InventoryFileCards as CardsEnvelope,
} from './contract';
import { validateSelectedFile } from './selection';

const bucket = 'inventory-files';
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
function fileState(state: string) {
  switch (state) {
    case 'ready':
      return { label: 'Ready', detail: '' };
    case 'reserved':
      return {
        label: 'Waiting for upload confirmation',
        detail:
          'If bytes were uploaded, confirm them before review. Otherwise cancel this pending file and choose the file again.',
      };
    case 'uploaded':
      return {
        label: 'Uploaded · review required',
        detail:
          'Choose Review and publish to validate this file. It is not available to view yet.',
      };
    case 'validating':
      return {
        label: 'Validation in progress',
        detail:
          'This file is being checked. If interrupted, retry review after the validation lease expires.',
      };
    case 'validated':
      return {
        label: 'Awaiting publication',
        detail:
          'Choose Review and publish to renew validation and publish this file.',
      };
    case 'rejected':
      return {
        label: 'File rejected',
        detail:
          'This file could not be published. Choose a supported file and add it again; byte cleanup remains unconfirmed.',
      };
    case 'removed':
      return {
        label: 'Removed',
        detail:
          'This file is no longer available. Byte cleanup remains unconfirmed.',
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        detail: 'This upload was cancelled. Byte cleanup remains unconfirmed.',
      };
    case 'expired':
      return {
        label: 'Upload expired',
        detail:
          'Choose the file again to start a new upload. Byte cleanup remains unconfirmed.',
      };
    default:
      return {
        label: 'File unavailable',
        detail: 'Refresh this record to check its current file state.',
      };
  }
}
const pendingStates = new Set([
  'reserved',
  'uploaded',
  'validating',
  'validated',
]);
function fileType(type: string) {
  return (
    (
      {
        'image/jpeg': 'JPEG photo',
        'image/png': 'PNG photo',
        'image/webp': 'WebP photo',
        'application/pdf': 'PDF document',
      } as Record<string, string>
    )[type] ?? type
  );
}
function cleanupStatus(result: CleanupResult | number | null) {
  if (result && typeof result === 'object') {
    if (result.status === 'no_work')
      return 'No file cleanup is needed for this record.';
    if (result.status === 'complete')
      return 'File cleanup is complete for this record. No stored objects await cleanup.';
    if (result.status === 'partial' || result.status === 'failed')
      return `Deleted ${result.deleted} stored object${result.deleted === 1 ? '' : 's'}. ${result.failed} cleanup confirmation${result.failed === 1 ? '' : 's'} failed; retry later.`;
    return `Deleted ${result.deleted} stored object${result.deleted === 1 ? '' : 's'}. ${result.outstanding} stored object${result.outstanding === 1 ? '' : 's'} still await${result.outstanding === 1 ? 's' : ''} cleanup; retry later.`;
  }
  const deleted = result;
  return deleted === null
    ? 'Byte cleanup could not be confirmed; retry later.'
    : `Deleted ${deleted} stored object${deleted === 1 ? '' : 's'}. Remaining cleanup is unverified; retry later.`;
}
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
  actorId,
  parentName = 'this inventory record',
  initialEnvelope,
}: {
  parentType: 'asset' | 'quantity';
  parentId: string;
  active: boolean;
  staff: boolean;
  actorId: string;
  parentName?: string;
  initialEnvelope: CardsEnvelope;
}) {
  return (
    <BoundFilesPanel
      key={`${process.env.NEXT_PUBLIC_SUPABASE_URL}:${actorId}:${parentType}:${parentId}:${staff}`}
      parentType={parentType}
      parentId={parentId}
      active={active}
      staff={staff}
      parentName={parentName}
      initialEnvelope={initialEnvelope}
    />
  );
}

function BoundFilesPanel({
  parentType,
  parentId,
  active,
  staff,
  parentName,
  initialEnvelope,
}: {
  parentType: 'asset' | 'quantity';
  parentId: string;
  active: boolean;
  staff: boolean;
  parentName: string;
  initialEnvelope: CardsEnvelope;
}) {
  const [client] = useState(createSupabaseBrowserClient);
  const [cards, setCards] = useState<Card[]>(() => initialEnvelope.files);
  const [collectionRevision, setCollectionRevision] = useState(
    initialEnvelope.revision,
  );
  const [history, setHistory] = useState<FileHistory[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyMore, setHistoryMore] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);
  const selectedPreviewRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (selectedPreviewRef.current)
        URL.revokeObjectURL(selectedPreviewRef.current);
    },
    [],
  );
  function handleSelectedFile(next: File | null) {
    if (selectedPreviewRef.current)
      URL.revokeObjectURL(selectedPreviewRef.current);
    selectedPreviewRef.current = null;
    setSelectedPreview(null);
    setFile(null);
    if (!next) return;
    try {
      validateSelectedFile(next, parentType);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Choose a supported file.',
      );
      return;
    }
    setMessage('');
    setFile(next);
    if (next.type.startsWith('image/')) {
      try {
        const url = URL.createObjectURL(next);
        selectedPreviewRef.current = url;
        setSelectedPreview(url);
      } catch {
        /* A local preview failure does not change upload eligibility. */
      }
    }
  }
  const [replace, setReplace] = useState('');
  const replaceUnavailable = Boolean(
    replace &&
    !cards.some((card) => card.id === replace && card.state === 'ready'),
  );
  const [busy, setBusy] = useState(false);
  const [removal, setRemoval] = useState<{
    card: Card;
    owner: string;
    revision: string;
    requestId: string;
    phase: 'review' | 'sending' | 'unknown' | 'stale';
  } | null>(null);
  const removalLock = useRef(false);
  const removalDialog = useRef<HTMLDialogElement>(null);
  const removalTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    return afterTransitionCapture(document, () => {
      if (removal) {
        const dialog = removalDialog.current;
        if (dialog && !dialog.open) {
          if (dialog.showModal) dialog.showModal();
          else dialog.setAttribute('open', '');
          dialog.querySelector<HTMLButtonElement>('button')?.focus();
        }
      } else {
        if (removalTrigger.current?.isConnected) removalTrigger.current.focus();
      }
    });
  }, [removal]);
  const [message, setMessage] = useState('');
  const [readError, setReadError] = useState(false);
  useEffect(() => {
    function preventFileNavigation(event: DragEvent) {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    }
    document.addEventListener('dragover', preventFileNavigation);
    document.addEventListener('drop', preventFileNavigation);
    return () => {
      document.removeEventListener('dragover', preventFileNavigation);
      document.removeEventListener('drop', preventFileNavigation);
    };
  }, []);
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [cleanupPending, setCleanupPending] = useState(false);
  const [preview, setPreview] = useState<{
    id: string;
    name: string;
    url: string;
  } | null>(null);
  const [rpc] = useState(() => client.rpc.bind(client) as unknown as Rpc);
  const mounted = useRef(true);
  const invalidatedFiles = useRef(new Set<string>());
  const readGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(
    async (
      isCurrent: () => boolean = () => true,
    ): Promise<CardsEnvelope | null> => {
      const generation = ++readGeneration.current;
      try {
        const { data, error } = await rpc('inventory_file_cards', {
          p_parent_type: parentType,
          p_parent_id: parentId,
        });
        if (
          !mounted.current ||
          !isCurrent() ||
          generation !== readGeneration.current
        )
          return null;
        const parsed = inventoryFileCardsSchema.safeParse(data);
        if (error || !parsed.success) {
          setReadError(true);
          return null;
        }
        const envelope = parsed.data;
        setCards(
          envelope.files.filter(
            (card) => !invalidatedFiles.current.has(card.id),
          ),
        );
        setCollectionRevision(envelope.revision);
        setReadError(false);
        return envelope;
      } catch {
        if (
          mounted.current &&
          isCurrent() &&
          generation === readGeneration.current
        )
          setReadError(true);
        return null;
      }
    },
    [rpc, parentType, parentId],
  );
  async function cleanupTerminalFiles() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/inventory-files/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentType, parentId }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Cleanup request failed.');
      const result = cleanupResultSchema.parse(await response.json());
      if (!mounted.current) return null;
      setCleanupPending(result.pending);
      return result;
    } catch {
      if (mounted.current) setCleanupPending(true);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  const seenEnvelope = useRef(initialEnvelope);
  const refreshPending = useRef(false);
  useEffect(() => {
    if (seenEnvelope.current !== initialEnvelope) {
      seenEnvelope.current = initialEnvelope;
      refreshPending.current = true;
    }
    // RSC refresh props are an invalidation signal, never an ordered snapshot:
    // pending file versions can change without advancing collection revision.
    // Keep local intents and ambiguous removal outcomes intact until settled.
    // Feedback and cleanup retries survive rereads; they are not refresh locks.
    if (!refreshPending.current || busy || removal || file || replace) return;
    refreshPending.current = false;
    setLoading(true);
    let current = true;
    let completed = false;
    void load(() => current).finally(() => {
      completed = true;
      if (mounted.current && current) setLoading(false);
    });
    return () => {
      current = false;
      setLoading(false);
      if (!completed) refreshPending.current = true;
    };
  }, [initialEnvelope, busy, removal, file, replace, load]);
  useEffect(() => {
    let cancelled = false;
    void rpc('inventory_file_history', {
      p_parent_type: parentType,
      p_parent_id: parentId,
      p_page: historyPage,
    }).then(({ data, error }) => {
      if (cancelled) return;
      setHistoryError(Boolean(error));
      if (error) return;
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
    if (!mounted.current || invalidatedFiles.current.has(card.id)) return;
    if (error || typeof path !== 'string') {
      setMessage('This file is unavailable.');
      return;
    }
    const response = await client.storage.from(bucket).download(path);
    if (!mounted.current || invalidatedFiles.current.has(card.id)) return;
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
    } else setPreview({ id: card.id, name: card.name, url });
  }

  async function validate(
    fileId: string,
    expectedFileVersion: string | null,
    requestId = crypto.randomUUID(),
    replacedId: string | null = null,
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
    const body: {
      message?: string;
      terminalRejected?: boolean;
      cleanupPending?: boolean;
      cleanupDeleted?: number | null;
      cleanup?: CleanupResult | null;
    } = await response.json();
    if (!response.ok) {
      if (body.terminalRejected) {
        invalidatedFiles.current.add(fileId);
        setCards((current) => current.filter((card) => card.id !== fileId));
        const cleanup = cleanupResultSchema.safeParse(body.cleanup);
        setCleanupPending(cleanup.success ? cleanup.data.pending : true);
        await load();
        throw new Error(
          `${body.message ?? 'Validation could not be confirmed.'} ${cleanupStatus(cleanup.success ? cleanup.data : (body.cleanupDeleted ?? null))}`,
        );
      }
      throw new Error(body.message ?? 'Validation could not be confirmed.');
    }
    if (replacedId) {
      invalidatedFiles.current.add(replacedId);
      setReplace((current) => (current === replacedId ? '' : current));
      setCards((current) => current.filter((card) => card.id !== replacedId));
      setPreview((current) => (current?.id === replacedId ? null : current));
    }
    const refreshed = await load();
    setHistoryPage(1);
    setHistoryRefresh((value) => value + 1);
    setCleanupPending(true);
    setMessage(
      refreshed
        ? 'File published. Checking byte cleanup…'
        : 'File published, but files could not be refreshed. Reload this record; byte cleanup is unverified.',
    );
    const deleted = await cleanupTerminalFiles();
    setMessage(
      refreshed
        ? `File published. ${cleanupStatus(deleted)}`
        : `File published, but files could not be refreshed. Reload this record. ${cleanupStatus(deleted)}`,
    );
  }

  function beginPicker(target: string) {
    if (busy) return;
    // A new picker intent must not reuse bytes if the native picker is cancelled.
    handleSelectedFile(null);
    if (fileInput.current) fileInput.current.value = '';
    setReplace(target);
    fileInput.current?.click();
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const safeName = validateSelectedFile(file, parentType);
      const replacement = replace
        ? cards.find((card) => card.id === replace && card.state === 'ready')
        : null;
      if (replace && !replacement)
        throw new Error(
          'The selected replacement is unavailable. Choose another ready file or add without replacing.',
        );
      const response = await fetch('/api/inventory-files/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentType,
          parentId,
          expectedRevision: collectionRevision,
          name: safeName,
          type: file.type,
          bytes: file.size,
          replaces: replacement?.id ?? null,
          expectedFileVersion: replacement?.version ?? null,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.message ?? 'A reservation could not be created.');
      const reservation = body.result as { id: string; path: string };
      if (
        !reservation ||
        typeof reservation.id !== 'string' ||
        typeof reservation.path !== 'string'
      )
        throw new Error('A reservation could not be confirmed.');
      const uploaded = await client.storage
        .from(bucket)
        .upload(reservation.path, file, {
          contentType: file.type,
          upsert: false,
        });
      if (uploaded.error) throw new Error('The file could not be uploaded.');
      // The immutable reservation now owns these bytes even if the next RPC
      // response is lost. The file picker must not offer a second upload.
      handleSelectedFile(null);
      if (fileInput.current) fileInput.current.value = '';
      const marked = await rpc('inventory_file_uploaded', {
        p_file_id: reservation.id,
      });
      if (marked.error)
        throw new Error('The uploaded file could not be confirmed.');
      await validate(
        reservation.id,
        replacement?.version ?? null,
        undefined,
        replacement?.id ?? null,
      );
    } catch (error) {
      const operationError =
        error instanceof Error
          ? error.message
          : 'Upload could not be confirmed.';
      const refreshed = await load();
      setMessage(
        `${operationError}${refreshed ? '' : ' Files could not be refreshed; reload this record.'}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function pendingAction(card: Card, action: 'validate' | 'cancel') {
    setBusy(true);
    setMessage('');
    try {
      if (action === 'validate') {
        if (card.state === 'reserved') {
          // Storage already received the original immutable object. A lost or
          // transient uploaded-confirmation response is recovered against
          // that reservation; never upload bytes to its path a second time.
          let confirmed = false;
          try {
            const marked = await rpc('inventory_file_uploaded', {
              p_file_id: card.id,
            });
            confirmed = !marked.error;
          } catch {
            // The response is ambiguous; only a fresh server state can prove
            // that confirmation committed.
          }
          const refreshed = await load();
          const current = refreshed?.files.find(
            (entry) => entry.id === card.id,
          );
          if (current?.state === 'uploaded' || current?.state === 'validated') {
            setMessage(
              'Uploaded bytes confirmed. Review this pending file before publishing.',
            );
            return;
          }
          throw new Error(
            confirmed
              ? 'Upload confirmation was sent but files could not be refreshed. Refresh this record before reviewing; do not upload the same file again.'
              : 'Uploaded bytes could not be confirmed. Retry confirmation or cancel this pending file; do not upload to its path again.',
          );
        }
        const originalReplacementVersion = card.reviewed_replaced_file_version;
        const readyReplacement = card.replaces_file_id
          ? cards.find(
              (ready) =>
                ready.id === card.replaces_file_id && ready.state === 'ready',
            )
          : null;
        if (
          card.replaces_file_id &&
          (!readyReplacement ||
            readyReplacement.version !== originalReplacementVersion)
        )
          throw new Error(
            'The reviewed replacement target changed or is no longer ready. Cancel this pending file and start a new upload after reviewing the current file.',
          );
        await validate(
          card.id,
          originalReplacementVersion,
          undefined,
          card.replaces_file_id,
        );
      } else {
        const { error } = await rpc('inventory_file_cancel', {
          p_file_id: card.id,
        });
        if (error) throw new Error('The pending file could not be cancelled.');
        invalidatedFiles.current.add(card.id);
        setCards((current) => current.filter((entry) => entry.id !== card.id));
        await load();
        setCleanupPending(true);
        setMessage('File cancelled. Checking byte cleanup…');
        const deleted = await cleanupTerminalFiles();
        setMessage(`File cancelled. ${cleanupStatus(deleted)}`);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'File action failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removal || removalLock.current || removal.phase === 'stale') return;
    const intent = removal;
    removalLock.current = true;
    setBusy(true);
    setRemoval({ ...intent, phase: 'sending' });
    setMessage('');
    try {
      const { error } = await rpc('inventory_file_remove', {
        p_file_id: intent.card.id,
        p_expected_revision: intent.revision,
        p_expected_file_version: intent.card.version,
        p_request_id: intent.requestId,
      });
      if (!mounted.current) return;
      if (error) {
        const rejections: Record<string, string> = {
          P1002: 'Files changed. Refresh and review them before removing.',
          P1010:
            'The reviewed file was removed or replaced. Refresh and review the current files before removing.',
          P1012:
            'The removal request was rejected as invalid. Refresh and review the files before starting a new removal.',
          P1009:
            'The removal request identity conflicts with another operation. Refresh and review the files before starting a new removal.',
        };
        const rejection = rejections[error.code ?? ''];
        // These explicit rejections cannot follow a matching committed receipt:
        // replay returns that receipt before target/version checks, while invalid
        // input and conflicting request identity cannot commit this command.
        if (rejection) {
          setRemoval({ ...intent, phase: 'stale' });
          setMessage(rejection);
        } else {
          setRemoval({ ...intent, phase: 'unknown' });
          setMessage(
            error.code === 'P1001' || error.code === '42501'
              ? 'Access to removal was denied. Restore authorized access and retry the same request; an earlier attempt may already have completed.'
              : 'Removal could not be confirmed. Retry the same removal request; it may already have completed.',
          );
        }
        return;
      }
      // Acknowledgement is permanent logical success. Refresh/cleanup cannot undo it.
      invalidatedFiles.current.add(intent.card.id);
      setCards((current) =>
        current.filter((entry) => entry.id !== intent.card.id),
      );
      setPreview((current) =>
        current?.id === intent.card.id ? null : current,
      );
      setRemoval(null);
      setHistoryPage(1);
      setHistoryRefresh((value) => value + 1);
      setCleanupPending(true);
      setMessage('File removed. Checking byte cleanup…');
      let refreshed: CardsEnvelope | null = null;
      try {
        refreshed = await load();
      } catch {
        /* Removal already committed. */
      }
      if (!mounted.current) return;
      const deleted = await cleanupTerminalFiles();
      if (!mounted.current) return;
      setMessage(
        `File removed.${refreshed ? '' : ' Files could not be refreshed; reload this record.'} ${cleanupStatus(deleted)}`,
      );
    } catch {
      if (mounted.current) {
        setRemoval({ ...intent, phase: 'unknown' });
        setMessage(
          'Removal could not be confirmed. Retry the same removal request; it may already have completed.',
        );
      }
    } finally {
      removalLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function refreshRemoval() {
    if (removalLock.current) return;
    removalLock.current = true;
    setBusy(true);
    try {
      const refreshed = await load();
      if (!mounted.current) return;
      if (refreshed) {
        setRemoval(null);
        setMessage(
          'Files refreshed. Review the current file and choose Remove again for a new confirmation.',
        );
      } else
        setMessage(
          'Files changed. Refresh failed; review is still required before removing.',
        );
    } catch {
      if (mounted.current)
        setMessage(
          'Files changed. Refresh failed; review is still required before removing.',
        );
    } finally {
      removalLock.current = false;
      if (mounted.current) setBusy(false);
    }
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
    <>
      <LoadingAnnouncement
        label={busy ? 'File request in progress…' : 'Loading files…'}
        active={busy || loading}
      />
      <section
        aria-label="Inventory files"
        aria-busy={busy || loading}
        className="experience-surface my-5 min-w-0 p-4"
      >
        <h2 className="text-xl font-semibold">
          {parentType === 'quantity'
            ? 'Recognition photo'
            : 'Photos and documents'}
        </h2>
        <p className="experience-muted mt-2 text-sm">
          {parentType === 'quantity'
            ? 'JPEG, PNG or still WebP · Up to 20 MiB. Photos are normalized before display.'
            : 'JPEG, PNG, still WebP or PDF · Up to 20 MiB. Photos are normalized before display; PDFs download as attachments.'}
        </p>
        {(message || readError) && !removal && (
          <p
            role="alert"
            className="experience-feedback mt-3 break-words text-amber-100"
          >
            {message && <span className="block">{message}</span>}
            {readError && (
              <span className="block">Files could not be loaded.</span>
            )}
          </p>
        )}
        <LoadingReveal busy={loading} reveal={!message && !readError}>
          <ul className="mt-3 space-y-2">
            {cards
              .toSorted(
                (a, b) =>
                  Number(b.state === 'ready') - Number(a.state === 'ready'),
              )
              .map((card) => (
                <li
                  key={card.id}
                  className="flex min-w-0 flex-col gap-3 rounded-lg border border-cyan-100/15 bg-slate-950/40 p-3 sm:flex-row sm:flex-wrap sm:items-center"
                >
                  <div className="flex min-w-0 items-start gap-3 sm:min-w-64 sm:flex-1">
                    <span className="w-16 shrink-0">
                      <FileThumb card={card} read={read} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium [overflow-wrap:anywhere]">
                        {card.name}
                      </p>
                      <span className="mt-1 inline-block rounded-full border border-cyan-200/20 px-2 py-0.5 text-xs text-cyan-100">
                        {fileState(card.state).label}
                      </span>
                      {fileState(card.state).detail && (
                        <p className="mt-2 text-sm text-amber-100">
                          {fileState(card.state).detail}
                        </p>
                      )}
                      <p className="break-words text-xs text-slate-400 [overflow-wrap:anywhere]">
                        Original: {card.filename}
                      </p>
                      <p className="text-xs leading-5 text-slate-400 [overflow-wrap:anywhere]">
                        {formatFileSize(card.bytes)} · {fileType(card.type)} ·{' '}
                        {card.uploader} ·{' '}
                        {card.ready_at ? 'Published: ' : 'Uploaded: '}
                        <OperationalTimestamp
                          value={card.ready_at ?? card.created_at}
                        />
                      </p>
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto sm:w-auto">
                    {card.state === 'ready' && (
                      <button
                        type="button"
                        className="min-h-11 text-cyan-300 underline"
                        onClick={() =>
                          void read(
                            card,
                            card.type === 'application/pdf'
                              ? 'source'
                              : 'display',
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
                        disabled={busy || Boolean(removal)}
                        className="min-h-11 text-cyan-300 underline disabled:opacity-50"
                        onClick={() => beginPicker(card.id)}
                      >
                        Replace
                      </button>
                    )}
                    {staff && card.state === 'ready' && (
                      <button
                        type="button"
                        disabled={busy || Boolean(removal)}
                        className="min-h-11 text-cyan-300 underline disabled:opacity-50"
                        onClick={() => void rename(card)}
                      >
                        Rename
                      </button>
                    )}
                    {staff && card.state === 'ready' && (
                      <button
                        type="button"
                        disabled={busy || Boolean(removal)}
                        className="ml-2 min-h-11 border-l border-amber-200/30 pl-4 text-amber-200 underline disabled:opacity-50"
                        onClick={(event) => {
                          if (busy || removal) return;
                          setMessage('');
                          removalTrigger.current = event.currentTarget;
                          setRemoval({
                            card: { ...card },
                            owner: parentName,
                            revision: collectionRevision,
                            requestId: crypto.randomUUID(),
                            phase: 'review',
                          });
                        }}
                      >
                        Remove
                      </button>
                    )}
                    {staff && pendingStates.has(card.state) && (
                      <>
                        <button
                          type="button"
                          disabled={busy || Boolean(removal)}
                          className="min-h-11 text-cyan-300 underline disabled:opacity-50"
                          onClick={() => void pendingAction(card, 'validate')}
                        >
                          {card.state === 'reserved'
                            ? 'Confirm uploaded bytes'
                            : 'Review and publish'}
                        </button>
                        <button
                          type="button"
                          disabled={busy || Boolean(removal)}
                          className="min-h-11 text-amber-200 underline disabled:opacity-50"
                          onClick={() => void pendingAction(card, 'cancel')}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
          </ul>
          {!busy && cards.length === 0 && !message && !readError && (
            <p className="experience-muted mt-3 rounded-lg border border-dashed border-cyan-100/20 px-3 py-2 text-sm">
              {parentType === 'quantity'
                ? 'No photo yet.'
                : 'No attachments yet.'}
            </p>
          )}
        </LoadingReveal>
        {staff && (
          <div className="mt-4 space-y-3 border-t border-cyan-100/15 pt-4">
            <div
              role="group"
              aria-label="Choose an inventory file"
              className="rounded-lg border-2 border-dashed border-cyan-100/30 bg-slate-950 p-4"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (busy || removal) return;
                if (event.dataTransfer.files.length !== 1) {
                  handleSelectedFile(null);
                  if (fileInput.current) fileInput.current.value = '';
                  setMessage('Choose one file at a time.');
                  return;
                }
                if (parentType === 'quantity')
                  setReplace(
                    cards.find((card) => card.state === 'ready')?.id ?? '',
                  );
                handleSelectedFile(event.dataTransfer.files[0]);
              }}
            >
              <label
                className="block text-sm font-medium"
                htmlFor="inventory-file"
              >
                Add{' '}
                {parentType === 'quantity'
                  ? 'recognition photo'
                  : 'photo or PDF'}
              </label>
              <input
                id="inventory-file"
                ref={fileInput}
                type="file"
                className="sr-only"
                tabIndex={-1}
                disabled={busy || Boolean(removal)}
                accept={
                  parentType === 'quantity'
                    ? 'image/jpeg,image/png,image/webp'
                    : 'image/jpeg,image/png,image/webp,application/pdf'
                }
                onChange={(event) =>
                  handleSelectedFile(event.target.files?.[0] ?? null)
                }
              />
              <p className="my-2 text-xs text-slate-300">
                Drop one file here, or browse your device. Nothing uploads until
                you choose Upload and review.
              </p>
              <button
                type="button"
                disabled={busy || Boolean(removal)}
                className="min-h-11 rounded border border-cyan-400 px-4 py-2 text-cyan-200 disabled:opacity-50"
                onClick={() =>
                  beginPicker(
                    parentType === 'quantity'
                      ? (cards.find((card) => card.state === 'ready')?.id ?? '')
                      : replace,
                  )
                }
              >
                Browse files
              </button>
              {file && (
                <div className="mt-3 space-y-2">
                  <p className="break-all text-sm">
                    Selected: {file.name} · {formatFileSize(file.size)}
                  </p>
                  {selectedPreview ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selectedPreview}
                        alt="Selected file preview"
                        className="max-h-40 max-w-full rounded object-contain"
                      />
                    </>
                  ) : (
                    <span className="inline-flex rounded border border-slate-600 px-3 py-2 text-xs">
                      {file.type === 'application/pdf'
                        ? 'PDF document · download after review'
                        : 'Photo preview unavailable'}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busy || Boolean(removal)}
                    className="min-h-11 text-cyan-200 underline"
                    onClick={() => {
                      handleSelectedFile(null);
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                  >
                    Clear selection
                  </button>
                </div>
              )}
            </div>
            {(cards.some((card) => card.state === 'ready') ||
              replaceUnavailable) && (
              <label className="block text-sm">
                Replace a ready file
                <select
                  className="experience-field mt-1 block min-h-11 w-full p-2"
                  value={replace}
                  onChange={(event) => setReplace(event.target.value)}
                >
                  <option value="">Add without replacing</option>
                  {replaceUnavailable && (
                    <option value={replace} disabled>
                      Previously selected replacement unavailable — choose again
                    </option>
                  )}
                  {cards
                    .filter((card) => card.state === 'ready')
                    .map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.name}
                      </option>
                    ))}
                </select>
                {replaceUnavailable && (
                  <span
                    role="alert"
                    className="mt-1 block text-sm text-amber-200"
                  >
                    The selected replacement is unavailable. Choose another
                    ready file or add without replacing.
                  </span>
                )}
              </label>
            )}
            <button
              type="button"
              disabled={!file || busy || replaceUnavailable}
              className="min-h-11 rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
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
        <details className="mt-4 border-t border-cyan-100/15 pt-3">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">
            File activity
            {history.length > 0 ? ` · ${history.length} shown` : ''}
            {cleanupPending ? ' · cleanup unconfirmed' : ''}
          </summary>
          {staff && (
            <button
              type="button"
              disabled={busy || Boolean(removal)}
              className="mt-2 min-h-11 text-cyan-300 underline disabled:opacity-50"
              onClick={() => {
                setBusy(true);
                void cleanupTerminalFiles()
                  .then((deleted) => setMessage(cleanupStatus(deleted)))
                  .finally(() => setBusy(false));
              }}
            >
              {cleanupPending ? 'Retry file cleanup' : 'Check file cleanup'}
            </button>
          )}
          {historyError ? (
            <p role="alert" className="mt-2 text-sm text-amber-100">
              File activity could not be loaded. Reload this record to try
              again.
            </p>
          ) : history.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">No file changes yet.</p>
          ) : (
            <ol className="mt-2 space-y-2">
              {history.map((event) => (
                <li key={event.id} className="text-sm text-slate-300">
                  <OperationalTimestamp value={event.created_at} /> ·{' '}
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
        </details>
        {removal && (
          <dialog
            ref={removalDialog}
            aria-labelledby="remove-file-title"
            aria-describedby="remove-file-effect"
            className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border border-amber-200/30 bg-slate-950 p-5 text-slate-100 backdrop:bg-slate-950/80"
            onCancel={(event) => {
              event.preventDefault();
              if (removal.phase === 'review' && !removalLock.current)
                setRemoval(null);
            }}
          >
            <h3
              id="remove-file-title"
              className="break-words text-xl font-semibold"
            >
              Remove {removal.card.name}?
            </h3>
            <p id="remove-file-effect" className="mt-3 break-words">
              Remove {removal.card.filename} from {removal.owner}. This{' '}
              {removal.card.type === 'application/pdf' ? 'document' : 'photo'}{' '}
              will become unavailable in this record. Stored bytes are cleaned
              up separately and may remain pending. Previously issued signed
              links may remain valid until their short expiry. This cannot be
              undone.
            </p>
            {removal.phase === 'unknown' && (
              <p role="status" className="mt-3">
                The outcome is unconfirmed. Retry uses the exact same file and
                request. Cancellation cannot undo a request that may have
                committed.
              </p>
            )}
            {removal.phase === 'stale' && (
              <p role="status" className="mt-3">
                This removal was not applied. Refresh and review the current
                files, then explicitly choose Remove again.
              </p>
            )}
            {message && (
              <p role="alert" className="mt-3 break-words text-amber-100">
                {message}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              {removal.phase === 'review' && (
                <button
                  type="button"
                  className="min-h-11 rounded-lg border px-4"
                  onClick={() => setRemoval(null)}
                >
                  Cancel
                </button>
              )}
              {removal.phase === 'stale' ? (
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-11 rounded-lg border px-4"
                  onClick={() => void refreshRemoval()}
                >
                  Refresh files
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  className="experience-danger-action disabled:opacity-50"
                  onClick={() => void remove()}
                >
                  {removal.phase === 'unknown'
                    ? 'Retry removal'
                    : removal.phase === 'sending'
                      ? 'Removing…'
                      : 'Remove file'}
                </button>
              )}
            </div>
          </dialog>
        )}
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
    </>
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
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  useEffect(() => {
    if (card.state !== 'ready' || card.type === 'application/pdf') return;
    let cancelled = false;
    let localUrl: string | null = null;
    const rpc = client.rpc.bind(client) as unknown as Rpc;
    void rpc('inventory_file_read', {
      p_file_id: card.id,
      p_variant: 'thumbnail',
    }).then(async ({ data, error }) => {
      if (error || typeof data !== 'string') {
        if (!cancelled) setThumbnailFailed(true);
        return;
      }
      const result = await client.storage.from(bucket).download(data);
      if (result.error || !result.data) {
        if (!cancelled) setThumbnailFailed(true);
        return;
      }
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
      <span className="flex h-16 w-16 items-center justify-center rounded-lg border border-cyan-100/20 bg-slate-950 px-2 text-center text-xs text-slate-300">
        {card.type === 'application/pdf' ? 'PDF' : 'Photo'}
      </span>
    );
  return (
    <button
      type="button"
      aria-label={'Preview ' + card.name}
      className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-cyan-100/20 bg-slate-950 text-xs text-cyan-200"
      onClick={() => void read(card, 'thumbnail', false)}
    >
      {url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="h-16 w-16 rounded object-cover" />
        </>
      ) : thumbnailFailed ? (
        'Preview unavailable'
      ) : (
        'Loading preview…'
      )}
    </button>
  );
}
