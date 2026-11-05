'use client';

import {
  createContext,
  useCallback,
  useContext,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { useStrictPresentation } from './strict-presentation';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import {
  createRoomObstructionOwner,
  type RoomObstructionRegistration,
} from './room-obstructions';
import { observeRouteSnapshotWithdrawal } from './route-motion-state';
import { SpringPresence } from './spring-presence';
import {
  confirmationText,
  createTransientFeedback,
  type FeedbackConfirmation,
  type FeedbackTicket,
  type FeedbackNotice,
} from './transient-feedback-state';

function createFeedbackPresentation() {
  const feedback = createTransientFeedback(() => false);
  const owners = new Map<
    Document,
    ReturnType<typeof createRoomObstructionOwner>
  >();
  return {
    ...feedback,
    registerObstruction(element: HTMLElement) {
      if (!feedback.admitted()) return { change() {}, dispose() {} };
      let owner = owners.get(element.ownerDocument);
      if (!owner) {
        owner = createRoomObstructionOwner(element.ownerDocument);
        owners.set(element.ownerDocument, owner);
      }
      return owner.register(element);
    },
    withdraw(notifyRender = true) {
      owners.forEach((owner) => owner.retire());
      owners.clear();
      feedback.withdraw(notifyRender);
    },
  };
}
type FeedbackPresentation = ReturnType<typeof createFeedbackPresentation>;
const FeedbackContext = createContext<FeedbackPresentation | null>(null);
const empty: FeedbackNotice[] = [];

export function TransientFeedbackProvider({
  actorId,
  backend,
  children,
}: {
  actorId: string;
  backend: string;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [feedback] = useState(createFeedbackPresentation);
  const insertion = useRef(false);
  useInsertionEffect(() => {
    insertion.current = true;
  });
  useLayoutEffect(() => {
    insertion.current = false;
    feedback.flushRender();
  });
  const withdraw = useCallback(() => {
    if (viewport.current) {
      viewport.current.hidden = true;
      viewport.current.setAttribute('inert', '');
      viewport.current.querySelectorAll('[role="status"]').forEach((node) => {
        node.textContent = '';
      });
    }
    feedback.withdraw(!insertion.current);
  }, [feedback]);
  const current = useStrictPresentation(
    host,
    JSON.stringify([actorId, backend]),
    withdraw,
    () => {
      if (viewport.current && feedback.admitted()) {
        viewport.current.hidden = false;
        viewport.current.removeAttribute('inert');
      }
    },
  );
  useLayoutEffect(() => {
    feedback.configureCurrent(current);
  }, [current, feedback]);
  useLayoutEffect(() => observeRouteSnapshotWithdrawal(withdraw), [withdraw]);
  const notices = useSyncExternalStore(
    feedback.subscribeRender,
    feedback.snapshot,
    () => empty,
  );
  useLayoutEffect(
    () =>
      feedback.subscribe(() => {
        const all = new Map(
          feedback.snapshot().map((notice) => [String(notice.id), notice]),
        );
        viewport.current
          ?.querySelectorAll<HTMLElement>('[data-feedback-card]')
          .forEach((card) => {
            const notice = all.get(card.dataset.feedbackCard!);
            if (notice?.open) return;
            card.setAttribute('inert', '');
            card.setAttribute('aria-hidden', 'true');
            card.querySelectorAll('[role="status"]').forEach((status) => {
              status.removeAttribute('role');
              status.setAttribute('aria-live', 'off');
              if (!notice) status.textContent = '';
            });
            if (!notice) card.hidden = true;
          });
      }),
    [feedback],
  );
  return (
    <FeedbackContext value={feedback}>
      <div ref={host} className="contents">
        {children}
        <div
          ref={viewport}
          aria-label="Confirmations"
          data-transient-feedback
          className="pointer-events-none fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-[max(1rem,env(safe-area-inset-right))] sm:w-80"
        >
          {notices.map((notice) => (
            <FeedbackCard key={notice.id} notice={notice} feedback={feedback} />
          ))}
        </div>
      </div>
    </FeedbackContext>
  );
}

function createFeedbackObstructionConnection(
  feedback: FeedbackPresentation,
  element: RefObject<HTMLDivElement | null>,
) {
  let registration: RoomObstructionRegistration | null = null;
  return {
    snapshot: () => registration,
    subscribe(changed: () => void) {
      if (!element.current) return () => {};
      const current = feedback.registerObstruction(element.current);
      registration = current;
      changed();
      return () => {
        current.dispose();
        if (registration === current) registration = null;
      };
    },
  };
}
function useFeedbackObstruction(
  feedback: FeedbackPresentation,
  element: RefObject<HTMLDivElement | null>,
) {
  const connection = useMemo(
    () => createFeedbackObstructionConnection(feedback, element),
    [feedback, element],
  );
  return useSyncExternalStore(
    connection.subscribe,
    connection.snapshot,
    () => null,
  )?.change;
}

function FeedbackCard({
  notice,
  feedback,
}: {
  notice: FeedbackNotice;
  feedback: FeedbackPresentation;
}) {
  const element = useRef<HTMLDivElement>(null);
  const obstructionChanged = useFeedbackObstruction(feedback, element);
  const stopPresentation = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    obstructionChanged?.();
  }, [obstructionChanged, notice.open]);
  const returnFocus = useRef(document.activeElement);
  const dismiss = useCallback(() => {
    const card = element.current;
    const ownerDocument = card?.ownerDocument;
    if (card && ownerDocument && card.contains(ownerDocument.activeElement)) {
      const target = returnFocus.current;
      const eligible =
        target instanceof HTMLElement &&
        target.isConnected &&
        !target.matches(':disabled, [aria-disabled="true"]') &&
        !target.closest('[hidden], [inert], [aria-hidden="true"]');
      if (eligible) target.focus({ preventScroll: true });
      // A connected target can have become disabled or otherwise unfocusable
      // while the operation completed. Verify native focus before retiring the
      // focused toast, and use the existing public main-content fallback.
      if (!eligible || ownerDocument.activeElement !== target) {
        const main = ownerDocument.getElementById('main-content');
        if (
          main?.isConnected &&
          !main.closest('[hidden], [inert], [aria-hidden="true"]')
        )
          main.focus({ preventScroll: true });
      }
    }
    feedback.dismiss(notice.id);
  }, [feedback, notice.id]);
  const remove = useCallback(
    () => feedback.remove(notice.id),
    [feedback, notice.id],
  );
  const remaining = useRef(5000);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const started = useRef(0);
  const paused = useRef({ hover: false, focus: false });
  const stop = useCallback(() => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    remaining.current = Math.max(
      0,
      remaining.current - (performance.now() - started.current),
    );
  }, []);
  const resume = useCallback(() => {
    if (
      timer.current !== undefined ||
      !notice.open ||
      !feedback.admitted() ||
      !feedback
        .snapshot()
        .some((value) => value.id === notice.id && value.open) ||
      paused.current.hover ||
      paused.current.focus
    )
      return;
    started.current = performance.now();
    timer.current = setTimeout(() => {
      timer.current = undefined;
      dismiss();
    }, remaining.current);
  }, [dismiss, feedback, notice.id, notice.open]);
  useLayoutEffect(() => {
    if (notice.open) resume();
    else stop();
    return stop;
  }, [resume, stop, notice.open]);
  useLayoutEffect(
    () =>
      feedback.subscribe(() => {
        const retained = feedback
          .snapshot()
          .find((value) => value.id === notice.id);
        if (!retained?.open) stop();
        if (!retained) stopPresentation.current?.();
      }),
    [feedback, notice.id, stop],
  );
  return (
    <SpringPresence
      open={notice.open}
      instanceKey={String(notice.id)}
      kind="toast"
      retainExit
      onExitComplete={remove}
      stopPresentationRef={stopPresentation}
      onPresentationChange={obstructionChanged}
    >
      <div
        ref={element}
        data-feedback-card={notice.id}
        data-global-room-obstruction="true"
        className="experience-surface pointer-events-auto flex items-center justify-between gap-3 p-3 shadow-xl"
        onPointerEnter={() => {
          paused.current.hover = true;
          stop();
        }}
        onPointerLeave={() => {
          paused.current.hover = false;
          resume();
        }}
        onFocusCapture={() => {
          paused.current.focus = true;
          stop();
        }}
        onBlurCapture={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
            return;
          paused.current.focus = false;
          resume();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }}
      >
        <span
          role={notice.open ? 'status' : undefined}
          aria-live={notice.open ? 'polite' : 'off'}
          aria-atomic="true"
          className="text-sm"
        >
          {confirmationText(notice.confirmation)}
        </span>
        <button
          type="button"
          disabled={!notice.open}
          tabIndex={notice.open ? undefined : -1}
          className="min-h-11 min-w-11 rounded px-2 text-sm focus-visible:outline-2 focus-visible:outline-cyan-300"
          onClick={dismiss}
        >
          Dismiss
        </button>
      </div>
    </SpringPresence>
  );
}

/** Capture before a user command, retain for the same retry, confirm only after
 * the consumer has validated a changed, acknowledged result. Never from render. */
export function useTransientFeedbackOwner(host: RefObject<Element | null>) {
  const feedback = useContext(FeedbackContext);
  const privacy = usePrivacyReadiness();
  const [owner] = useState(() => ({}));
  const insertion = useRef(false);
  useInsertionEffect(() => {
    insertion.current = true;
  });
  useLayoutEffect(() => {
    insertion.current = false;
    feedback?.flushRender();
  });
  const withdraw = useCallback(() => {
    feedback?.dispose(owner, !insertion.current);
  }, [feedback, owner]);
  const current = useStrictPresentation(host, privacy.generation, withdraw);
  return useMemo(
    () => ({
      begin: (retry: string) => {
        if (!current() || !feedback) return null;
        if (!feedback.hasOwner(owner)) feedback.register(owner, current);
        return feedback.begin(owner, retry);
      },
      confirm: (
        ticket: FeedbackTicket | null,
        retry: string,
        confirmation: FeedbackConfirmation,
      ) => feedback?.confirm(ticket, owner, retry, confirmation) ?? false,
    }),
    [current, feedback, owner],
  );
}
