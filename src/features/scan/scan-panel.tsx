'use client';
import { useRouteRouter as useRouter } from '@/components/experience/route-pending';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import Link from '@/components/experience/route-link';

import type { IScannerControls } from '@zxing/browser';
import styles from './scan-visual.module.css';
import {
  resolveItemCode,
  resolveScan,
  type ScanResolution,
} from './resolve.server';

export function ScanPanel() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const consumed = useRef(false);
  const [camera, setCamera] = useState<'idle' | 'starting' | 'running'>('idle');
  const [cameraIssue, setCameraIssue] = useState(false);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'identifier' | 'item_code'>('identifier');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<ScanResolution | null>(null);
  const [busy, setBusy] = useState(false);

  const stop = useCallback(() => {
    generation.current++;
    controls.current?.stop();
    controls.current = null;
    if (
      typeof MediaStream !== 'undefined' &&
      video.current?.srcObject instanceof MediaStream
    ) {
      video.current.srcObject.getTracks().forEach((track) => track.stop());
      video.current.srcObject = null;
    }
    if (mounted.current) {
      setCamera('idle');
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, [stop]);

  const open = useCallback(
    async (
      text: string,
      lookupMode: 'identifier' | 'item_code' = 'identifier',
    ) => {
      if (consumed.current) return;
      consumed.current = true;
      stop();
      const token = generation.current;
      setBusy(true);
      setMessage('');
      try {
        const resolution =
          lookupMode === 'item_code'
            ? await resolveItemCode(text)
            : await resolveScan(text);
        if (!mounted.current || token !== generation.current) return;
        setResult(resolution);
        if (
          resolution.status === 'found' &&
          resolution.matches[0].state === 'active'
        ) {
          router.push(resolution.matches[0].path);
        } else if (resolution.status === 'invalid')
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
      } catch {
        if (mounted.current && token === generation.current)
          setMessage('Lookup could not be completed. Please try again.');
      } finally {
        if (mounted.current && token === generation.current) setBusy(false);
      }
    },
    [router, stop],
  );

  const start = async () => {
    stop();
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
      const running = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        video.current,
        (decoded) => {
          if (
            decoded &&
            mounted.current &&
            token === generation.current &&
            !consumed.current
          )
            void open(decoded.getText());
        },
      );
      if (!mounted.current || token !== generation.current) {
        running.stop();
        return;
      }
      controls.current = running;
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
      <div className={styles.columns}>
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
          <fieldset className={styles.fieldset}>
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
              Quantity Item code (SKU)
            </label>
          </fieldset>
          <label htmlFor="scan-text" className={styles.fieldLabel}>
            {mode === 'item_code'
              ? 'Enter the exact Item code (SKU)'
              : 'Paste a label URL, barcode text, or exact identifier'}
          </label>
          <input
            id="scan-text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={1024}
            className={styles.input}
          />
          <p className={styles.hint}>
            {mode === 'item_code'
              ? 'Use this mode for quantity codes beginning with / or containing a colon. Text that looks like a URL is matched only against stored Item codes.'
              : 'Locations use LOC:CODE; asset tags use AST:tag. Bare identifiers are checked for exact matches across locations, assets, and quantity items.'}
          </p>
          <div className={styles.submitRow}>
            <button disabled={busy} className={styles.primaryButton}>
              {busy ? 'Looking up…' : 'Open'}
            </button>
          </div>
        </form>
      </div>
      {message && (
        <p role="status" className={styles.message}>
          {message}
        </p>
      )}
      {result && result.matches.length > 0 && (
        <ul className={styles.results} aria-label="Matching records">
          {result.matches.map((match) => (
            <li key={match.path} className={styles.result}>
              <Link href={match.path} onClick={stop} className="underline">
                {match.label}
              </Link>
              <span className={styles.state}>{match.state}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
