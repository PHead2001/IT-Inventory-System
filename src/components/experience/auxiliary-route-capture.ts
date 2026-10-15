import { observeTransitionCapture } from '@/components/forms/transition-capture';
import { hasBlockingPresentationAncestor } from '@/components/forms/transition-capture-boundary';
import { routeContentMotion } from './route-content-motion';
import type { InventoryCaptureRegionId } from './inventory-capture-regions';

export type AuxiliaryParticipant = {
  root: HTMLElement;
  routeKey: string;
  region: Exclude<InventoryCaptureRegionId, 'body'>;
  source: symbol;
  current(): boolean;
};
export type AuxiliaryApproval = {
  token: object;
  base: string;
  sourceKey: string;
  destinationKey: string;
  sourceRoot: HTMLElement;
  handoff(): (() => void) | undefined;
  admitted(): boolean;
  current(): boolean;
  participate(name: string): boolean;
};
type Claim = {
  name: string;
  routeKey: string;
  previous: string;
  previousClass: string;
};
type Capture = AuxiliaryApproval & {
  started: boolean;
  open: boolean;
  native?: ViewTransition;
  claims: Map<HTMLElement, Claim>;
  names: Set<string>;
  release: Array<() => void>;
  cleanups: Array<() => void>;
};

/** Explicit authored refs only. This controller grants neither route readiness
 * nor privacy; the existing provider supplies one exact accepted approval. */
export function createAuxiliaryRouteCapture() {
  const participants = new Set<AuxiliaryParticipant>();
  const registrations = new WeakMap<AuxiliaryParticipant, symbol>();
  const sources = new Map<
    HTMLElement,
    { routeKey: string; source: symbol; token: symbol }
  >();
  const claims = new WeakMap<HTMLElement, Claim>();
  const used = new WeakSet<object>();
  let active: Capture | null = null;
  function usable(participant: AuxiliaryParticipant, viewport = true) {
    const root = participant.root;
    if (
      !participant.current() ||
      !root.isConnected ||
      hasBlockingPresentationAncestor(root) ||
      root.tagName === 'CANVAS' ||
      root.querySelector('canvas')
    )
      return false;
    for (let node: HTMLElement | null = root; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        node.hidden ||
        node.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' ||
        style.visibility === 'hidden'
      )
        return false;
    }
    const rect = root.getBoundingClientRect(),
      view = root.ownerDocument.defaultView;
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      (!viewport ||
        (!!view &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < view.innerHeight &&
          rect.left < view.innerWidth))
    );
  }
  function clear(capture: Capture, root?: HTMLElement) {
    for (const [node, claim] of capture.claims) {
      if (root && root !== node) continue;
      if (claims.get(node) !== claim) continue;
      if (node.style.viewTransitionName === claim.name) {
        node.style.viewTransitionName = claim.previous;
        if (
          node.style.getPropertyValue('view-transition-class') ===
          'route-content'
        )
          node.style.setProperty('view-transition-class', claim.previousClass);
      }
      claims.delete(node);
      capture.claims.delete(node);
    }
  }
  function release(capture: Capture) {
    capture.release.splice(0).forEach((finish) => finish());
    capture.cleanups.splice(0).forEach((finish) => finish());
  }
  function withdraw(token = active?.token) {
    const capture = active;
    if (!capture || capture.token !== token) return;
    active = null;
    capture.open = false;
    clear(capture);
    release(capture);
    capture.native?.skipTransition();
  }
  function assign(capture: Capture, participant: AuxiliaryParticipant) {
    if (
      active !== capture ||
      !capture.open ||
      !capture.admitted() ||
      !capture.current() ||
      !usable(participant)
    )
      return;
    // During the new snapshot, a retained outgoing Activity can still be visible.
    // Its old bitmap was captured before mutation; clear only our exact CSS name.
    if (participant.routeKey === capture.destinationKey) {
      for (const [root, claim] of capture.claims)
        if (claim.routeKey === capture.sourceKey) clear(capture, root);
    }
    if (
      [...participants].some(
        (other) =>
          other !== participant &&
          other.routeKey === participant.routeKey &&
          other.region === participant.region &&
          usable(other),
      )
    ) {
      withdraw(capture.token);
      return;
    }
    const root = participant.root,
      existing = claims.get(root);
    if (existing && capture.claims.get(root) === existing) return;
    const computed = getComputedStyle(root).viewTransitionName;
    const computedClass = getComputedStyle(root).getPropertyValue(
      'view-transition-class',
    );
    if (
      (computed && computed !== 'none') ||
      (computedClass && computedClass !== 'none')
    ) {
      withdraw(capture.token);
      return;
    }
    const claim = {
      name: capture.base + '-' + participant.region,
      routeKey: participant.routeKey,
      previous: root.style.viewTransitionName,
      previousClass: root.style.getPropertyValue('view-transition-class'),
    };
    if (claim.previousClass && claim.previousClass !== 'none') {
      withdraw(capture.token);
      return;
    }
    claims.set(root, claim);
    capture.claims.set(root, claim);
    capture.names.add(claim.name);
    root.style.viewTransitionName = claim.name;
    root.style.setProperty('view-transition-class', 'route-content');
  }
  return {
    registerSource(root: HTMLElement, routeKey: string, source: symbol) {
      const token = Symbol();
      sources.set(root, { routeKey, source, token });
      return () => {
        if (sources.get(root)?.token === token) sources.delete(root);
      };
    },
    source(root: HTMLElement, routeKey: string) {
      const source = sources.get(root);
      return source?.routeKey === routeKey ? source.source : undefined;
    },
    register(participant: AuxiliaryParticipant) {
      const registration = Symbol();
      registrations.set(participant, registration);
      participants.add(participant);
      if (
        active?.native &&
        active.open &&
        participant.routeKey === active.destinationKey
      )
        assign(active, participant);
      return () => {
        if (registrations.get(participant) === registration) {
          registrations.delete(participant);
          participants.delete(participant);
        }
      }; // Native lifetime owns claims/leases.
    },
    arm(approval: AuxiliaryApproval) {
      if (
        used.has(approval.token) ||
        !approval.admitted() ||
        !approval.current()
      )
        return false;
      withdraw();
      used.add(approval.token);
      active = {
        ...approval,
        started: false,
        open: false,
        claims: new Map(),
        names: new Set(),
        release: [],
        cleanups: [],
      };
      return true;
    },
    reconcile() {
      if (
        active &&
        (!active.current() ||
          ((!active.started || active.open) && !active.admitted()))
      )
        withdraw();
    },
    ordinaryCommit(routeKey: string) {
      if (active && !active.started && routeKey === active.destinationKey)
        withdraw();
    },
    withdraw,
    attach(document: Document) {
      return observeTransitionCapture(document, () => {}, {
        beforeNative() {
          const capture = active;
          if (!capture) return;
          if (
            capture.started ||
            !capture.admitted() ||
            !capture.current() ||
            !capture.sourceRoot.isConnected
          ) {
            withdraw(capture.token);
            return;
          }
          capture.started = true;
          capture.open = true;
          try {
            const finish = capture.handoff();
            if (finish) capture.release.push(finish);
            for (const participant of participants) {
              if (
                participant.routeKey !== capture.sourceKey ||
                !capture.sourceRoot.contains(participant.root) ||
                !usable(participant, false)
              )
                continue;
              assign(capture, participant);
            }
          } catch {
            withdraw(capture.token);
            return;
          }
          return {
            failed: () => withdraw(capture.token),
            returned(native) {
              capture.native = native;
              if (active !== capture) {
                native.skipTransition();
                return;
              }
              void native.ready.then(
                () => {
                  if (active !== capture) return;
                  capture.open = false;
                  clear(capture);
                  if (!capture.admitted() || !capture.current()) {
                    withdraw(capture.token);
                    return;
                  }
                  const animations = document.getAnimations();
                  for (const name of capture.names) {
                    const has = (side: string) =>
                      animations.some(
                        (animation) =>
                          (animation.effect as KeyframeEffect | null)
                            ?.pseudoElement ===
                          `::view-transition-${side}(${name})`,
                      );
                    if (!has('old') && !has('new')) continue;
                    if (has('old') && has('new')) {
                      const cleanup = routeContentMotion(
                        { name },
                        capture.current,
                        () => withdraw(capture.token),
                      );
                      if (cleanup) capture.cleanups.push(cleanup);
                    }
                    if (active === capture) capture.participate(name);
                  }
                },
                () => withdraw(capture.token),
              );
              const finished = () => {
                capture.open = false;
                clear(capture);
                release(capture);
                if (active === capture) active = null;
              };
              void native.finished.then(finished, finished);
            },
          };
        },
      });
    },
  };
}
