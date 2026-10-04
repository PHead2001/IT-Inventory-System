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

type Command = {
  operation: CustodyOperation;
  requestId: string;
  expectedActorId?: string;
  payload: Record<string, unknown>;
};

// Capture the exact operation for uncertain retry and close the synchronous
// double-click window before React has rendered disabled controls.
function useSubmission(actorId?: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<CustodyState | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [retryActor, setRetryActor] = useState<string | undefined>(actorId);
  const command = useRef<Command | null>(null);
  const running = useRef(false);
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
    if (running.current) return;
    const originalActor = actor.current;
    if (command.current && command.current.expectedActorId !== originalActor)
      return;
    const attempt = command.current ?? {
      operation,
      payload: structuredClone(payload),
      requestId: crypto.randomUUID(),
      expectedActorId: originalActor,
    };
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
    if (nextUncertain) setRetryActor(attempt.expectedActorId);
    setState(result);
    if (result.ok) {
      command.current = null;
      onSuccess(result, attempt.payload);
      router.refresh();
    } else if (!nextUncertain) {
      command.current = null;
      if (
        result.code === 'P1002' ||
        (result.code === 'P1008' && attempt.operation === 'site_set_active')
      )
        router.refresh();
    }
  };
  return { pending, uncertain, actorBlocked, state, setState, submit };
}

function newer(current: string, baseline: string) {
  return BigInt(current) > BigInt(baseline);
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
  const { pending, uncertain, actorBlocked, state, setState, submit } =
    useSubmission(actorId);
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
  const dirty =
    values.name !== (baseline?.name ?? '') ||
    values.notes !== (baseline?.notes ?? '') ||
    !!values.code;
  const stale = !!site && !!baseline && newer(site.version, baseline.version);
  if (
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
  const disabled = pending || uncertain;
  const update = (key: keyof typeof values, value: string) => {
    setValues((old) => ({ ...old, [key]: value }));
    setState(null);
  };
  const save = () => {
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
        }
        setLifecycle(null);
        setReason('');
      },
    );
  };
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
          disabled={pending || actorBlocked || (stale && !uncertain)}
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
