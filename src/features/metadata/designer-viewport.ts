'use client';
import { useEffect, type RefObject } from 'react';

/** The wrapping toolbar owns its sticky offset; derive clearance from its layout. */
export function useDesignerViewport(
  toolbar: RefObject<HTMLElement | null>,
  panes: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const bar = toolbar.current;
    const workspace = panes.current;
    if (!enabled || !bar || !workspace) return;
    let current = true;
    const measure = () => {
      if (!current) return;
      const style = getComputedStyle(bar);
      // This CSS marker and top retain the natural sticky configuration even
      // when the flow fallback overrides position, avoiding observer oscillation.
      const sticky =
        style.getPropertyValue('--designer-toolbar-sticky').trim() === '1';
      const top = sticky ? Math.max(0, Number.parseFloat(style.top) || 0) : 0;
      const clearance = sticky
        ? top + bar.getBoundingClientRect().height + 16
        : 16;
      const flow = window.innerHeight - clearance - 16 < 240;
      for (const element of [bar, workspace]) {
        if (flow) element.dataset.designerFlow = 'true';
        else element.removeAttribute('data-designer-flow');
      }
      workspace.style.setProperty(
        '--designer-inspector-top',
        `${flow ? 16 : clearance}px`,
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    observer?.observe(bar);
    window.addEventListener('resize', measure);
    document.fonts?.addEventListener('loadingdone', measure);
    void document.fonts?.ready.then(measure);
    return () => {
      current = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      document.fonts?.removeEventListener('loadingdone', measure);
      bar.removeAttribute('data-designer-flow');
      workspace.removeAttribute('data-designer-flow');
    };
  }, [toolbar, panes, enabled]);
}
