'use client';
import { MagneticVisual } from '@/components/experience/magnetic-visual';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { panel } from '@/features/inventory/components/read-ui';
import { assignmentEpoch } from './assign-batch';
import { createCameraSession } from './camera-session';
import { useScanFeedback } from '@/components/experience/scan-feedback';
import { ScannerOverlay, useDecodedLock } from './scanner-overlay';
import { readDecoderGeometry, type DecoderGeometry } from './decoder-geometry';
import overlayStyles from './scanner-overlay.module.css';

// This grants outcomes for one camera generation, never activation or ownership.
export type CameraOutcome = (
  kind: 'no-match' | 'blocked',
  eventId: string,
) => boolean;
type Detection = (
  value: string | null,
  outcome: CameraOutcome,
) => boolean | void;

export function AssignCamera({
  onDetection,
  scope,
  inspecting = false,
  failed = false,
  searching = false,
}: {
  onDetection: Detection;
  scope: string;
  inspecting?: boolean;
  failed?: boolean;
  searching?: boolean;
}) {
  return (
    <CameraReader
      key={scope}
      onDetection={onDetection}
      inspecting={inspecting}
      failed={failed}
      searching={searching}
    />
  );
}
function CameraReader({
  onDetection,
  inspecting,
  failed,
  searching,
}: {
  onDetection: Detection;
  inspecting: boolean;
  failed: boolean;
  searching: boolean;
}) {
  const host = useRef<HTMLElement>(null);
  const feedback = useScanFeedback(host, 'assignment-camera');
  const { locked, begin: lockDecode, cancel: cancelLock } = useDecodedLock();
  const [geometry, setGeometry] = useState<DecoderGeometry | null>(null);
  const [decoded, setDecoded] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<ReturnType<typeof createCameraSession> | null>(null);
  const generation = useRef(0);
  const decodeSequence = useRef(0);
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
  const stop = useCallback(
    (cancelFeedback = true) => {
      if (cancelFeedback) feedback.stop();
      generation.current++;
      session.current?.stop();
      session.current = null;
      if (mounted.current) {
        setStatus('idle');
        cancelLock();
        setDecoded(false);
        setGeometry(null);
      }
    },
    [cancelLock, feedback],
  );
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
  const start = async (trusted: boolean) => {
    if (invalidated.current || scopeEpoch.current !== assignmentEpoch()) return;
    stop();
    feedback.prime(trusted);
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
      const currentGeneration = () =>
        mounted.current &&
        token === generation.current &&
        !invalidated.current &&
        scopeEpoch.current === assignmentEpoch() &&
        !document.hidden;
      const outcome: CameraOutcome = (kind, eventId) =>
        currentGeneration() && feedback(kind, eventId);
      const current = createCameraSession(reader, video.current, (decoded) => {
        if (currentGeneration()) {
          const accepted = detection.current(
            decoded?.getText() ?? null,
            outcome,
          );
          if (decoded && accepted === true) {
            if (
              feedback('decode', `decode:${token}:${++decodeSequence.current}`)
            ) {
              lockDecode();
              setDecoded(true);
              setGeometry(readDecoderGeometry(decoded, video.current!));
            }
          }
        }
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
      stop(false);
      feedback('blocked', `camera:${token}`);
      setMessage(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow access or use manual lookup.'
          : 'The camera could not start. Retry or use manual lookup.',
      );
    }
  };
  return (
    <section
      ref={host}
      data-scanner-active={status !== 'idle' ? 'true' : undefined}
      aria-label="Assignment camera"
      className={panel + ' space-y-3'}
    >
      <h2 className="font-semibold">Scan an inventory label</h2>
      <p className="text-sm text-slate-300">
        The camera inspects equipment. Each assignment requires Confirm assign.
      </p>
      <div className={overlayStyles.viewport} hidden={status === 'idle'}>
        <video
          key={previewKey}
          ref={video}
          muted
          playsInline
          hidden={status === 'idle'}
          className="max-h-64 w-full rounded-lg"
          aria-label="Assignment camera preview"
        />
        <ScannerOverlay
          key={previewKey}
          video={video}
          geometry={searching ? null : geometry}
          state={
            failed
              ? 'error'
              : searching
                ? 'searching'
                : locked
                  ? 'locked'
                  : inspecting
                    ? 'inspecting'
                    : decoded
                      ? 'resolved'
                      : 'searching'
          }
        />
      </div>
      {status === 'idle' ? (
        <Button
          type="button"
          variant="outline"
          disabled={blocked}
          onClick={(event) => void start(event.nativeEvent.isTrusted)}
          className="experience-magnetic"
          data-magnetic-face="outline"
        >
          <MagneticVisual>
            {message && !blocked ? 'Retry camera' : 'Start camera'}
          </MagneticVisual>
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            stop();
          }}
        >
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
