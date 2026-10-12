'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { panel } from '@/features/inventory/components/read-ui';
import { assignmentEpoch } from './assign-batch';
import { createCameraSession } from './camera-session';

export function AssignCamera({
  onDetection,
  scope,
}: {
  onDetection: (value: string | null) => void;
  scope: string;
}) {
  return <CameraReader key={scope} onDetection={onDetection} />;
}
function CameraReader({
  onDetection,
}: {
  onDetection: (value: string | null) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<ReturnType<typeof createCameraSession> | null>(null);
  const generation = useRef(0);
  const scopeEpoch = useRef(assignmentEpoch());
  const invalidated = useRef(false);
  const mounted = useRef(true);
  const detection = useRef(onDetection);
  const [status, setStatus] = useState<'idle' | 'starting' | 'running'>('idle');
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  useLayoutEffect(() => {
    detection.current = onDetection;
  });
  const stop = useCallback(() => {
    generation.current++;
    session.current?.stop();
    session.current = null;
    if (mounted.current) setStatus('idle');
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      invalidated.current = true;
      stop();
      setBlocked(true);
      setMessage(
        'Your session changed. Reopen Scan before starting the camera.',
      );
    };
    window.addEventListener('assignment-scope-invalidated', invalidate);
    if (scopeEpoch.current !== assignmentEpoch()) invalidate();
    return () => {
      window.removeEventListener('assignment-scope-invalidated', invalidate);
      mounted.current = false;
      stop();
    };
  }, [stop]);
  const start = async () => {
    if (invalidated.current || scopeEpoch.current !== assignmentEpoch()) return;
    stop();
    // A late old decoder must only clean its own preview, never a new session.
    setPreviewKey((key) => key + 1);
    setMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(
        'Camera access is unavailable. Use a keyboard scanner, paste, or search below.',
      );
      return;
    }
    const token = generation.current;
    setStatus('starting');
    try {
      const { InventoryCodeReader } = await import('./inventory-code-reader');
      if (!mounted.current || token !== generation.current || !video.current)
        return;
      const reader = new InventoryCodeReader(undefined, {
        delayBetweenScanAttempts: 250,
      });
      const current = createCameraSession(reader, video.current, (decoded) => {
        if (
          mounted.current &&
          token === generation.current &&
          !invalidated.current &&
          scopeEpoch.current === assignmentEpoch()
        )
          detection.current(decoded?.getText() ?? null);
      });
      session.current = current;
      const running = await current.start();
      if (!running || !mounted.current || token !== generation.current) {
        current.stop();
        return;
      }
      setStatus('running');
    } catch (error) {
      if (!mounted.current || token !== generation.current) return;
      stop();
      setMessage(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow access or use manual lookup.'
          : 'The camera could not start. Retry or use manual lookup.',
      );
    }
  };
  return (
    <section aria-label="Assignment camera" className={panel + ' space-y-3'}>
      <h2 className="font-semibold">Scan an inventory label</h2>
      <p className="text-sm text-slate-300">
        The camera inspects equipment. Each assignment requires Confirm assign.
      </p>
      <video
        key={previewKey}
        ref={video}
        muted
        playsInline
        hidden={status === 'idle'}
        className="max-h-64 w-full rounded-lg"
        aria-label="Assignment camera preview"
      />
      {status === 'idle' ? (
        <Button
          type="button"
          variant="outline"
          disabled={blocked}
          onClick={() => void start()}
        >
          {message && !blocked ? 'Retry camera' : 'Start camera'}
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={stop}>
          Stop camera
        </Button>
      )}
      <p role="status" className="text-sm text-slate-300">
        {message ||
          (status === 'starting'
            ? 'Starting camera…'
            : status === 'running'
              ? 'Camera active. Hold a label in view; assignment requires confirmation.'
              : 'Camera starts only when you choose Start camera.')}
      </p>
    </section>
  );
}
