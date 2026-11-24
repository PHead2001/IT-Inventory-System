'use client';
import Link from '@/components/experience/route-link';
import {
  useCallback,
  useId,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  useRouteRouter as useRouter,
  useRouteTransition,
} from '@/components/experience/route-pending';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { useStrictPresentation } from '@/components/experience/strict-presentation';
import { SpringDisclosure } from '@/components/experience/spring-disclosure';
import { observeRouteActionResult } from '@/components/experience/route-action-result';
import { Button } from '@/components/ui/button';
import { LocationPicker } from '@/features/locations/location-picker';
import { useOperationalTimeZone } from '@/components/operational-time';
import {
  formatOperationalTimestamp,
  resolveDisplayTimeZone,
} from '@/lib/operational-time';
import {
  resolveActivityPreset,
  type ActivityPreset,
} from '@/features/custody/activity-range';
import {
  historyFilterParams,
  isHistoryEventCompatible,
  parseHistoryFilters,
  type HistoryParams,
} from '../history-filters';
import { historyEventLabel, historyEventNames } from '../history-summary';
import { searchHistoryActors } from '../history-actions';
import type { HistoryActor } from '../history-queries.server';
import type { LocationRef } from '../contracts-ui';
import { field, panel } from './read-ui';
import styles from './inventory-visual.module.css';

export function HistoryFilters({
  params,
  locations,
  actors,
  actorTotal,
  record,
  clearHref,
  memberId,
  backend,
}: {
  params: HistoryParams;
  locations: LocationRef[];
  actors: HistoryActor[];
  actorTotal: number;
  record: { id: string; name: string; kind: 'quantity' | 'asset' } | null;
  clearHref: string;
  memberId: string;
  backend: string;
}) {
  const router = useRouter();
  const instance = useId();
  const eventErrorId = instance + '-event-error';
  const typeHelpId = instance + '-type-help';
  const time = useOperationalTimeZone();
  const [pending, startTransition] = useRouteTransition();
  const applied = historyFilterParams(params, true).toString();
  const [draft, setDraft] = useState(params);
  const [signature, setSignature] = useState(applied);
  const draftRef = useRef(draft);
  const [requested, setRequested] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [preset, setPreset] = useState('custom');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  // Stale commits cannot replace a more recent draft/request (including A/B/A).
  if (signature !== applied) {
    setSignature(applied);
    if (!dirty && (requested === null || requested === applied)) {
      setDraft(params);
      setRequested(null);
    }
  }
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const cancel = () => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
  };
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peoplePage, setPeoplePage] = useState(1);
  const [peopleRequest, setPeopleRequest] = useState({
    query: peopleQuery,
    page: peoplePage,
    selected: draft.actor || null,
    actors,
    actorTotal,
    generation: 0,
  });
  const [peopleResponse, setPeopleResponse] = useState<{
    generation: number;
    data: { rows: HistoryActor[]; total: number };
    error: string;
  } | null>(null);
  const host = useRef<HTMLElement>(null);
  const privacy = usePrivacyReadiness();
  const authority = `${memberId}:${backend}:${privacy.generation}:${privacy.verifiedEpoch}:${privacy.revocationRevision}`;
  const deniedScope = useRef<string | null>(null);
  const revision = useRef(0);
  const admitted = useRef(false);
  const [visible, setVisible] = useState(false);
  const peopleSource = useRef(Symbol('history-people'));
  const withdraw = useCallback(() => {
    if (!admitted.current) return;
    revision.current++;
    admitted.current = false;
    cancel();
    composing.current = false;
    draftRef.current = {};
    setDraft({});
    setDirty(false);
    setRequested(null);
    setPreset('custom');
    setPeopleQuery('');
    setPeoplePage(1);
    setPeopleResponse(null);
    setVisible(false);
  }, []);
  const currentRef = useRef<() => boolean>(() => false);
  const restoreParams = useRef(params);
  useLayoutEffect(() => {
    restoreParams.current = params;
  }, [params]);
  const readmit = useCallback(() => {
    if (
      !currentRef.current() ||
      admitted.current ||
      deniedScope.current === authority
    )
      return;
    admitted.current = true;
    draftRef.current = restoreParams.current;
    setDraft(restoreParams.current);
    setVisible(true);
  }, [authority]);
  const current = useStrictPresentation(
    host,
    memberId + ':' + backend,
    withdraw,
    readmit,
  );
  useLayoutEffect(() => {
    currentRef.current = current;
    readmit();
    return () => {
      currentRef.current = () => false;
    };
  }, [current, readmit]);
  const lifetime = revision.current;
  const owned = useCallback(
    () => current() && admitted.current && revision.current === lifetime,
    [current, lifetime],
  );
  useEffect(() => {
    const restore = (next: HistoryParams) => {
      if (!owned()) return;
      cancel();
      composing.current = false;
      setDirty(false);
      setRequested(null);
      setPreset('custom');
      draftRef.current = next;
      setDraft(next);
    };
    const back = () =>
      restore(Object.fromEntries(new URLSearchParams(window.location.search)));
    const click = (event: MouseEvent) => {
      if (!owned()) return;
      if (
        event.defaultPrevented ||
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
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      )
        return;
      const target = new URL(anchor.href, window.location.href);
      if (
        target.origin !== window.location.origin ||
        target.pathname.startsWith('/api/')
      )
        return;
      if (
        target.pathname === window.location.pathname &&
        target.search === window.location.search &&
        target.hash
      )
        return;
      if (target.pathname === '/history')
        restore(Object.fromEntries(target.searchParams));
      else {
        cancel();
        setDirty(false);
        setRequested(null);
      }
    };
    window.addEventListener('popstate', back);
    document.addEventListener('click', click, true);
    return () => {
      cancel();
      window.removeEventListener('popstate', back);
      document.removeEventListener('click', click, true);
    };
  }, [owned]);
  const navigate = (next: HistoryParams, deliberate: boolean) => {
    cancel();
    if (!owned() || !parseHistoryFilters(next).valid) return;
    setDirty(false);
    const query = historyFilterParams(next, true).toString();
    setRequested(query);
    const href = '/history' + (query ? '?' + query : '');
    startTransition(() =>
      deliberate
        ? router.push(href, { scroll: false })
        : router.replace(href, { scroll: false }),
    );
  };
  const update = (changes: HistoryParams, deliberate = true) => {
    if (!owned()) return;
    const next: HistoryParams = {
      ...draftRef.current,
      ...changes,
      page: undefined,
    };
    if (record) {
      next.entityId = record.id;
      next.type = record.kind;
    }
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    cancel();
    if (deliberate) navigate(next, true);
    else if (!composing.current)
      debounce.current = setTimeout(
        () => navigate(draftRef.current, false),
        250,
      );
  };
  // A new input owns a new request even when the query returns to an earlier value.
  if (
    peopleRequest.query !== peopleQuery ||
    peopleRequest.page !== peoplePage ||
    peopleRequest.selected !== (draft.actor || null) ||
    peopleRequest.actors !== actors ||
    peopleRequest.actorTotal !== actorTotal
  ) {
    setPeopleRequest({
      query: peopleQuery,
      page: peoplePage,
      selected: draft.actor || null,
      actors,
      actorTotal,
      generation: peopleRequest.generation + 1,
    });
  }
  const latestPeopleRequest = useRef(peopleRequest);
  useLayoutEffect(() => {
    // Retire a committed replacement before passive-effect cleanup can run.
    latestPeopleRequest.current = peopleRequest;
  }, [peopleRequest]);
  const searchingPeople = Boolean(
    peopleRequest.query || peopleRequest.page !== 1,
  );
  const people =
    searchingPeople && peopleResponse
      ? peopleResponse.data
      : { rows: actors, total: actorTotal };
  const peoplePending =
    searchingPeople && peopleResponse?.generation !== peopleRequest.generation;
  const peopleError =
    searchingPeople && !peoplePending ? (peopleResponse?.error ?? '') : '';
  useEffect(() => {
    if (
      !visible ||
      !owned() ||
      (!peopleRequest.query && peopleRequest.page === 1)
    )
      return;
    let requestLive = true;
    // The central denial observer runs before .then: component ownership alone
    // would let an older query/page denial suppress this same-scope successor.
    const requestCurrent = () =>
      requestLive && owned() && latestPeopleRequest.current === peopleRequest;
    const timer = setTimeout(() => {
      if (!requestCurrent()) return;
      observeRouteActionResult(
        searchHistoryActors(
          peopleRequest.query,
          peopleRequest.selected,
          peopleRequest.page,
          memberId,
          backend,
        ),
        requestCurrent,
        peopleSource.current,
      ).then(
        (data) => {
          if (!requestCurrent()) return;
          if ('ok' in data) {
            deniedScope.current = authority;
            withdraw();
            return;
          }
          setPeopleResponse({
            generation: peopleRequest.generation,
            data,
            error: '',
          });
        },
        () => {
          if (requestCurrent())
            setPeopleResponse((previous) => ({
              generation: peopleRequest.generation,
              data: previous?.data ?? {
                rows: peopleRequest.actors,
                total: peopleRequest.actorTotal,
              },
              error: 'People could not be loaded. Try searching again.',
            }));
        },
      );
    }, 250);
    return () => {
      requestLive = false;
      clearTimeout(timer);
    };
  }, [peopleRequest, visible, owned, memberId, backend, withdraw, authority]);
  const filter = parseHistoryFilters(draft);
  const eventKind = record?.kind ?? filter.type;
  const zone = draft.zone ?? time.timeZone;
  const [expanded] = useState(
    Boolean(
      record ||
      params.type ||
      params.q ||
      params.location ||
      params.eventType ||
      params.from ||
      params.until,
    ),
  );
  const stale = historyFilterParams(draft, true).toString() !== applied;
  const exportEnabled =
    visible &&
    filter.valid &&
    parseHistoryFilters(params).valid &&
    !stale &&
    !pending;
  const exportParams = historyFilterParams(params);
  exportParams.set('displayTimeZone', zone);
  const appliedFilter = parseHistoryFilters(params);
  const personLabel = (actor: HistoryActor) => {
    if (actor.same_name_count === 1) return actor.actor_name;
    const first =
      formatOperationalTimestamp(
        actor.first_recorded_at,
        resolveDisplayTimeZone(zone),
      )?.text ?? 'date unavailable';
    return `${actor.actor_name} · first activity ${first} · Person ${actor.name_ordinal}`;
  };
  const chooseRange = (value: string) => {
    if (!owned()) return;
    setPreset(value);
    if (value === 'custom') return;
    if (value === 'all') {
      update({ from: undefined, until: undefined, zone });
      return;
    }
    try {
      const range = resolveActivityPreset(
        (value === 'movements-lastweek' ? 'lastweek' : value) as Exclude<
          ActivityPreset,
          'custom'
        >,
        zone,
      );
      update({
        ...range,
        zone,
        ...(value === 'movements-lastweek' ? { eventType: 'movements' } : {}),
      });
    } catch {
      update({ zone: 'invalid' });
    }
  };
  return (
    <section
      ref={host}
      className={panel + ' mb-4 space-y-3'}
      aria-label="Filter history"
    >
      {visible && (
        <>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!composing.current) navigate(draftRef.current, true);
            }}
          >
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="min-w-0">
                Person
                <select
                  className={field}
                  value={draft.actor ?? ''}
                  onChange={(e) => update({ actor: e.target.value })}
                >
                  <option value="">Everyone</option>
                  {draft.actor &&
                    !people.rows.some((a) => a.actor_id === draft.actor) && (
                      <option value={draft.actor}>
                        Selected person unavailable
                      </option>
                    )}
                  {people.rows.map((actor) => (
                    <option key={actor.actor_id} value={actor.actor_id}>
                      {personLabel(actor)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Activity range
                <select
                  className={field}
                  value={preset}
                  onChange={(e) => chooseRange(e.target.value)}
                >
                  <option value="custom">Custom / applied dates</option>
                  <option value="all">All dates</option>
                  <option value="movements-lastweek">
                    Movements last week
                  </option>
                  <option value="lastweek">Last week</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7">Last 7 days</option>
                </select>
              </label>
            </div>
            <SpringDisclosure
              className="mt-3"
              summary="Find a person in history"
              summaryProps={{
                className: 'min-h-11 cursor-pointer py-2 text-sm',
              }}
            >
              <label>
                Person name
                <input
                  className={field}
                  value={peopleQuery}
                  onChange={(e) => {
                    if (!owned()) return;
                    setPeopleQuery(e.target.value);
                    setPeoplePage(1);
                  }}
                />
              </label>
              <p className="text-sm" role="status">
                {peoplePending
                  ? 'Finding people…'
                  : `${people.total} people in recorded history`}
              </p>
              {peopleError && <p role="alert">{peopleError}</p>}
              {peoplePage > 1 && (
                <Button
                  type="button"
                  onClick={() => {
                    if (owned()) setPeoplePage((p) => p - 1);
                  }}
                >
                  Previous people
                </Button>
              )}
              {peoplePage * 50 < people.total && (
                <Button
                  type="button"
                  onClick={() => {
                    if (owned()) setPeoplePage((p) => p + 1);
                  }}
                >
                  More people
                </Button>
              )}
            </SpringDisclosure>
            <SpringDisclosure
              open={expanded}
              summary="More filters"
              summaryProps={{
                className:
                  'experience-filter-toggle mt-2 min-h-11 cursor-pointer py-2',
              }}
              className="mt-3 grid gap-3 sm:grid-cols-2"
            >
              <label>
                Item or tag search
                <input
                  className={field}
                  value={draft.q ?? ''}
                  onChange={(e) => update({ q: e.target.value }, false)}
                  onCompositionStart={() => {
                    if (!owned()) return;
                    composing.current = true;
                    cancel();
                  }}
                  onCompositionEnd={(e) => {
                    if (!owned()) return;
                    composing.current = false;
                    update({ q: e.currentTarget.value }, false);
                  }}
                  placeholder="Name, item code, tag or serial"
                />
              </label>
              <label>
                Tracking type
                <select
                  className={field}
                  value={record?.kind ?? draft.type ?? 'all'}
                  disabled={Boolean(record)}
                  onChange={(e) => update({ type: e.target.value })}
                  aria-describedby={record ? typeHelpId : undefined}
                >
                  <option value="all">All types</option>
                  <option value="quantity">Quantity items</option>
                  <option value="asset">Individual assets</option>
                </select>
              </label>
              <label>
                Event type
                <select
                  className={field}
                  value={draft.eventType ?? 'all'}
                  onChange={(e) => update({ eventType: e.target.value })}
                  aria-invalid={Boolean(filter.errors.eventType)}
                  aria-describedby={
                    filter.errors.eventType ? eventErrorId : undefined
                  }
                >
                  <option value="all">All events</option>
                  <option value="movements">Movements</option>
                  {Object.keys(historyEventNames).map((value) => (
                    <option
                      key={value}
                      value={value}
                      disabled={!isHistoryEventCompatible(eventKind, value)}
                    >
                      {historyEventLabel(
                        value,
                        (eventKind === 'quantity' || eventKind === 'asset') &&
                          isHistoryEventCompatible(eventKind, value)
                          ? eventKind
                          : undefined,
                      )}
                    </option>
                  ))}
                </select>
              </label>
              {filter.errors.eventType && (
                <Button
                  type="button"
                  onClick={() => update({ eventType: 'all' })}
                >
                  Clear event type
                </Button>
              )}
              <LocationPicker
                id={instance + '-location'}
                label="Location"
                locations={locations}
                mode="browse"
                value={draft.location ?? ''}
                onValueChange={(location) => update({ location })}
                allowAll
              />
              <label>
                From (UTC, inclusive)
                <input
                  className={field}
                  value={draft.from ?? ''}
                  aria-invalid={Boolean(filter.errors.from)}
                  onChange={(e) => {
                    if (!owned()) return;
                    setPreset('custom');
                    update({ from: e.target.value }, false);
                  }}
                />
              </label>
              <label>
                Until (UTC, exclusive)
                <input
                  className={field}
                  value={draft.until ?? ''}
                  aria-invalid={Boolean(filter.errors.until)}
                  onChange={(e) => {
                    if (!owned()) return;
                    setPreset('custom');
                    update({ until: e.target.value }, false);
                  }}
                />
              </label>
              <label>
                Display / preset timezone
                <select
                  className={field}
                  value={zone}
                  onChange={(e) => update({ zone: e.target.value })}
                >
                  {Array.from(new Set([zone, time.timeZone, 'UTC'])).map(
                    (value) => (
                      <option key={value} value={value}>
                        {resolveDisplayTimeZone(value).fallback
                          ? 'Unavailable timezone'
                          : value}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </SpringDisclosure>
            {record && (
              <p id={typeHelpId} className="mt-3 text-sm">
                Tracking type is locked to this record. Record:{' '}
                <Link
                  href={`/inventory/${record.kind === 'quantity' ? 'quantity' : 'assets'}/${record.id}`}
                  className={`text-cyan-300 underline ${styles.textTarget}`}
                >
                  {record.name}
                </Link>
                .{' '}
                <Link
                  href={clearHref}
                  className={`text-cyan-300 underline ${styles.textTarget}`}
                >
                  Clear record filter
                </Link>
              </p>
            )}
            {Object.entries(filter.errors).map(([key, message]) => (
              <p
                key={key}
                id={key === 'eventType' ? eventErrorId : undefined}
                role="alert"
                className="mt-2 text-sm text-amber-200"
              >
                {message}
              </p>
            ))}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!filter.valid}>
                Apply history filters
              </Button>
              {exportEnabled ? (
                <a
                  href={'/api/exports/history?' + exportParams}
                  onClick={(event) => {
                    if (!owned()) event.preventDefault();
                  }}
                  className="inline-flex min-h-11 items-center text-cyan-300 underline"
                >
                  Export history CSV
                </a>
              ) : (
                <span
                  aria-disabled="true"
                  className="inline-flex min-h-11 items-center text-sm experience-muted"
                >
                  Export history CSV
                </span>
              )}
            </div>
          </form>
          <p role="status" className="text-sm experience-muted">
            {!filter.valid
              ? 'Check filter errors before applying or exporting.'
              : stale || pending
                ? 'Updating filters. Export becomes available when displayed results match.'
                : 'Results and export use the applied filters.'}
          </p>
          <p className="text-sm experience-muted">
            CSV includes one event row and its quantity lines. New activity may
            change a download; the file records its snapshot time.
          </p>
          {appliedFilter.valid &&
            (appliedFilter.from || appliedFilter.until) && (
              <p className="break-words text-sm">
                Applied instants (UTC; preset / display zone:{' '}
                {params.zone ?? time.timeZone}):{' '}
                {appliedFilter.from ?? 'Unbounded'} inclusive →{' '}
                {appliedFilter.until ?? 'Unbounded'} exclusive.
              </p>
            )}
        </>
      )}
    </section>
  );
}
