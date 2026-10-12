'use client';
import { useRouteRouter as useRouter } from '@/components/experience/route-pending';
import { ScanMatchLabel } from './scan-match-label';
import { RecordStatus } from '@/components/record-status';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import Link from '@/components/experience/route-link';

import styles from './scan-visual.module.css';
import { assignmentEpoch } from './assign-batch';
import { createCameraSession } from './camera-session';
import {
  resolveItemCode,
  resolveScan,
  type ScanResolution,
} from './resolve.server';

export function ScanPanel() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<ReturnType<typeof createCameraSession> | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const consumed = useRef(false);
  const scopeEpoch = useRef(assignmentEpoch());
  const scopeInvalidated = useRef(false);
  const inputControl = useRef<HTMLInputElement>(null);
  const cancelControl = useRef<HTMLButtonElement>(null);
  const firstMatch = useRef<HTMLAnchorElement>(null);
  const completionFocus = useRef<'input' | 'match' | null>(null);
  const [camera, setCamera] = useState<'idle' | 'starting' | 'running'>('idle');
  const [cameraIssue, setCameraIssue] = useState(false);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'identifier' | 'item_code'>('identifier');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<ScanResolution | null>(null);
  const [busy, setBusy] = useState(false);
  const [scopeBlocked, setScopeBlocked] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const stop = useCallback(() => {
    generation.current++;
    session.current?.stop();
    session.current = null;
    if (mounted.current) {
      setCamera('idle');
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      scopeInvalidated.current = true;
      setScopeBlocked(true);
      completionFocus.current = null;
      stop();
      setInput('');
      setResult(null);
      setMessage(
        'Your account changed. Reload Scan before looking up equipment.',
      );
    };
    window.addEventListener('assignment-scope-invalidated', invalidate);
    // An earlier shell sibling can invalidate after render but before this effect.
    if (scopeEpoch.current !== assignmentEpoch()) invalidate();
    return () => {
      window.removeEventListener('assignment-scope-invalidated', invalidate);
      mounted.current = false;
      stop();
    };
  }, [stop]);
  useEffect(() => {
    if (busy) cancelControl.current?.focus();
    else if (completionFocus.current) {
      if (completionFocus.current === 'match') firstMatch.current?.focus();
      else inputControl.current?.focus();
      completionFocus.current = null;
    }
  }, [busy, result]);

  const open = useCallback(
    async (
      text: string,
      lookupMode: 'identifier' | 'item_code' = 'identifier',
    ) => {
      if (
        consumed.current ||
        scopeInvalidated.current ||
        scopeEpoch.current !== assignmentEpoch()
      )
        return;
      consumed.current = true;
      completionFocus.current = null;
      stop();
      const token = generation.current;
      setBusy(true);
      setMessage('');
      setResult(null);
      try {
        const resolution =
          lookupMode === 'item_code'
            ? await resolveItemCode(text)
            : await resolveScan(text);
        if (
          !mounted.current ||
          token !== generation.current ||
          scopeEpoch.current !== assignmentEpoch()
        )
          return;
        setResult(resolution);
        if (
          resolution.status === 'found' &&
          resolution.matches[0].state === 'active'
        ) {
          setMessage(
            `Opening ${resolution.matches[0].label || 'the matching record'}…`,
          );
          router.push(resolution.matches[0].path);
        } else {
          completionFocus.current = resolution.matches.length
            ? 'match'
            : 'input';
          if (resolution.status === 'invalid')
            setMessage(
              lookupMode === 'item_code'
                ? 'Enter an Item code (SKU) with at most 100 characters and no control characters.'
                : 'This is not a supported inventory label or identifier.',
            );
          else if (resolution.status === 'unknown')
            setMessage(
              lookupMode === 'item_code'
                ? 'No quantity item has that exact Item code (SKU).'
                : 'No matching location, asset, or quantity item was found.',
            );
          else if (resolution.status === 'ambiguous')
            setMessage(
              'This identifier matches more than one record. Choose the intended record.',
            );
          else
            setMessage(
              'This record is inactive, retired, or archived. Review its state before opening.',
            );
        }
      } catch {
        if (
          mounted.current &&
          token === generation.current &&
          scopeEpoch.current === assignmentEpoch()
        ) {
          completionFocus.current = 'input';
          setMessage('Lookup could not be completed. Please try again.');
        }
      } finally {
        if (
          mounted.current &&
          token === generation.current &&
          scopeEpoch.current === assignmentEpoch()
        )
          setBusy(false);
      }
    },
    [router, stop],
  );

  const start = async () => {
    if (scopeInvalidated.current || scopeEpoch.current !== assignmentEpoch())
      return;
    completionFocus.current = null;
    stop();
    setPreviewKey((key) => key + 1);
    setCameraIssue(false);
    consumed.current = false;
    setResult(null);
    setMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraIssue(true);
      setMessage(
        'Camera access is unavailable in this browser. Enter the label text below.',
      );
      return;
    }
    const token = generation.current;
    setCamera('starting');
    try {
      const { InventoryCodeReader } = await import('./inventory-code-reader');
      if (!mounted.current || token !== generation.current || !video.current)
        return;
      const reader = new InventoryCodeReader(undefined, {
        delayBetweenScanAttempts: 250,
      });
      const current = createCameraSession(reader, video.current, (decoded) => {
        if (
          decoded &&
          mounted.current &&
          token === generation.current &&
          !consumed.current
        )
          void open(decoded.getText());
      });
      session.current = current;
      const running = await current.start();
      if (!running || !mounted.current || token !== generation.current) {
        current.stop();
        return;
      }
      setCamera('running');
    } catch (error) {
      if (!mounted.current || token !== generation.current) return;
      stop();
      setCameraIssue(true);
      setMessage(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow it in your browser settings or enter a label below.'
          : 'The camera could not be started. Check that it is available, then retry or enter a label below.',
      );
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) {
      consumed.current = false;
      void open(input, mode);
    }
  };
  return (
    <div className={styles.workspace}>
      <section
        className={styles.columns}
        aria-label="Equipment inspection"
        aria-busy={busy}
      >
        <section
          className={`${styles.card} ${styles.cameraCard}`}
          aria-label="Camera scanner"
        >
          <p className={styles.eyebrow}>01 / Scan a label</p>
          <h2 className={styles.title}>Camera scanner</h2>
          <p className={styles.description}>
            Point your camera at an inventory QR or Code 128 label. Scanning
            opens information only.
          </p>
          <video
            key={previewKey}
            ref={video}
            muted
            playsInline
            aria-label="Camera preview"
            hidden={camera === 'idle'}
            className={styles.preview}
          />
          <div className={styles.cameraActions}>
            {camera === 'idle' ? (
              <button
                type="button"
                disabled={scopeBlocked}
                onClick={() => void start()}
                className={styles.primaryButton}
              >
                {cameraIssue ? 'Retry camera' : 'Start camera'}
              </button>
            ) : (
              <button
                type="button"
                onClick={stop}
                className={styles.secondaryButton}
              >
                Stop camera
              </button>
            )}
          </div>
          {camera === 'starting' && (
            <p role="status" className={styles.hint}>
              Starting camera…
            </p>
          )}
          {camera === 'running' && (
            <p role="status" className={styles.hint}>
              Camera active. Hold a label in view, or stop and enter its code
              manually.
            </p>
          )}
          <p className={styles.hint}>
            Camera access starts only when you choose Start camera.
          </p>
        </section>
        <form onSubmit={submit} className={styles.card}>
          <p className={styles.eyebrow}>02 / Enter manually</p>
          <h2 className={styles.title}>Manual lookup</h2>
          <p className={styles.description}>
            Use this when a camera is unavailable or a label will not scan.
          </p>
          <fieldset className={styles.fieldset} disabled={scopeBlocked}>
            <legend className={styles.legend}>Look up as</legend>
            <label className={styles.radioChoice}>
              <input
                type="radio"
                name="scan-mode"
                checked={mode === 'identifier'}
                onChange={() => {
                  stop();
                  consumed.current = false;
                  setResult(null);
                  setMessage('');
                  setMode('identifier');
                }}
              />
              Label or identifier
            </label>
            <label className={styles.radioChoice}>
              <input
                type="radio"
                name="scan-mode"
                checked={mode === 'item_code'}
                onChange={() => {
                  stop();
                  consumed.current = false;
                  setResult(null);
                  setMessage('');
                  setMode('item_code');
                }}
              />
              Quantity item code (SKU)
            </label>
          </fieldset>
          <label htmlFor="scan-text" className={styles.fieldLabel}>
            {mode === 'item_code'
              ? 'Enter the exact Item code (SKU)'
              : 'Paste a label URL, barcode text, or exact identifier'}
          </label>
          <input
            ref={inputControl}
            disabled={scopeBlocked}
            id="scan-text"
            value={input}
            onChange={(event) => {
              completionFocus.current = null;
              stop();
              consumed.current = false;
              setResult(null);
              setMessage('');
              setInput(event.target.value);
            }}
            maxLength={1024}
            className={styles.input + ' experience-code'}
          />
          <p className={styles.hint}>
            {mode === 'item_code'
              ? 'Use this mode for quantity codes beginning with / or containing a colon. Text that looks like a URL is matched only against stored Item codes.'
              : 'Locations use LOC:CODE; asset tags use AST:tag. Bare identifiers are checked for exact matches across locations, assets, and quantity items.'}
          </p>
          <div className={styles.submitRow}>
            <button
              disabled={busy || scopeBlocked}
              className={styles.primaryButton}
            >
              {busy ? 'Inspecting equipment…' : 'Open'}
            </button>
          </div>
        </form>
      </section>
      <p role="status" className={busy || message ? styles.message : 'sr-only'}>
        {busy ? 'Inspecting equipment…' : message}
      </p>
      {busy && (
        <button
          ref={cancelControl}
          type="button"
          className={styles.secondaryButton}
          onClick={() => {
            completionFocus.current = null;
            stop();
            consumed.current = false;
            setResult(null);
            setMessage('Inspection cancelled. Enter or scan another code.');
            inputControl.current?.focus();
          }}
        >
          Cancel inspection
        </button>
      )}
      {result && result.matches.length > 0 && (
        <ul className={styles.results} aria-label="Matching records">
          {result.matches.map((match, index) => (
            <li key={match.path} className={styles.result}>
              <Link
                ref={index === 0 ? firstMatch : undefined}
                href={match.path}
                onClick={stop}
                className="underline"
              >
                <ScanMatchLabel match={match} />
              </Link>
              <span className={styles.state}>
                <RecordStatus status={match.state} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
