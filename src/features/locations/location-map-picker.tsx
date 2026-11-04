'use client';
import {
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import {
  freshPresentationGrant,
  retainedPresentationGrantCurrent,
} from '@/components/experience/presentation-privacy';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  subscribeAssignmentInvalidation,
  subscribePrivacyRevocation,
  subscribeAuthoritativeCleanup,
} from '@/features/scan/assign-batch';
import { useRoomSceneAuthority } from '../room/scene/camera-snapshot-provider';
import { cameraAuthorityKey } from '../room/scene/camera-snapshot-store';
import { EmbeddedRoom } from '../room/embedded-room';
import { containingSpace, spaceRoom } from '../room/spaces';
import { buildRoomBindings } from '../room/bindings';
import { LocationPicker } from './location-picker';
import { pickerLocations } from './picker-model';
import type { LocationRef } from '../inventory/contracts-ui';

export default function LocationMapPicker({
  locations,
  excludeIds,
  disabled,
  initialValue,
  onUse,
  onClose,
  onMounted,
}: {
  locations: LocationRef[];
  excludeIds?: string[];
  disabled: boolean;
  initialValue: string;
  onUse(code: string): void;
  onClose(): void;
  onMounted?(): void;
}) {
  const privacy = usePrivacyReadiness();
  const authority = useRoomSceneAuthority();
  const key = authority
    ? cameraAuthorityKey(authority)
    : privacy.generation === 'unmanaged'
      ? 'unmanaged'
      : null;
  const [owner] = useState(() => {
    let retired = false;
    return {
      key,
      generation: privacy.generation,
      revision: readPrivacyRevocationRevision(),
      epoch: assignmentEpoch(),
      retired: () => retired,
      retire: () => {
        retired = true;
      },
    };
  });
  const [mounted, setMounted] = useState(false);
  const reportedMount = useRef(false);
  const latest = useRef({ privacy, key });
  useLayoutEffect(() => {
    latest.current = { privacy, key };
  }, [privacy, key]);
  const bindingCurrent = (candidate: {
    privacy: typeof privacy;
    key: typeof key;
  }) =>
    !owner.retired() &&
    owner.key !== null &&
    owner.key === candidate.key &&
    owner.generation === candidate.privacy.generation &&
    owner.revision === readPrivacyRevocationRevision() &&
    owner.epoch === assignmentEpoch();
  const freshFor = (candidate: { privacy: typeof privacy; key: typeof key }) =>
    bindingCurrent(candidate) &&
    (candidate.privacy.generation === 'unmanaged'
      ? candidate.privacy.ready
      : freshPresentationGrant(candidate.privacy));
  const current = () => freshFor(latest.current);
  const fresh = freshFor({ privacy, key });
  const visible =
    bindingCurrent({ privacy, key }) &&
    (privacy.generation === 'unmanaged'
      ? privacy.ready
      : fresh || (mounted && retainedPresentationGrantCurrent(privacy, owner)));
  const [candidate, setCandidate] = useState(
    () =>
      locations.find((location) => location.id === initialValue)?.code ?? null,
  );
  const eligible = pickerLocations(locations, 'destination', { excludeIds });
  const selected = eligible.find((location) => location.code === candidate);
  const modeled = eligible.filter((location) => {
    const space = containingSpace(locations, location.code);
    const room = space && spaceRoom(space);
    return (
      room &&
      buildRoomBindings(room).some((binding) => binding.code === location.code)
    );
  });
  const candidateIsModeled = modeled.some(
    (location) => location.code === candidate,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const closeDialog = () => {
    owner.retire();
    if (dialog.current) {
      dialog.current.hidden = true;
      dialog.current.inert = true;
      dialog.current.setAttribute('inert', '');
      dialog.current.close();
    }
  };
  const dismiss = () => {
    closeDialog();
    closeRef.current();
  };
  useLayoutEffect(() => {
    if (
      !owner.retired() &&
      (owner.key !== key || owner.generation !== privacy.generation)
    ) {
      owner.retire();
      if (dialog.current) {
        dialog.current.hidden = true;
        dialog.current.inert = true;
        dialog.current.setAttribute('inert', '');
        dialog.current.close();
      }
      closeRef.current();
    }
  }, [owner, key, privacy.generation]);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useInsertionEffect(() => {
    const retire = () => {
      if (owner.retired()) return;
      owner.retire();
      if (dialog.current) {
        dialog.current.hidden = true;
        dialog.current.inert = true;
        dialog.current.setAttribute('inert', '');
        dialog.current.close();
      }
      closeRef.current();
    };
    const remove = [
      subscribePrivacyRevocation(retire),
      subscribeAssignmentInvalidation(retire),
      subscribeAuthoritativeCleanup(retire),
    ];
    return () => remove.forEach((unsubscribe) => unsubscribe());
  }, [owner]);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!visible) {
      element.close();
      return;
    }
    if (!element.open && current()) element.showModal();
    if (element.open && !reportedMount.current && current()) {
      reportedMount.current = true;
      setMounted(true);
      onMounted?.();
    }
    // Initial opening and focus handoff require a fresh grant. An ordinary
    // visible recheck keeps this same native dialog and its camera/draft owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privacy, key, owner, onMounted, visible, mounted]);
  useEffect(() => {
    const element = dialog.current;
    return () => element?.close();
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <dialog
      ref={dialog}
      hidden={!visible}
      inert={!visible}
      aria-label="Pick a storage location"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      className="max-h-[90dvh] w-[min(60rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-slate-600 bg-slate-950 p-4 text-slate-100 backdrop:bg-black/60"
    >
      <h2 className="text-lg font-semibold">Pick a storage location</h2>
      <p className="my-3 text-sm text-slate-400">
        Choose a location, then use it in your form. Your task stays open.
      </p>
      <EmbeddedRoom
        locations={locations}
        // An overview offers eligible modeled alternatives without inventing a
        // selected binding or changing the staged logical destination.
        code={candidateIsModeled || modeled.length === 0 ? candidate : null}
        permittedCodes={modeled.map((location) => location.code)}
        onSelect={(code) => {
          if (
            current() &&
            !disabled &&
            eligible.some((location) => location.code === code)
          )
            setCandidate(code);
        }}
        selectionAllowed={() => current() && !disabled}
        priority={2}
      />
      {selected && !candidateIsModeled && modeled.length > 0 && (
        <p role="status" className="my-3 text-sm">
          This location is not shown on the map. You can keep it or choose a
          modeled location.
        </p>
      )}
      <div className="my-4">
        <LocationPicker
          locations={locations}
          mode="destination"
          label="Choose location in browser"
          mapEnabled={false}
          value={selected?.id ?? ''}
          excludeIds={excludeIds}
          disabled={disabled || !fresh}
          onValueChange={(id) => {
            if (current() && !disabled)
              setCandidate(
                eligible.find((location) => location.id === id)?.code ?? null,
              );
          }}
        />
      </div>
      <p role="status" className="my-3 text-sm">
        {selected
          ? selected.breadcrumb
          : candidate
            ? 'This location is unavailable. Choose another location.'
            : 'Choose a location in the map or browser.'}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="min-h-11 rounded-md border border-cyan-400 px-4 disabled:opacity-50"
          disabled={disabled || !selected || !fresh}
          onClick={() => {
            if (selected && current() && !disabled) {
              const code = selected.code;
              // Release native modal inertness before the form restores focus.
              closeDialog();
              onUse(code);
            }
          }}
        >
          Use location
        </button>
        <button
          type="button"
          className="min-h-11 rounded-md border border-slate-600 px-4"
          onClick={dismiss}
        >
          Cancel
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
