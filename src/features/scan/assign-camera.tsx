'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { Button } from '@/components/ui/button';
import { panel } from '@/features/inventory/components/read-ui';

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
  const controls = useRef<IScannerControls | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const detection = useRef(onDetection);
  const [status, setStatus] = useState<'idle' | 'starting' | 'running'>('idle');
  const [message, setMessage] = useState('');
  useLayoutEffect(() => {
    detection.current = onDetection;
  });
  const stop = useCallback(() => {
    generation.current++;
    controls.current?.stop();
    controls.current = null;
    const stream = video.current?.srcObject;
    if (typeof MediaStream !== 'undefined' && stream instanceof MediaStream)
      stream.getTracks().forEach((track) => track.stop());
    if (video.current) video.current.srcObject = null;
    if (mounted.current) setStatus('idle');
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, [stop]);
  const start = async () => {
    stop();
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
      const running = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        video.current,
        (decoded) => {
          if (mounted.current && token === generation.current)
            detection.current(decoded?.getText() ?? null);
        },
      );
      if (!mounted.current || token !== generation.current) {
        running.stop();
        return;
      }
      controls.current = running;
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
        ref={video}
        muted
        playsInline
        hidden={status === 'idle'}
        className="max-h-64 w-full rounded-lg"
        aria-label="Assignment camera preview"
      />
      {status === 'idle' ? (
        <Button type="button" variant="outline" onClick={() => void start()}>
          {message ? 'Retry camera' : 'Start camera'}
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
