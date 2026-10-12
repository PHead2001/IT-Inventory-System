'use client';
import { Component, type ReactNode } from 'react';
/** A renderer/chunk failure belongs to this optional region, never the form/page. */
export class RoomRegionBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed
      ? (this.props.fallback ?? (
          <p role="status" className="p-4 text-sm">
            Map unavailable. Use the recorded location or location browser.
          </p>
        ))
      : this.props.children;
  }
}
