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
import { freshPresentationGrant } from '@/components/experience/presentation-privacy';
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
  const current = () =>
    !owner.retired() &&
    owner.key !== null &&
    owner.key === key &&
    owner.generation === privacy.generation &&
    owner.revision === readPrivacyRevocationRevision() &&
    owner.epoch === assignmentEpoch() &&
    (privacy.generation === 'unmanaged'
      ? privacy.ready
      : freshPresentationGrant(privacy));
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
  useLayoutEffect(() => {
    if (current()) onMounted?.();
    // Report only this original dialog's first authorized mount/recheck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMounted, privacy, key]);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useInsertionEffect(() => {
    const retire = () => {
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
  useEffect(() => {
    const element = dialog.current;
    if (!element || !current()) return;
    if (!element.open) element.showModal();
    return () => element.close();
    // The modal retains the original private session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privacy.ready, key, owner]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <dialog
      ref={dialog}
      hidden={!current()}
      inert={!current()}
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
        code={candidate}
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
      <div className="my-4">
        <LocationPicker
          locations={locations}
          mode="destination"
          label="Choose location in browser"
          mapEnabled={false}
          value={selected?.id ?? ''}
          excludeIds={excludeIds}
          disabled={disabled}
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
          disabled={disabled || !selected || !current()}
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
