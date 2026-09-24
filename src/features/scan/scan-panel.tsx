'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { IScannerControls } from '@zxing/browser';
import { resolveScan, type ScanResolution } from './resolve.server';

export function ScanPanel() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const consumed = useRef(false);
  const [camera, setCamera] = useState<'idle' | 'starting' | 'running'>('idle');
  const [input, setInput] = useState('');
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
    async (text: string) => {
      if (consumed.current) return;
      consumed.current = true;
      stop();
      const token = generation.current;
      setBusy(true);
      setMessage('');
      try {
        const resolution = await resolveScan(text);
        if (!mounted.current || token !== generation.current) return;
        setResult(resolution);
        if (
          resolution.status === 'found' &&
          resolution.matches[0].state === 'active'
        ) {
          router.push(resolution.matches[0].path);
        } else if (resolution.status === 'invalid')
          setMessage('This is not a supported inventory label or identifier.');
        else if (resolution.status === 'unknown')
          setMessage('No matching location or asset was found.');
        else if (resolution.status === 'ambiguous')
          setMessage(
            'This identifier matches more than one record. Choose the intended record.',
          );
        else
          setMessage(
            'This record is inactive or retired. Review its state before opening.',
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
    consumed.current = false;
    setResult(null);
    setMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(
        'Camera access is unavailable in this browser. Enter the label text below.',
      );
      return;
    }
    const token = generation.current;
    setCamera('starting');
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      if (!mounted.current || token !== generation.current || !video.current)
        return;
      const reader = new BrowserMultiFormatReader(undefined, {
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
      void open(input);
    }
  };
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-700 p-4">
        <h2 className="text-xl font-semibold">Camera</h2>
        <p className="mt-2 text-sm text-slate-400">
          Point your camera at an inventory QR or Code 128 label. Scanning opens
          information only.
        </p>
        <video
          ref={video}
          muted
          playsInline
          aria-label="Camera preview"
          className={`mt-4 w-full max-w-lg rounded bg-black ${camera === 'idle' ? 'hidden' : ''}`}
        />
        <div className="mt-4 flex flex-wrap gap-3">
          {camera === 'idle' ? (
            <button
              type="button"
              onClick={() => void start()}
              className="rounded bg-cyan-400 px-4 py-2 font-semibold text-slate-950"
            >
              {message ? 'Retry camera' : 'Start camera'}
            </button>
          ) : (
            <button
              type="button"
              onClick={stop}
              className="rounded border border-slate-500 px-4 py-2"
            >
              Stop camera
            </button>
          )}
        </div>
      </div>
      <form
        onSubmit={submit}
        className="space-y-3 rounded-xl border border-slate-700 p-4"
      >
        <label htmlFor="scan-text" className="block font-semibold">
          Paste a label URL, barcode text, or exact identifier
        </label>
        <input
          id="scan-text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={1024}
          className="w-full rounded border border-slate-500 bg-slate-950 p-3"
        />
        <p className="text-sm text-slate-400">
          Locations use LOC:CODE; asset tags use AST:tag. Bare identifiers are
          checked for exact matches.
        </p>
        <button
          disabled={busy}
          className="rounded bg-cyan-400 px-4 py-2 font-semibold text-slate-950"
        >
          {busy ? 'Looking up…' : 'Open'}
        </button>
      </form>
      {message && (
        <p
          role="status"
          className="rounded border border-amber-700 p-3 text-amber-200"
        >
          {message}
        </p>
      )}
      {result && result.matches.length > 0 && (
        <ul className="space-y-2">
          {result.matches.map((match) => (
            <li
              key={match.path}
              className="rounded border border-slate-700 p-3"
            >
              <Link
                href={match.path}
                onClick={stop}
                className="text-cyan-300 underline"
              >
                {match.label}
              </Link>
              <span className="ml-3 text-sm capitalize text-slate-400">
                {match.state}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
