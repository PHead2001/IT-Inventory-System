'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { routeKey } from '@/components/experience/route-key';
import { useRouteRouter } from '@/components/experience/route-pending';
import {
  useRouteCommandBoundary,
  type RouteCommandTicket,
} from '@/components/experience/route-motion';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { freshPresentationGrant } from '@/components/experience/presentation-privacy';
import {
  subscribePrivacyRevocation,
  subscribeAssignmentInvalidation,
} from '@/features/scan/assign-batch';
import { motion } from 'motion/react';
import {
  Search,
  Keyboard,
  X,
  Package,
  MapPin,
  Building2,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEffectiveReducedMotion } from '@/components/experience/motion-preference';
import {
  commandMatches,
  commands,
  ignoresShortcut,
  shortcutCommand,
  type Command,
} from './registry';
import {
  commandQuery,
  commandResults,
  entityDestination,
  type EntityIntent,
  type EntityRow,
  type CommandResults,
} from './contracts';
import { createShortcutPreference } from './shortcut-preference';
import { TrackingTypeChoices } from '@/features/inventory/components/add-item-launcher';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { requestAppNavigation } from '@/lib/navigation/guard';

type CommandContextValue = {
  enabled: boolean;
  held: boolean;
  persistence: boolean;
  setEnabled: (value: boolean) => void;
  open: (type: 'palette' | 'help', invoker: HTMLElement | null) => void;
};
const CommandContext = createContext<CommandContextValue | null>(null);
const focusable =
  'button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), [tabindex="0"]';
export function ShortcutBadge({ href }: { href: string }) {
  const context = useContext(CommandContext);
  const command = commands.find(
    (entry) => entry.target.kind === 'navigate' && entry.target.href === href,
  );
  return context?.enabled && context.held && command?.shortcut ? (
    <kbd className="ml-auto text-xs">{command.shortcut}</kbd>
  ) : null;
}
export function useShortcutHint(href: string) {
  const context = useContext(CommandContext);
  const command = commands.find(
    (entry) => entry.target.kind === 'navigate' && entry.target.href === href,
  );
  return context?.enabled ? command?.shortcut : undefined;
}
export function CommandButtons() {
  const context = useContext(CommandContext);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        data-command-launcher="true"
        onClick={(event) => context?.open('palette', event.currentTarget)}
        aria-label="Search and commands"
      >
        <Search size={18} aria-hidden="true" />
        <span className="hidden sm:inline">Search</span>
        {context?.enabled && (
          <kbd className="hidden text-xs lg:inline">Ctrl/⌘ K</kbd>
        )}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={(event) => context?.open('help', event.currentTarget)}
        aria-label="Keyboard shortcuts"
      >
        <Keyboard size={18} aria-hidden="true" />
      </Button>
    </>
  );
}
export function ShortcutPreference() {
  const context = useContext(CommandContext);
  if (!context) return null;
  return (
    <div className="space-y-2">
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={context.enabled}
          onChange={(event) => context.setEnabled(event.target.checked)}
        />
        Enable application keyboard shortcuts
      </label>
      <p className="experience-muted text-sm">
        {context.persistence
          ? 'Saved for your account in this browser.'
          : 'Browser storage is unavailable. This preference applies to this session.'}
      </p>
    </div>
  );
}
export function CommandProvider({
  actorId,
  backend,
  staff,
  children,
}: {
  actorId: string;
  backend: string;
  staff: boolean;
  children: ReactNode;
}) {
  const router = useRouteRouter();
  const boundary = useRouteCommandBoundary(actorId, backend);
  const privacy = usePrivacyReadiness();
  const latestPrivacy = useRef(privacy);
  useInsertionEffect(() => {
    latestPrivacy.current = privacy;
  }, [privacy]);
  const pathname = usePathname();
  const parameters = useSearchParams();
  const currentRoute = routeKey(
    pathname,
    new URLSearchParams(parameters?.toString()),
  );
  const reduced = useEffectiveReducedMotion();
  const storageKey =
    'it-inventory:shortcuts:v1:' + encodeURIComponent(backend) + ':' + actorId;
  const [preference] = useState(() => createShortcutPreference(storageKey));
  const { enabled, persistence } = useSyncExternalStore(
    preference.subscribe,
    preference.snapshot,
    preference.serverSnapshot,
  );
  const [held, setHeld] = useState(false);
  const [overlay, setOverlay] = useState<'palette' | 'help' | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [intent, setIntent] = useState<EntityIntent | 'add'>('open');
  const [result, setResult] = useState<CommandResults | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(0);
  const [authChecked, setAuthChecked] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const executionEpoch = useRef(0);
  const authClient = useRef<ReturnType<
    typeof createSupabaseBrowserClient
  > | null>(null);
  const authEpoch = useRef(0);
  const sessionIdentity = useRef<string | null>(actorId);
  const inFlight = useRef<AbortController | null>(null);
  const pendingDestination = useRef<{
    ticket: RouteCommandTicket;
    kind: 'heading' | 'search';
  } | null>(null);
  const prefixUntil = useRef(0);
  const prefixTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousPath = useRef(currentRoute);
  const clearPrefix = useCallback(() => {
    prefixUntil.current = 0;
    if (prefixTimer.current) clearTimeout(prefixTimer.current);
  }, []);
  const cancelSessionWork = useCallback((retainArrival = false) => {
    authEpoch.current++;
    generation.current++;
    executionEpoch.current++;
    inFlight.current?.abort();
    if (!retainArrival || !pendingDestination.current?.ticket.retained()) {
      if (pendingDestination.current)
        pendingDestination.current.ticket.used = true;
      pendingDestination.current = null;
    }
  }, []);
  const invalidateSession = useCallback(
    (retainArrival = false) => {
      cancelSessionWork(retainArrival);
      const parent = dialog.current?.parentElement;
      if (parent) {
        parent.hidden = true;
        parent.inert = true;
      }
      invoker.current = null;
      setOverlay(null);
      setQuery('');
      setAuthChecked(false);
      setResult(null);
      setLoading(false);
      setError('Your session changed. Reload or sign in before searching.');
      setHeld(false);
      clearPrefix();
    },
    [clearPrefix, cancelSessionWork],
  );
  async function verifySession() {
    const epoch = ++authEpoch.current;
    const owner = boundary.capture();
    setAuthChecked(false);
    try {
      const client = authClient.current;
      if (!client) throw new Error('Session unavailable');
      const {
        data: { user },
        error: authError,
      } = await client.auth.getUser();
      if (epoch !== authEpoch.current || !owner()) return;
      if (authError || user?.id !== actorId) {
        invalidateSession();
        return;
      }
      sessionIdentity.current = user.id;
      setAuthChecked(true);
      setError('');
    } catch {
      if (epoch === authEpoch.current && owner()) {
        setError('Your session could not be checked. Try again.');
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    let live = true;
    try {
      const client = createSupabaseBrowserClient();
      authClient.current = client;
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((_event, session) => {
        const identity = session?.user.id ?? null;
        if (identity !== sessionIdentity.current) {
          sessionIdentity.current = identity;
          // No async Supabase calls inside its auth callback: invalidate now,
          // and verify with getUser only on the next explicit open/retry.
          invalidateSession();
        }
      });
      return () => {
        live = false;
        subscription.unsubscribe();
        authClient.current = null;
        cancelSessionWork();
      };
    } catch {
      queueMicrotask(() => {
        if (live) invalidateSession();
      });
      return () => {
        live = false;
      };
    }
  }, [actorId, backend, invalidateSession, cancelSessionWork]);
  function open(type: 'palette' | 'help', target: HTMLElement | null) {
    if (
      !boundary.authorized() ||
      !freshPresentationGrant(latestPrivacy.current) ||
      overlay ||
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="dialog"], [role="alertdialog"], dialog[open], [role="menu"], [role="listbox"]',
        ),
      ).some(
        (element) =>
          element.isConnected &&
          !element.closest('[hidden], [inert]') &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== 'hidden',
      )
    )
      return;
    cancelSessionWork();
    invoker.current = target;
    clearPrefix();
    setHeld(false);
    setQuery('');
    setIntent('open');
    setScope('active');
    setResult(null);
    setError('');
    setOverlay(type);
    if (type === 'palette') void verifySession();
  }
  function close(restore = true) {
    const focusOwner = boundary.capture();
    const focusTarget = invoker.current;
    executionEpoch.current++;
    generation.current++;
    inFlight.current?.abort();
    setQuery('');
    setResult(null);
    setOverlay(null);
    setLoading(false);
    clearPrefix();
    if (restore)
      requestAnimationFrame(() =>
        boundary.focusInvoker(focusOwner, focusTarget),
      );
  }
  async function navigate(href: string, search = false) {
    if (
      !boundary.authorized() ||
      !freshPresentationGrant(latestPrivacy.current)
    )
      return;
    const owner = boundary.capture();
    const session = ++executionEpoch.current;
    const allowed = await requestAppNavigation(
      href,
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
    );
    if (!owner() || session !== executionEpoch.current) return;
    if (!allowed) {
      close(false);
      return;
    }
    const ticket = boundary.issue(href);
    if (!ticket) return;
    pendingDestination.current = {
      ticket,
      kind: search ? 'search' : 'heading',
    };
    close(false);
    try {
      router.push(href);
    } catch {
      boundary.cancel(ticket);
      pendingDestination.current = null;
    }
  }
  function focusDestination() {
    const pending = pendingDestination.current;
    if (!pending || overlay) return;
    if (!pending.ticket.retained()) {
      boundary.cancel(pending.ticket);
      pendingDestination.current = null;
      return;
    }
    if (!pending.ticket.current()) return;
    if (boundary.focus(pending.ticket, pending.kind))
      pendingDestination.current = null;
  }
  function execute(command: Command) {
    if (
      !boundary.authorized() ||
      !freshPresentationGrant(latestPrivacy.current)
    )
      return;
    if (command.staff && !staff) return;
    if (command.target.kind === 'navigate') {
      navigate(command.target.href, command.id === 'inventory');
      return;
    }
    if (command.target.kind === 'overlay') {
      setOverlay(command.target.overlay);
      setIntent('open');
      return;
    }
    generation.current++;
    setOverlay('palette');
    setIntent(command.target.task === 'print' ? 'label' : command.target.task);
    setQuery('');
    setResult(null);
    setError('');
    setLoading(false);
    input.current?.focus();
  }
  function editSearch(value: string, nextScope: 'active' | 'all') {
    executionEpoch.current++;
    generation.current++;
    setQuery(value);
    setScope(nextScope);
    setResult(null);
    setActive(0);
    if (authChecked) setError('');
    setRetry(0);
    setLoading(
      authChecked &&
        Boolean(value.trim()) &&
        commandQuery.safeParse({ query: value, scope: nextScope }).success,
    );
  }
  useEffect(() => {
    clearPrefix();
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      setHeld(false);
      if (previousPath.current !== currentRoute) {
        cancelSessionWork(true);
        setOverlay(null);
        setQuery('');
        setResult(null);
        setLoading(false);
        setError('');
        setAuthChecked(false);
        previousPath.current = currentRoute;
      }
    });
    return () => {
      live = false;
    };
  }, [currentRoute, clearPrefix, cancelSessionWork]);
  useEffect(() => {
    const traverse = () => {
      cancelSessionWork();
      clearPrefix();
      setOverlay(null);
      setQuery('');
      setResult(null);
      setLoading(false);
      setAuthChecked(false);
      setError('');
    };
    window.addEventListener('popstate', traverse, true);
    return () => window.removeEventListener('popstate', traverse, true);
  }, [cancelSessionWork, clearPrefix]);
  const reconcile = useEffectEvent(() => focusDestination());
  useEffect(() => {
    reconcile();
    return boundary.subscribe(() => reconcile());
  }, [boundary, overlay, privacy]);
  useInsertionEffect(() => {
    const withdraw = () => invalidateSession();
    const revoke = subscribePrivacyRevocation(withdraw);
    const assignment = subscribeAssignmentInvalidation(withdraw);
    return () => {
      revoke();
      assignment();
      cancelSessionWork();
    };
  }, [invalidateSession, cancelSessionWork]);
  useLayoutEffect(() => {
    if (freshPresentationGrant(privacy)) return;
    // The render already excludes the private overlay. Withdraw asynchronous
    // work immediately; clear its React state after this commit, preserving
    // only an original same-binding arrival ticket. A new opening supersedes
    // this queued cleanup, and revocation subscribers never retain tickets.
    cancelSessionWork(true);
    invoker.current = null;
    clearPrefix();
    const epoch = executionEpoch.current;
    queueMicrotask(() => {
      if (executionEpoch.current === epoch) invalidateSession(true);
    });
  }, [privacy, cancelSessionWork, invalidateSession, clearPrefix]);
  useEffect(() => {
    if (!overlay) return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const target =
      overlay === 'palette'
        ? intent === 'add'
          ? dialog.current?.querySelector<HTMLElement>('a[href]')
          : input.current
        : dialog.current?.querySelector<HTMLElement>(focusable);
    (target ?? dialog.current)?.focus();
    return () => {
      document.body.style.overflow = priorOverflow;
    };
  }, [overlay, intent]);
  useEffect(() => {
    const request = ++generation.current;
    const owner = boundary.capture();
    const controller = new AbortController();
    inFlight.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    queueMicrotask(() => {
      if (controller.signal.aborted || !owner()) return;
      setResult(null);
      if (authChecked) setError('');
      setActive(0);
      const parsed = commandQuery.safeParse({
        query,
        scope,
        purpose:
          intent === 'move' ? 'move' : intent === 'label' ? 'print' : 'all',
      });
      if (
        overlay !== 'palette' ||
        intent === 'add' ||
        !query.trim() ||
        !authChecked ||
        !owner()
      ) {
        setLoading(false);
        return;
      }
      if (!parsed.success) {
        setLoading(false);
        setError('Use up to 200 characters without control characters.');
        return;
      }
      setLoading(true);
      timer = setTimeout(async () => {
        try {
          const response = await fetch('/api/commands/search', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parsed.data),
          });
          const body: unknown = await response.json();
          if (
            request !== generation.current ||
            controller.signal.aborted ||
            !owner()
          )
            return;
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              invalidateSession();
              return;
            }
            const message =
              typeof body === 'object' &&
              body &&
              'error' in body &&
              typeof body.error === 'string'
                ? body.error
                : 'Search could not be loaded. Try again.';
            setError(message);
            return;
          }
          if (
            !body ||
            typeof body !== 'object' ||
            !('identity' in body) ||
            !('result' in body)
          )
            throw new Error('Invalid result');
          const identity = body.identity;
          if (
            !identity ||
            typeof identity !== 'object' ||
            !('actorId' in identity) ||
            !('backend' in identity) ||
            identity.actorId !== actorId ||
            identity.backend !== backend
          ) {
            invalidateSession();
            setError('Your account changed. Reload before searching.');
            return;
          }
          const data = commandResults.parse(body.result);
          setResult(data);
        } catch {
          if (
            !controller.signal.aborted &&
            request === generation.current &&
            owner()
          )
            setError('Search could not be loaded. Try again.');
        } finally {
          if (
            request === generation.current &&
            !controller.signal.aborted &&
            owner()
          )
            setLoading(false);
        }
      }, 150);
    });
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    query,
    scope,
    overlay,
    intent,
    actorId,
    backend,
    retry,
    authChecked,
    invalidateSession,
    boundary,
  ]);
  const staticCommands =
    intent === 'open' && commandQuery.safeParse({ query, scope }).success
      ? commandMatches(query, staff)
      : [];
  const rows = (result?.rows ?? []).filter(
    (row) =>
      entityDestination(row, intent === 'add' ? 'open' : intent) !== null,
  );
  const selectRow = (row: EntityRow) => {
    const href = entityDestination(row, intent === 'add' ? 'open' : intent);
    if (href) navigate(href);
  };
  const actions = [
    ...staticCommands.map((command) => () => execute(command)),
    ...rows.map((row) => () => selectRow(row)),
  ];
  useEffect(() => {
    const container = listbox.current;
    const option = container?.querySelector<HTMLElement>(
      '#command-result-' + Math.min(active, actions.length - 1),
    );
    if (!container || !option) return;
    const bounds = container.getBoundingClientRect();
    const item = option.getBoundingClientRect();
    // Scroll only the results viewport; never move the dialog or document.
    // Immediate movement also keeps rapid keys and Reduced Motion predictable.
    if (item.top < bounds.top) container.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom)
      container.scrollTop += item.bottom - bounds.bottom;
  }, [active, actions.length, result, overlay, intent]);
  const keydown = useEffectEvent((event: KeyboardEvent) => {
    if (
      !boundary.authorized() ||
      !freshPresentationGrant(latestPrivacy.current)
    )
      return;
    if (event.ctrlKey || event.metaKey) setHeld(true);
    if (overlay) {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented)
        return;
      if (
        event.key === 'Escape' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'Tab') {
        const elements = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(focusable) ?? [],
        );
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
        return;
      if (
        document.activeElement === input.current &&
        ['ArrowDown', 'ArrowUp'].includes(event.key)
      ) {
        event.preventDefault();
        setActive((value) =>
          actions.length
            ? (value + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) %
              actions.length
            : 0,
        );
      }
      if (document.activeElement === input.current && event.key === 'Enter') {
        event.preventDefault();
        actions[active]?.();
      }
      return;
    }
    if (!enabled || ignoresShortcut(event, document)) {
      clearPrefix();
      return;
    }
    const commandId = shortcutCommand(
      event,
      event.timeStamp < prefixUntil.current,
    );
    clearPrefix();
    if (commandId === 'prefix') {
      event.preventDefault();
      prefixUntil.current = event.timeStamp + 1000;
      prefixTimer.current = setTimeout(clearPrefix, 1000);
      return;
    }
    const command = commands.find((entry) => entry.id === commandId);
    if (!command || (command.staff && !staff)) return;
    event.preventDefault();
    if (command.target.kind === 'overlay')
      open(
        command.target.overlay,
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      );
    else if (command.target.kind === 'task') {
      open(
        'palette',
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      );
      execute(command);
    } else execute(command);
  });
  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => keydown(event);
    function keyup(event: KeyboardEvent) {
      setHeld(event.ctrlKey || event.metaKey);
    }
    function reset() {
      clearPrefix();
      setHeld(false);
    }
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', reset);
    document.addEventListener('focusin', clearPrefix);
    return () => {
      reset();
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', reset);
      document.removeEventListener('focusin', clearPrefix);
    };
  }, [clearPrefix]);
  function setEnabled(value: boolean) {
    preference.setEnabled(value);
    setHeld(false);
    clearPrefix();
  }
  return (
    <CommandContext.Provider
      value={{ enabled, held, persistence, setEnabled, open }}
    >
      <div
        ref={shell}
        inert={Boolean(overlay) && freshPresentationGrant(privacy)}
      >
        {children}
      </div>
      {overlay && freshPresentationGrant(privacy) && boundary.authorized() && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[color-mix(in_srgb,var(--background)_80%,transparent)] p-3 pt-[8vh]"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <motion.div
            ref={dialog}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-title"
            className="experience-surface w-full max-w-2xl space-y-4 p-4 sm:p-6"
            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: 'spring', visualDuration: 0.24, bounce: 0.12 }
            }
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="command-title" className="text-xl font-semibold">
                {overlay === 'help'
                  ? 'Keyboard shortcuts'
                  : intent === 'add'
                    ? 'Add item'
                    : intent === 'move'
                      ? 'Choose equipment to move'
                      : intent === 'label'
                        ? 'Choose a label'
                        : 'Search and commands'}
              </h2>
              <Button
                type="button"
                variant="outline"
                aria-label="Close dialog"
                onClick={() => close()}
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </div>
            {overlay === 'help' ? (
              <>
                <p className="experience-muted text-sm">
                  Shortcuts pause while typing, scanning, or using another
                  dialog. Browser and assistive technology shortcuts keep their
                  usual behavior.
                </p>
                {enabled ? (
                  <dl className="grid gap-3 sm:grid-cols-2">
                    {commands
                      .filter(
                        (entry) => entry.shortcut && (!entry.staff || staff),
                      )
                      .map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between gap-4"
                        >
                          <dt>{entry.label}</dt>
                          <dd>
                            <kbd className="experience-code text-sm">
                              {entry.shortcut}
                            </kbd>
                          </dd>
                        </div>
                      ))}
                  </dl>
                ) : (
                  <p>
                    Application shortcuts are disabled. Search and help buttons
                    remain available.
                  </p>
                )}
                <ShortcutPreference />
              </>
            ) : intent === 'add' ? (
              <>
                <p>How do you track this item?</p>
                <TrackingTypeChoices onNavigate={navigate} />
              </>
            ) : (
              <>
                <Input
                  ref={input}
                  maxLength={400}
                  value={query}
                  onChange={(event) => editSearch(event.target.value, scope)}
                  aria-label="Find equipment, locations, sites, or commands"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="command-results"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    actions.length
                      ? 'command-result-' + Math.min(active, actions.length - 1)
                      : undefined
                  }
                  autoComplete="off"
                  placeholder="Name, tag, serial, or code"
                />
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={scope === 'all'}
                    onChange={(event) =>
                      editSearch(query, event.target.checked ? 'all' : 'active')
                    }
                  />
                  Include retired, archived, and inactive records
                </label>
                {intent === 'move' && (
                  <p className="experience-muted text-sm">
                    Move searches active equipment only. Its current location
                    and available tasks are checked when you open the record.
                  </p>
                )}
                {!authChecked && !error && (
                  <p role="status">Checking your session…</p>
                )}
                {query.trim().length > 0 &&
                  Array.from(query.trim()).length < 3 && (
                    <p className="experience-muted text-sm">
                      Short searches match exact identifiers. Type at least 3
                      characters for fuzzy matches.
                    </p>
                  )}
                {loading && (
                  <div
                    role="status"
                    aria-label="Searching inventory"
                    className="space-y-2"
                  >
                    <span className="sr-only">Searching inventory…</span>
                    {[0, 1, 2].map((key) => (
                      <div
                        key={key}
                        className="h-11 rounded bg-[var(--workspace-feedback-background)]"
                      />
                    ))}
                  </div>
                )}
                {error && (
                  <div role="alert" className="experience-feedback space-y-2">
                    <p>{error}</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        void verifySession();
                        setRetry((value) => value + 1);
                      }}
                    >
                      Retry search
                    </Button>
                  </div>
                )}
                <div
                  ref={listbox}
                  id="command-results"
                  role="listbox"
                  aria-label="Search results"
                  aria-busy={loading}
                  className="max-h-[45vh] space-y-1 overflow-y-auto"
                >
                  {staticCommands.map((entry, index) => (
                    <button
                      id={'command-result-' + index}
                      key={entry.id}
                      role="option"
                      aria-selected={index === active}
                      onFocus={() => setActive(index)}
                      type="button"
                      onClick={() => execute(entry)}
                      className={
                        'flex min-h-11 w-full items-center gap-3 rounded p-3 text-left ' +
                        (index === active
                          ? 'bg-[var(--workspace-feedback-background)]'
                          : '')
                      }
                    >
                      <ArrowRight size={18} aria-hidden="true" />
                      <span className="flex-1">{entry.label}</span>
                      <span className="experience-muted text-xs">Command</span>
                      {enabled && entry.shortcut && (
                        <kbd className="text-xs">{entry.shortcut}</kbd>
                      )}
                    </button>
                  ))}
                  {rows.map((row, rowIndex) => {
                    const index = rowIndex + staticCommands.length;
                    const Icon =
                      row.kind === 'location'
                        ? MapPin
                        : row.kind === 'site'
                          ? Building2
                          : Package;
                    return (
                      <button
                        id={'command-result-' + index}
                        role="option"
                        aria-selected={index === active}
                        onFocus={() => setActive(index)}
                        key={row.kind + ':' + row.id}
                        type="button"
                        onClick={() => selectRow(row)}
                        className={
                          'flex min-h-11 w-full items-start gap-3 rounded p-3 text-left ' +
                          (index === active
                            ? 'bg-[var(--workspace-feedback-background)]'
                            : '')
                        }
                      >
                        <Icon size={18} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-semibold">
                            {row.name}
                          </span>
                          {row.context &&
                            (row.kind === 'asset' ||
                              row.kind === 'quantity') && (
                              <span className="block text-sm">
                                {row.context.places.length === 0
                                  ? 'No current storage or site'
                                  : row.context.places
                                      .map(
                                        (place) =>
                                          (place.kind === 'site'
                                            ? 'Site: '
                                            : 'Storage: ') +
                                          place.name +
                                          ' (' +
                                          place.code +
                                          ')',
                                      )
                                      .join('; ')}
                                {row.context.hasMore && '; More locations'}
                              </span>
                            )}
                          <span className="experience-code block break-words text-sm">
                            {row.assetTag ?? row.code ?? row.serialNumber}
                          </span>
                          {row.matchedField === 'serialNumber' &&
                            row.serialNumber && (
                              <span className="experience-code block text-sm">
                                Serial: {row.serialNumber}
                              </span>
                            )}
                        </span>
                        <span className="space-y-1 text-xs">
                          <span className="block">
                            {row.kind === 'asset'
                              ? 'Individual asset'
                              : row.kind === 'quantity'
                                ? 'Quantity item'
                                : row.kind === 'site'
                                  ? 'Site'
                                  : 'Location'}
                          </span>
                          {row.status !== 'active' && (
                            <span className="block font-semibold">
                              {row.status}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {authChecked &&
                  !loading &&
                  !error &&
                  query.trim() &&
                  actions.length === 0 && (
                    <p role="status">
                      No matches. Try a name, tag, serial, or code
                      {scope === 'active'
                        ? ', or include historical records'
                        : ''}
                      .
                    </p>
                  )}
                {result?.hasMore && (
                  <p role="status" className="experience-muted text-sm">
                    Showing the closest 20 records. Add more detail to narrow
                    your search.
                  </p>
                )}
                {intent !== 'open' && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIntent('open');
                      setQuery('');
                    }}
                  >
                    Back to commands
                  </Button>
                )}
              </>
            )}
          </motion.div>
        </div>
      )}
    </CommandContext.Provider>
  );
}
