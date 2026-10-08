'use client';
import { createRoot, events, extend } from '@react-three/fiber';
import {
  Color,
  Group,
  Mesh,
  BoxGeometry,
  PlaneGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  AmbientLight,
  DirectionalLight,
  LineSegments,
  LineBasicMaterial,
} from 'three';
// Public createRoot is deliberately catalogue-free; match Canvas's constructor registration.
extend({
  Color,
  Group,
  Mesh,
  BoxGeometry,
  PlaneGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  AmbientLight,
  DirectionalLight,
  LineSegments,
  LineBasicMaterial,
});
import { Component, useEffect, useRef, type ReactNode } from 'react';

type Configuration = NonNullable<
  Parameters<ReturnType<typeof createRoot>['configure']>[0]
>;
type Props = Configuration & {
  children: ReactNode;
  fallback?: ReactNode;
  onFailure(message: string): void;
};
export class GraphicsBoundary extends Component<
  { children: ReactNode; onFailure(message: string): void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure(
      'The room scene could not render. Use the location list or retry.',
    );
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
/**
 * Canvas's bundled async configure is not awaited by a React error boundary.
 * This host catches that actual renderer-initialization promise locally.
 */
export function SafeCanvas({
  children,
  fallback,
  onFailure,
  ...configuration
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const root = useRef<ReturnType<typeof createRoot> | null>(null);
  const ready = useRef(false);
  const latest = useRef({ children, configuration });
  useEffect(() => {
    latest.current = { children, configuration };
    if (ready.current)
      root.current?.render(
        <GraphicsBoundary onFailure={onFailure}>{children}</GraphicsBoundary>,
      );
  }, [children, configuration, onFailure]);
  useEffect(() => {
    const element = canvas.current,
      host = container.current;
    if (!element || !host) return;
    let disposed = false;
    let lastWidth = 0,
      lastHeight = 0;
    let queue = Promise.resolve();
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (
        disposed ||
        width <= 0 ||
        height <= 0 ||
        (width === lastWidth && height === lastHeight)
      )
        return;
      lastWidth = width;
      lastHeight = height;
      queue = queue.then(async () => {
        if (disposed) return;
        try {
          root.current ??= createRoot(element);
          await root.current.configure({
            ...latest.current.configuration,
            events,
            size: { width, height, top: 0, left: 0 },
            onCreated: (state) => {
              // Drei Html portals into events.connected, so connect the host, never the canvas fallback subtree.
              state.events.connect?.(host);
            },
          });
          if (disposed) return;
          ready.current = true;
          root.current.render(
            <GraphicsBoundary onFailure={onFailure}>
              {latest.current.children}
            </GraphicsBoundary>,
          );
        } catch {
          if (!disposed)
            onFailure(
              'The room renderer could not initialize. Use the location list or retry.',
            );
        }
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    // Deferral keeps StrictMode's provisional mount from allocating a graphics root.
    const frame = requestAnimationFrame(resize);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      ready.current = false;
      const current = root.current;
      root.current = null;
      void queue.finally(() => current?.unmount());
    };
  }, [onFailure]);
  return (
    <div
      ref={container}
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvas}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'auto',
        }}
      >
        {fallback}
      </canvas>
    </div>
  );
}
