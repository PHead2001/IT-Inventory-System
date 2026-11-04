'use client';
import { useId, useSyncExternalStore } from 'react';
import type { EffectsQuality } from '@/features/room/scene/scene-effects-state';

const storageKey = 'it-inventory-room-effects';
const changeEvent = 'it-inventory-room-effects-change';
let volatilePreference: EffectsQuality | null = null;
function snapshot(): EffectsQuality {
  if (volatilePreference !== null) return volatilePreference;
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved === 'low' || saved === 'off' ? saved : 'standard';
  } catch {
    return 'standard';
  }
}
function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return;
    volatilePreference = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(changeEvent, listener);
  };
}
export function useRoomEffectsQuality() {
  return useSyncExternalStore(subscribe, snapshot, () => 'standard' as const);
}
export function RoomEffectsPreference() {
  const id = useId();
  const quality = useRoomEffectsQuality();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        Room appearance in this browser
      </label>
      <select
        id={id}
        value={quality}
        className="min-h-11 rounded-md border border-slate-600 bg-transparent px-3 text-base"
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          const next = event.target.value;
          if (next !== 'standard' && next !== 'low' && next !== 'off') return;
          volatilePreference = next;
          try {
            window.localStorage.setItem(storageKey, next);
            volatilePreference = null;
          } catch {
            /* This tab remains usable when storage is unavailable. */
          }
          window.dispatchEvent(new Event(changeEvent));
        }}
      >
        <option value="standard">Standard</option>
        <option value="low">Low</option>
        <option value="off">Off</option>
      </select>
      <p id={`${id}-help`} className="experience-muted text-sm">
        Standard adds selection glow and contact shadows. Low keeps shadows. Off
        removes both. Motion is controlled separately.
      </p>
    </div>
  );
}
