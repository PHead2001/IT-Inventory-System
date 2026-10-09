import type { ScanMatch } from './resolve.server';
import type {
  AssignmentCandidate,
  AssignmentCommand,
  AssignmentContext,
  AssignmentSuccess,
  AssignmentSearchPage,
} from './assign-contracts';

export type AssignState = {
  phase:
    | 'ready'
    | 'lookup'
    | 'choose'
    | 'review'
    | 'pending'
    | 'unknown'
    | 'conflict';
  generation: number;
  context: AssignmentContext | null;
  candidate: AssignmentCandidate | null;
  matches: ScanMatch[];
  search: AssignmentSearchPage | null;
  sourceId: string;
  units: string;
  command: AssignmentCommand | null;
  receipt: {
    result: AssignmentSuccess;
    name: string;
    sourceName: string;
    siteName: string;
    units: string;
    reference: string;
    kind: AssignmentCandidate['kind'];
    entityId: string;
  } | null;
  message: string;
};
export const initialAssignState = (
  context: AssignmentContext | null,
): AssignState => ({
  phase: 'ready',
  generation: 0,
  context,
  candidate: null,
  matches: [],
  search: null,
  sourceId: '',
  units: '1',
  command: null,
  receipt: null,
  message: '',
});
export type AssignEvent =
  | { type: 'hydrate'; snapshot: AssignState }
  | { type: 'context'; context: AssignmentContext | null; generation: number }
  | { type: 'lookup'; generation: number }
  | {
      type: 'matches';
      generation: number;
      matches: ScanMatch[];
      message: string;
      searchPage?: AssignmentSearchPage;
    }
  | {
      type: 'candidate';
      generation: number;
      candidate: AssignmentCandidate;
      sourceId: string;
      units?: string;
      message?: string;
    }
  | { type: 'error'; generation: number; message: string }
  | { type: 'edit'; sourceId?: string; units?: string }
  | { type: 'pending'; command: AssignmentCommand }
  | { type: 'unknown'; message: string }
  | { type: 'rejected'; message: string }
  | { type: 'committed'; result: AssignmentSuccess }
  | {
      type: 'receipt';
      eventId: string;
      custody: NonNullable<AssignmentSuccess['custody']>;
    }
  | {
      type: 'restore';
      context: AssignmentContext;
      candidate: AssignmentCandidate;
      command: AssignmentCommand;
      sourceId: string;
      units: string;
    }
  | { type: 'next'; generation: number };
export function assignReducer(
  state: AssignState,
  event: AssignEvent,
): AssignState {
  const unresolved = state.phase === 'pending' || state.phase === 'unknown';
  if (event.type === 'hydrate') return event.snapshot;
  if (event.type === 'restore')
    return {
      ...state,
      phase: 'unknown',
      context: event.context,
      candidate: event.candidate,
      command: event.command,
      sourceId: event.sourceId,
      units: event.units,
      message:
        'An earlier assignment is unconfirmed. Retry its exact request before continuing.',
    };
  if (event.type === 'pending')
    return state.phase === 'review' || state.phase === 'unknown'
      ? { ...state, phase: 'pending', command: event.command, message: '' }
      : state;
  if (event.type === 'unknown')
    return unresolved
      ? { ...state, phase: 'unknown', message: event.message }
      : state;
  if (event.type === 'receipt')
    return state.receipt?.result.eventId === event.eventId
      ? {
          ...state,
          receipt: {
            ...state.receipt,
            result: { ...state.receipt.result, custody: event.custody },
          },
        }
      : state;
  if (event.type === 'committed')
    return unresolved && state.candidate && state.context
      ? {
          ...state,
          phase: 'ready',
          receipt: {
            result: event.result,
            name: state.candidate.name,
            sourceName:
              state.candidate.sources.find(
                (source) => source.id === state.sourceId,
              )?.name ?? state.sourceId,
            siteName: state.context.siteName,
            units: state.units,
            reference: state.context.reference,
            kind: state.candidate.kind,
            entityId: state.candidate.id,
          },
          candidate: null,
          command: null,
          matches: [],
          sourceId: '',
          units: '1',
          message: 'Assignment confirmed. Ready for the next scan.',
        }
      : state;
  if (event.type === 'rejected')
    return unresolved
      ? { ...state, phase: 'conflict', command: null, message: event.message }
      : state;
  if (unresolved) return state;
  if (
    'generation' in event &&
    event.type !== 'lookup' &&
    event.type !== 'context' &&
    event.type !== 'next' &&
    event.generation !== state.generation
  )
    return state;
  switch (event.type) {
    case 'context':
      return {
        ...initialAssignState(event.context),
        generation: event.generation,
        receipt: state.receipt,
      };
    case 'lookup':
      return {
        ...state,
        phase: 'lookup',
        generation: event.generation,
        candidate: null,
        matches: [],
        search: null,
        command: null,
        message: '',
      };
    case 'matches':
      return {
        ...state,
        phase: event.matches.length ? 'choose' : 'ready',
        matches: event.matches,
        search: event.searchPage ?? null,
        message: event.message,
      };
    case 'candidate':
      return {
        ...state,
        phase: 'review',
        candidate: event.candidate,
        matches: [],
        sourceId: event.sourceId,
        units: event.units ?? '1',
        message: event.message ?? '',
      };
    case 'error':
      return {
        ...state,
        phase: 'ready',
        candidate: null,
        matches: [],
        message: event.message,
      };
    case 'edit':
      return state.phase === 'review'
        ? {
            ...state,
            sourceId: event.sourceId ?? state.sourceId,
            units: event.units ?? state.units,
            context:
              event.sourceId !== undefined && state.context
                ? { ...state.context, sourceId: event.sourceId }
                : state.context,
          }
        : state;
    case 'next':
      return {
        ...state,
        phase: 'ready',
        generation: event.generation,
        candidate: null,
        matches: [],
        search: null,
        command: null,
        sourceId: '',
        units: '1',
        message: '',
      };
    default:
      return state;
  }
}

export function createDetectionGate() {
  let blocked: string | null = null;
  let misses = 0;
  return {
    observe(value: string | null, ready: boolean) {
      if (!value) {
        if (++misses >= 3) blocked = null;
        return false;
      }
      misses = 0;
      if (!ready || value === blocked) return false;
      blocked = value;
      return true;
    },
    rescan() {
      blocked = null;
      misses = 0;
    },
  };
}
