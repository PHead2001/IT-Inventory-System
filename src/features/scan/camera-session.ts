import type { IScannerControls } from '@zxing/browser';
import type { InventoryCodeReader } from './inventory-code-reader';

export function createCameraSession(
  reader: Pick<InventoryCodeReader, 'decodeFromStream'>,
  preview: HTMLVideoElement,
  onDetection: Parameters<InventoryCodeReader['decodeFromStream']>[2],
) {
  let stopped = false;
  let stream: MediaStream | null = null;
  let controls: IScannerControls | null = null;
  const stop = () => {
    stopped = true;
    const running = controls;
    controls = null;
    try {
      running?.stop();
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      if (stream && preview.srcObject === stream) preview.srcObject = null;
      stream = null;
    }
  };
  const start = async () => {
    if (stopped) return false;
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (stopped) {
        acquired.getTracks().forEach((track) => track.stop());
        return false;
      }
      stream = acquired;
      // Own the tracks before decoder/video startup settles, so cancellation
      // can release capture immediately rather than waiting for scanner controls.
      const running = await reader.decodeFromStream(
        acquired,
        preview,
        (...args) => {
          if (!stopped) onDetection(...args);
        },
      );
      if (stopped) {
        running.stop();
        return false;
      }
      controls = running;
      return true;
    } catch (error) {
      stop();
      throw error;
    }
  };
  return { start, stop };
}
