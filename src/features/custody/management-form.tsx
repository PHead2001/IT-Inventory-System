'use client';
import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { field, panel } from '@/features/inventory/components/read-ui';
import { submitCustody } from './actions';
import { suggestSiteCode } from './site-code';
import type { ManagedLocation, Site, SiteHolding } from './queries.server';
import type { CustodyOperation, CustodyState } from './contracts';
import {
  RequiredFieldsNote,
  RequiredMark,
  useFormValidation,
  ValidationSummary,
} from '@/components/forms/validation';
import {
  readSiteRecovery,
  writeSiteRecovery,
  type SiteRecoveryEnvelope,
  type SiteRecoveryCommand,
  type SubmissionPersistence,
} from './site-recovery';

type Command = {
  operation: CustodyOperation;
  requestId: string;
  expectedActorId?: string;
  payload: Record<string, unknown>;
};

// Capture the exact operation for uncertain retry and close the synchronous
// double-click window before React has rendered disabled controls.
function useSubmission(
  actorId?: string,
  persistence?: React.RefObject<SubmissionPersistence | null>,
) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<CustodyState | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [retryActor, setRetryActor] = useState<string | undefined>(actorId);
  const command = useRef<Command | null>(null);
  const running = useRef(false);
  const completedCreate = useRef(false);
  const acknowledged = useRef<{
    command: Command;
    result: CustodyState;
  } | null>(null);
  const [terminalPending, setTerminalPending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const actor = useRef(actorId);
  useLayoutEffect(() => {
    actor.current = actorId;
  }, [actorId]);
  const actorBlocked = uncertain && retryActor !== actorId;
  const submit = async (
    operation: CustodyOperation,
    payload: Record<string, unknown>,
    onSuccess: (
      result: Extract<CustodyState, { ok: true }>,
      payload: Record<string, unknown>,
    ) => void,
  ) => {
    if (
      running.current ||
      acknowledged.current ||
      (completedCreate.current && operation === 'site_create')
    )
      return;
    const originalActor = actor.current;
    if (command.current && command.current.expectedActorId !== originalActor)
      return;
    const attempt = command.current ?? {
      operation,
      payload: structuredClone(payload),
      requestId: crypto.randomUUID(),
      expectedActorId: originalActor,
    };
    if (persistence?.current && !persistence.current.before(attempt)) return;
    command.current = attempt;
    running.current = true;
    setPending(true);
    let result: CustodyState;
    try {
      result = await submitCustody(attempt);
    } catch {
      result = {
        ok: false,
        code: 'unexpected',
        message:
          'The result could not be confirmed. Retry this submission to safely check it.',
      };
    }
    running.current = false;
    if (!mounted.current) return;
    setPending(false);
    if (actor.current !== originalActor) {
      // A context change cannot establish this draft's saved baseline. Keep the
      // original actor/command so only that account can resolve it by replay.
      setUncertain(true);
      setRetryActor(attempt.expectedActorId);
      setState({
        ok: false,
        code: 'actor_changed',
        message:
          'Return to the original signed-in account to retry this submission.',
      });
      return;
    }
    const nextUncertain =
      !result.ok &&
      (result.code === 'unexpected' ||
        (uncertain &&
          [
            'forbidden',
            'P1001',
            'idempotency_conflict',
            'P1009',
            'actor_changed',
          ].includes(result.code)));
    setUncertain(nextUncertain);
    const persisted =
      persistence?.current?.after(attempt, result, nextUncertain) ?? true;
    if (!persisted && !nextUncertain) {
      acknowledged.current = { command: attempt, result };
      setTerminalPending(true);
    }
    if (nextUncertain) setRetryActor(attempt.expectedActorId);
    setState(result);
    if (result.ok) {
      if (attempt.operation === 'site_create') completedCreate.current = true;
      if (persisted) command.current = null;
      onSuccess(result, attempt.payload);
      try {
        router.refresh();
      } catch {
        /* Commit acknowledgement remains authoritative. */
      }
    } else if (!nextUncertain) {
      if (persisted) command.current = null;
      if (
        result.code === 'P1002' ||
        (result.code === 'P1008' && attempt.operation === 'site_set_active')
      )
        router.refresh();
    }
  };
  return {
    pending,
    uncertain,
    actorBlocked,
    state,
    setState,
    submit,
    terminalPending,
    reconcile: () => {
      const original = acknowledged.current;
      if (!original || actor.current !== original.command.expectedActorId)
        return false;
      if (
        !persistence?.current?.after(original.command, original.result, false)
      )
        return false;
      acknowledged.current = null;
      command.current = null;
      setTerminalPending(false);
      return true;
    },
    recover: (original: Command) => {
      command.current = original;
      setUncertain(true);
      setRetryActor(original.expectedActorId);
    },
    reset: () => {
      completedCreate.current = false;
      acknowledged.current = null;
      setTerminalPending(false);
      command.current = null;
      setState(null);
      setUncertain(false);
    },
  };
}

function newer(current: string, baseline: string) {
  return BigInt(current) > BigInt(baseline);
}
function backendOrigin(value: string | undefined) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

export function SiteManagementForm({
  site,
  actorId,
  holdings = [],
  holdingTotal = 0,
}: {
  site?: Site;
  actorId?: string;
  holdings?: SiteHolding[];
  holdingTotal?: number;
}) {
  const scope = useId();
  const validation = useFormValidation();
  const persistence = useRef<SubmissionPersistence | null>(null);
  const {
    pending,
    uncertain,
    actorBlocked,
    state,
    setState,
    submit,
    reset,
    recover,
    terminalPending,
    reconcile,
  } = useSubmission(actorId, persistence);
  const [created, setCreated] = useState<Site | null>(null);
  const [baseline, setBaseline] = useState(site);
  const [values, setValues] = useState({
    code: '',
    name: site?.name ?? '',
    notes: site?.notes ?? '',
  });
  const [lifecycle, setLifecycle] = useState<{
    active: boolean;
    version: string;
  } | null>(null);
  const [reason, setReason] = useState('');
  const recovery = useRef<SiteRecoveryEnvelope | null>(null);
  const recoveryStored = useRef(false);
  const hydrated = useRef(false);
  const [recoveryError, setRecoveryError] = useState('');
  const backend = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const [mountedIdentity] = useState({
    actorId,
    backend: backendOrigin(backend),
  });
  const identityMismatch =
    mountedIdentity.actorId !== actorId ||
    mountedIdentity.backend !== backendOrigin(backend);
  const recoveryEnabled = !!actorId;
  const limitation =
    'Site recovery could not be stored safely. Keep this task open and retry after storage is available; saving is paused.';
  const persist = (
    patch: Partial<SiteRecoveryEnvelope> = {},
    resolved?: string,
  ) => {
    if (!recoveryEnabled) return true;
    let previous = recovery.current;
    if (
      !previous ||
      previous.scope.actor !== actorId ||
      previous.scope.backend !== backendOrigin(backend)
    ) {
      setRecoveryError(limitation);
      return false;
    }
    // A pristine visit owns an identity but no storage slot. Establish
    // its editing envelope only when needed, before any submitted transition.
    if (!recoveryStored.current) {
      const initial: SiteRecoveryEnvelope = {
        ...previous,
        baseline: baseline ?? null,
        values,
        lifecycle,
        reason,
        ...(patch.status === 'editing' ? patch : {}),
      };
      if (!writeSiteRecovery(initial, null)) {
        setRecoveryError(limitation);
        return false;
      }
      recovery.current = previous = initial;
      recoveryStored.current = true;
    }
    const terminal =
      previous.status === 'saved' || previous.status === 'discarded';
    const next: SiteRecoveryEnvelope = {
      ...previous,
      baseline: baseline ?? null,
      values,
      lifecycle,
      reason,
      ...(terminal
        ? {
            status: 'editing',
            instance: crypto.randomUUID(),
            sequence: 0,
            completion: null,
          }
        : { sequence: previous.sequence + 1 }),
      ...patch,
    };
    if (!writeSiteRecovery(next, previous, resolved)) {
      setRecoveryError(limitation);
      return false;
    }
    recovery.current = next;
    setRecoveryError('');
    return true;
  };
  useLayoutEffect(() => {
    persistence.current = {
      before: (command) => {
        if (identityMismatch) return false;
        if (recovery.current?.status === 'submitted') {
          const previous = recovery.current.command;
          return (
            !!previous &&
            previous.requestId === command.requestId &&
            previous.operation === command.operation &&
            previous.expectedActorId === command.expectedActorId &&
            JSON.stringify(previous.payload) === JSON.stringify(command.payload)
          );
        }
        return persist({
          status: 'submitted',
          command: command as SiteRecoveryCommand,
          completion: null,
        });
      },
      after: (command, result, unresolved) => {
        if (!recoveryEnabled || unresolved) return true;
        const previous = recovery.current;
        if (
          !previous ||
          identityMismatch ||
          previous.status !== 'submitted' ||
          previous.command?.requestId !== command.requestId
        )
          return false;
        // Reconcile the exact submitted envelope, even after the displayed
        // baseline has advanced following a known successful server commit.
        const next: SiteRecoveryEnvelope = {
          ...previous,
          sequence: previous.sequence + 1,
          status: result.ok ? 'saved' : 'editing',
          command: null,
          completion: result.ok
            ? {
                entityId: result.entityId,
                version: result.version,
                changed: result.changed,
              }
            : null,
        };
        if (!writeSiteRecovery(next, previous, command.requestId)) {
          setRecoveryError(
            result.ok
              ? 'Site saved, but completion recovery could not be recorded. Retry site recovery before editing or creating another site.'
              : limitation,
          );
          return false;
        }
        recovery.current = next;
        setRecoveryError('');
        return true;
      },
    };
  });
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useLayoutEffect(() => {
    if (identityMismatch || !recoveryEnabled || hydrated.current) return;
    const environment = backendOrigin(backend);
    if (!environment || !actorId) {
      setRecoveryError(limitation);
      return;
    }
    const url = new URL(window.location.href);
    const supplied = url.searchParams.get('siteDraft');
    if (!site && supplied && !/^[0-9a-f-]{36}$/i.test(supplied)) {
      setRecoveryError(
        'The site draft identity is invalid. Reopen Add property/site from Settings.',
      );
      return;
    }
    const draft = site?.id ?? supplied ?? crypto.randomUUID();
    if (!site && !supplied) {
      url.searchParams.set('siteDraft', draft);
      window.history.replaceState(window.history.state, '', url);
    }
    const identity = {
      origin: window.location.origin,
      backend: environment,
      actor: actorId,
      site: site?.id ?? null,
      draft,
    };
    const stored = readSiteRecovery(identity);
    if (stored.blocked) {
      setRecoveryError(
        'Saved site recovery is unavailable or incompatible. It was retained without replacing it.',
      );
      return;
    }
    const previous = stored.envelope;
    const active: SiteRecoveryEnvelope = previous ?? {
      version: 1,
      scope: identity,
      instance: crypto.randomUUID(),
      sequence: 0,
      status: 'editing',
      baseline: site ?? null,
      values,
      lifecycle: null,
      reason: '',
      command: null,
      completion: null,
    };
    recovery.current = active;
    recoveryStored.current = !!previous;
    hydrated.current = true;
    if (previous && ['editing', 'submitted'].includes(previous.status)) {
      setBaseline(previous.baseline ?? undefined);
      setValues(previous.values);
      setLifecycle(previous.lifecycle);
      setReason(previous.reason);
      if (previous.command) recover(previous.command);
    } else if (previous?.status === 'saved' && !site && previous.completion) {
      setCreated({
        id: previous.completion.entityId,
        version: previous.completion.version,
        code: previous.values.code || suggestSiteCode(previous.values.name),
        name: previous.values.name.trim(),
        notes: previous.values.notes.trim() || null,
        active: true,
      });
    }
  });
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  const dirty =
    values.name !== (baseline?.name ?? '') ||
    values.notes !== (baseline?.notes ?? '') ||
    !!values.code;
  useEffect(() => {
    if (created || (!dirty && !pending && !uncertain && !lifecycle)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    const guard = (event: MouseEvent) => {
      if (
        !recoveryError ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest('a[href]')
          : null;
      if (!anchor || anchor.getAttribute('target') === '_blank') return;
      event.preventDefault();
      setRecoveryError(
        limitation + ' Navigation is paused until this draft can be retained.',
      );
    };
    document.addEventListener('click', guard, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', guard, true);
    };
  }, [
    dirty,
    pending,
    uncertain,
    lifecycle,
    created,
    recoveryError,
    limitation,
  ]);
  const stale = !!site && !!baseline && newer(site.version, baseline.version);
  if (
    !identityMismatch &&
    site &&
    baseline &&
    newer(site.version, baseline.version) &&
    !dirty &&
    !pending &&
    !uncertain &&
    !lifecycle
  ) {
    setBaseline(site);
    setValues({ code: '', name: site.name, notes: site.notes ?? '' });
  }
  const disabled = pending || uncertain || terminalPending || identityMismatch;
  const update = (key: keyof typeof values, value: string) => {
    const next = { ...values, [key]: value };
    persist({
      status: 'editing',
      values: next,
      command: null,
      completion: null,
    });
    setValues(next);
    setState(null);
  };
  const save = () => {
    if (
      identityMismatch ||
      terminalPending ||
      created ||
      (recoveryEnabled && (!hydrated.current || !!recoveryError))
    )
      return;
    if (stale && !uncertain) return;
    if (lifecycle && !reason.trim()) return;
    void submit(
      lifecycle ? 'site_set_active' : baseline ? 'site_update' : 'site_create',
      lifecycle
        ? {
            site_id: baseline!.id,
            expected_version: lifecycle.version,
            active: lifecycle.active,
            reason,
          }
        : baseline
          ? {
              site_id: baseline.id,
              expected_version: baseline.version,
              name: values.name,
              notes: values.notes || null,
              active: baseline.active,
            }
          : {
              code: values.code || suggestSiteCode(values.name),
              name: values.name,
              notes: values.notes || null,
            },
      (result, payload) => {
        if (baseline) {
          const saved = {
            ...baseline,
            version: result.version,
            ...(payload.active !== undefined
              ? { active: payload.active as boolean }
              : {}),
            ...(payload.name !== undefined
              ? {
                  name: (payload.name as string).trim(),
                  notes: (payload.notes as string | null)?.trim() || null,
                }
              : {}),
          };
          setBaseline(saved);
          setValues({ code: '', name: saved.name, notes: saved.notes ?? '' });
        } else {
          setCreated({
            id: result.entityId,
            version: result.version,
            code: payload.code as string,
            name: (payload.name as string).trim(),
            notes: (payload.notes as string | null)?.trim() || null,
            active: true,
          });
        }
        setLifecycle(null);
        setReason('');
      },
    );
  };
  if (identityMismatch)
    return (
      <p role="alert" className={panel}>
        This site task belongs to another signed-in account or environment.
        Return to the original context or reopen Site settings for this account.
      </p>
    );
  if (created)
    return (
      <section
        className={panel + ' max-w-4xl space-y-4'}
        aria-label="Site creation complete"
      >
        <h2 className="text-lg font-semibold">Site created</h2>
        <p role="status" className="break-words">
          {created.name} · {created.code}
        </p>
        {recoveryError && <p role="alert">{recoveryError}</p>}
        {terminalPending && (
          <Button type="button" variant="outline" onClick={() => reconcile()}>
            Retry site recovery
          </Button>
        )}
        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex min-h-11 items-center rounded-lg bg-cyan-600 px-4 font-medium text-slate-950"
            href={`/sites/${encodeURIComponent(created.code)}`}
          >
            View site
          </Link>
          <Button
            type="button"
            variant="outline"
            disabled={!!recoveryError || terminalPending}
            onClick={() => {
              if (recoveryEnabled) {
                const previous = recovery.current;
                if (!previous) return;
                const draft = crypto.randomUUID();
                const url = new URL(window.location.href);
                url.searchParams.set('siteDraft', draft);
                const next: SiteRecoveryEnvelope = {
                  ...previous,
                  scope: { ...previous.scope, draft },
                  instance: crypto.randomUUID(),
                  sequence: 0,
                  status: 'editing',
                  baseline: null,
                  values: { code: '', name: '', notes: '' },
                  lifecycle: null,
                  reason: '',
                  command: null,
                  completion: null,
                };
                recovery.current = next;
                recoveryStored.current = false;
                window.history.replaceState(window.history.state, '', url);
              }
              reset();
              setCreated(null);
              setValues({ code: '', name: '', notes: '' });
              validation.clear();
            }}
          >
            Add another
          </Button>
        </div>
      </section>
    );
  return (
    <form
      className={panel + ' max-w-4xl space-y-4'}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (
          pending ||
          (!uncertain && !validation.validate(event.currentTarget))
        )
          return;
        save();
      }}
    >
      <h2 className="break-words text-lg font-semibold">
        {baseline ? `Manage ${baseline.name}` : 'Add property/site'}
      </h2>
      <RequiredFieldsNote />
      {recoveryError && <p role="alert">{recoveryError}</p>}
      {recoveryError && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (terminalPending) reconcile();
            else if (recovery.current?.status === 'editing') persist();
            else setRecoveryError('');
          }}
        >
          Retry site recovery
        </Button>
      )}
      <label className="block space-y-2">
        Name
        <RequiredMark />
        <Input
          id={scope + '-name'}
          aria-label="Name"
          {...validation.props(scope + '-name')}
          disabled={disabled || !!lifecycle}
          value={values.name}
          maxLength={200}
          required
          onChange={(e) => update('name', e.target.value)}
        />
      </label>
      {validation.error(scope + '-name')}
      {!baseline && (
        <div className="space-y-2">
          <label className="block space-y-2">
            Permanent code
            <RequiredMark />
            <Input
              id={scope + '-code'}
              aria-label="Permanent code"
              {...validation.props(
                scope + '-code',
                scope + '-site-code-guidance',
              )}
              disabled={disabled}
              value={values.code || suggestSiteCode(values.name)}
              maxLength={100}
              required
              pattern="[A-Z][A-Z0-9]*(-[A-Z0-9]+)*"
              onChange={(e) => update('code', e.target.value.toUpperCase())}
            />
          </label>
          {validation.error(scope + '-code')}
          <p
            id={scope + '-site-code-guidance'}
            className="text-sm text-slate-300"
          >
            Suggested from the name when possible; edit to override or enter a
            code manually if no suggestion appears.
          </p>
        </div>
      )}
      <label className="block space-y-2">
        Notes
        <textarea
          id={scope + '-notes'}
          aria-describedby={scope + '-notes-guidance'}
          className={field}
          disabled={disabled || !!lifecycle}
          value={values.notes}
          maxLength={2000}
          onChange={(e) => update('notes', e.target.value)}
        />
      </label>
      <p id={scope + '-notes-guidance'} className="text-sm text-slate-400">
        Notes are optional.
      </p>
      {stale && !uncertain && (
        <p role="alert">
          Site settings changed elsewhere. Your entries are retained. Cancel to
          load the latest settings before saving.
        </p>
      )}
      {baseline && (
        <>
          <p className="text-sm text-slate-300">
            {baseline.active ? 'Active site' : 'Archived site'} · Permanent
            code: {baseline.code}
          </p>
          {!lifecycle && (
            <Button
              type="button"
              disabled={disabled || dirty || stale}
              onClick={() => {
                setLifecycle({
                  active: !baseline.active,
                  version: baseline.version,
                });
                persist({
                  status: 'editing',
                  command: null,
                  completion: null,
                  lifecycle: {
                    active: !baseline.active,
                    version: baseline.version,
                  },
                });
                setState(null);
              }}
            >
              {baseline.active ? 'Archive site' : 'Restore site'}
            </Button>
          )}
          {dirty && (
            <p className="text-sm text-slate-300">
              Save or cancel your settings edits before changing site
              availability.
            </p>
          )}
          {lifecycle && (
            <section
              aria-label={
                lifecycle.active
                  ? 'Restore confirmation'
                  : 'Archive confirmation'
              }
              className="space-y-3 rounded-lg border border-amber-300/40 p-4"
            >
              <p>
                {lifecycle.active ? 'Restore' : 'Archive'} {baseline.name}?
                History and its permanent code are retained.{' '}
                {lifecycle.active
                  ? 'Restoring does not recreate previous assignments.'
                  : 'Archiving is blocked while any current assigned holdings remain. No gear is moved automatically.'}
              </p>
              {!lifecycle.active && (
                <>
                  <p>
                    {holdingTotal} current holdings must be resolved before
                    archiving.
                  </p>
                  <ul>
                    {holdings.map((row) => (
                      <li key={row.inventory_kind + row.entity_id}>
                        <Link
                          className="text-cyan-300 underline"
                          href={`/inventory/${row.inventory_kind === 'asset' ? 'assets' : 'quantity'}/${row.entity_id}`}
                        >
                          {row.name} · {row.quantity}{' '}
                          {row.inventory_kind === 'asset' ? 'asset' : 'units'}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Link
                    className="text-cyan-300 underline"
                    href={`/sites/${encodeURIComponent(baseline.code)}#site-holdings`}
                  >
                    Review all site holdings
                  </Link>
                </>
              )}
              <label className="block space-y-2">
                Reason
                <RequiredMark />
                <textarea
                  id={scope + '-reason'}
                  aria-label="Reason"
                  {...validation.props(scope + '-reason')}
                  required
                  maxLength={2000}
                  className={field}
                  disabled={disabled}
                  value={reason}
                  onChange={(e) => {
                    persist({ reason: e.target.value });
                    setReason(e.target.value);
                    setState(null);
                  }}
                />
              </label>
              {validation.error(scope + '-reason')}
            </section>
          )}
        </>
      )}
      {actorBlocked && (
        <p role="alert">
          Return to the original signed-in account to retry this submission.
        </p>
      )}
      {state && (
        <p
          role="status"
          className="experience-feedback"
          data-tone={state.ok ? 'success' : 'error'}
        >
          {state.ok
            ? 'Site saved. Code and history remain unchanged.'
            : state.message}
        </p>
      )}
      <ValidationSummary issues={validation.issues} />
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={pending || actorBlocked || (!uncertain && stale)}
          type="submit"
        >
          {pending
            ? 'Saving…'
            : uncertain
              ? 'Retry submission'
              : lifecycle
                ? lifecycle.active
                  ? 'Confirm restore site'
                  : 'Confirm archive site'
                : 'Save site'}
        </Button>
        {baseline && (
          <Button
            type="button"
            disabled={disabled}
            onClick={() => {
              const current =
                site && newer(site.version, baseline.version) ? site : baseline;
              if (
                !persist({
                  status: 'editing',
                  command: null,
                  completion: null,
                  baseline: current,
                  values: {
                    code: '',
                    name: current.name,
                    notes: current.notes ?? '',
                  },
                  lifecycle: null,
                  reason: '',
                })
              )
                return;
              setBaseline(current);
              setValues({
                code: '',
                name: current.name,
                notes: current.notes ?? '',
              });
              setLifecycle(null);
              setReason('');
              setState(null);
              validation.clear();
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function LocationManagementForm({
  location,
  actorId,
}: {
  location: ManagedLocation;
  actorId?: string;
}) {
  const scope = useId();
  const validation = useFormValidation();
  const { pending, uncertain, actorBlocked, state, setState, submit } =
    useSubmission(actorId);
  const [baseline, setBaseline] = useState(location);
  const [name, setName] = useState(location.name);
  const dirty = name !== baseline.name;
  const stale = newer(location.version, baseline.version);
  if (stale && !dirty && !pending && !uncertain) {
    setBaseline(location);
    setName(location.name);
  }
  return (
    <form
      className={panel + ' max-w-4xl space-y-4'}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (
          pending ||
          (!uncertain && !validation.validate(event.currentTarget))
        )
          return;
        if (stale && !uncertain) return;
        void submit(
          'location_rename',
          {
            location_id: baseline.id,
            expected_version: baseline.version,
            name,
          },
          (result, payload) => {
            const saved = {
              ...baseline,
              version: result.version,
              name: (payload.name as string).trim(),
            };
            setBaseline(saved);
            setName(saved.name);
          },
        );
      }}
    >
      <h2 className="break-words text-lg font-semibold">
        Rename {baseline.name}
      </h2>
      <RequiredFieldsNote />
      <p className="text-sm text-slate-300">
        Storage structure is maintained with reviewed room code. This action
        changes only the display name. Permanent code: {baseline.code}.
      </p>
      <label className="block space-y-2">
        Name
        <RequiredMark />
        <Input
          id={scope + '-name'}
          aria-label="Name"
          {...validation.props(scope + '-name')}
          value={name}
          required
          maxLength={200}
          disabled={pending || uncertain}
          onChange={(e) => {
            setName(e.target.value);
            setState(null);
          }}
        />
      </label>
      {validation.error(scope + '-name')}
      <ValidationSummary issues={validation.issues} />
      {stale && !uncertain && (
        <p role="alert">
          This location changed elsewhere. Your name edit is retained. Cancel to
          load the latest name before saving.
        </p>
      )}
      {actorBlocked && (
        <p role="alert">
          Return to the original signed-in account to retry this submission.
        </p>
      )}
      {state && (
        <p
          role="status"
          className="experience-feedback"
          data-tone={state.ok ? 'success' : 'error'}
        >
          {state.ok
            ? 'Location renamed. Structure, inventory and history remain intact.'
            : state.message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={actorBlocked || (stale && !uncertain)}
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          className="aria-disabled:cursor-wait aria-disabled:opacity-50 aria-disabled:transform-none"
          onClick={(event) => {
            // A pending native-disabled submit loses keyboard focus in Chrome.
            // Keep its focus while both this guard and onSubmit reject repeats.
            if (pending) event.preventDefault();
          }}
        >
          {pending ? 'Saving…' : uncertain ? 'Retry submission' : 'Save name'}
        </Button>
        <Button
          type="button"
          disabled={pending || uncertain}
          onClick={() => {
            const current = stale ? location : baseline;
            setBaseline(current);
            setName(current.name);
            setState(null);
            validation.clear();
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
