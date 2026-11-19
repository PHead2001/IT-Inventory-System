import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLayoutEffect, type ReactNode } from 'react';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import { AssignmentWorkspace } from './assign-workspace';
import { AssignCamera, type CameraOutcome } from './assign-camera';
import {
  adoptAssignmentScope,
  invalidateAssignmentCallbacks,
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from './assign-batch';
import {
  ScanFeedbackToggle,
  stopScanFeedback,
  type useScanFeedback,
} from '@/components/experience/scan-feedback';

const mocks = vi.hoisted(() => ({
  owners: new Map<string, ReturnType<typeof useScanFeedback>>(),
  sessions: [] as {
    detection: (result: { getText(): string } | null) => void;
    stop: ReturnType<typeof vi.fn>;
  }[],
  outcomes: [] as CameraOutcome[],
  find: vi.fn(),
  inspect: vi.fn(),
}));
// Expose actual hook instances, without replacing their owners/cues/activation.
// JSDOM cannot create trusted browser gestures; prime(true) is the explicit
// activation seam, while audio/vibration and camera I/O are platform doubles.
vi.mock('@/components/experience/scan-feedback', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/components/experience/scan-feedback')
    >();
  return {
    ...actual,
    useScanFeedback: function useObservedFeedback(
      ...args: Parameters<typeof actual.useScanFeedback>
    ) {
      const feedback = actual.useScanFeedback(...args);
      useLayoutEffect(() => {
        mocks.owners.set(args[1], feedback);
      }, [args, feedback]);
      return feedback;
    },
  };
});
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/scan/assign',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./assign-actions', () => ({
  findAssignmentRecords: mocks.find,
  inspectAssignmentRecord: mocks.inspect,
}));
vi.mock('@/features/custody/actions', () => ({
  submitCustody: vi.fn(),
  loadCustodyReceipt: vi.fn(),
}));
vi.mock('./inventory-code-reader', () => ({ InventoryCodeReader: class {} }));
vi.mock('./assign-camera', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./assign-camera')>();
  return {
    ...actual,
    AssignCamera: (props: React.ComponentProps<typeof actual.AssignCamera>) => (
      <actual.AssignCamera
        {...props}
        onDetection={(value, outcome) => {
          mocks.outcomes.push(outcome);
          return props.onDetection(value, outcome);
        }}
      />
    ),
  };
});
vi.mock('./camera-session', () => ({
  createCameraSession: (
    _reader: unknown,
    _video: unknown,
    detection: (result: { getText(): string } | null) => void,
  ) => {
    const session = { detection, stop: vi.fn(), start: async () => true };
    mocks.sessions.push(session);
    return session;
  },
}));
const audio = { start: vi.fn(), stop: vi.fn(), frequencies: [] as number[] };
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  resume = async () => {
    this.state = 'running';
  };
  suspend = async () => {
    this.state = 'suspended';
  };
  createOscillator() {
    const frequency = { value: 0 };
    return {
      frequency,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: () => {
        audio.start();
        audio.frequencies.push(frequency.value);
      },
      stop: audio.stop,
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
}
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const site = {
  id: id(1),
  name: 'Headquarters',
  code: 'HQ',
  active: true,
  version: '1',
  notes: null,
};
const props = {
  actorId: id(2),
  backend: 'https://isolated.supabase.co',
  sites: [site],
  initialSiteId: site.id,
  locations: [],
};
const noMatch = { ok: true, status: 'unknown', matches: [] };
function managed(children: ReactNode) {
  return (
    <PrivacyReadinessContext.Provider
      value={{
        ready: true,
        visible: true,
        generation: 'verified',
        verifiedEpoch: assignmentEpoch(),
        revocationRevision: readPrivacyRevocationRevision(),
      }}
    >
      {children}
    </PrivacyReadinessContext.Provider>
  );
}
function renderManaged(children: ReactNode) {
  return render(managed(children));
}
beforeEach(() => {
  stopScanFeedback();
  sessionStorage.clear();
  localStorage.clear();
  const reset = render(<ScanFeedbackToggle />);
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
  reset.unmount();
  mocks.owners.clear();
  mocks.sessions.length = 0;
  mocks.outcomes.length = 0;
  adoptAssignmentScope({
    actor: props.actorId,
    origin: window.location.origin,
    backend: props.backend,
  });
  vi.clearAllMocks();
  audio.frequencies = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  document.documentElement.dataset.motion = 'full';
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  mocks.find.mockResolvedValue(noMatch);
});
afterEach(() => {
  stopScanFeedback();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function start() {
  fireEvent.click(await screen.findByRole('button', { name: 'Start camera' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Stop camera' })).toBeEnabled(),
  );
  await waitFor(() => expect(mocks.sessions.length).toBeGreaterThan(0));
  mocks.owners.get('assignment-camera')!.prime(true);
  await act(async () => {});
}
function enableSound() {
  fireEvent.click(screen.getByRole('switch', { name: 'Scan sounds' }));
}

it.each(['no-match', 'lookup-blocked', 'inspection-blocked'])(
  'joins accepted camera decode to its own %s audio and haptics',
  async (outcome) => {
    if (outcome === 'lookup-blocked')
      mocks.find.mockResolvedValue({ ok: false, message: 'Lookup blocked.' });
    if (outcome === 'inspection-blocked') {
      mocks.find.mockResolvedValue({
        ok: true,
        status: 'found',
        matches: [
          {
            path: '/inventory/quantity/' + id(4),
            kind: 'quantity',
            label: 'Adapters',
            state: 'active',
          },
        ],
      });
      mocks.inspect.mockResolvedValue({
        ok: false,
        message: 'Inspection blocked.',
      });
    }
    renderManaged(
      <>
        <ScanFeedbackToggle />
        <AssignmentWorkspace {...props} />
      </>,
    );
    enableSound();
    await start();
    expect(mocks.owners.get('assignment-camera')).not.toBe(
      mocks.owners.get(props.actorId + ':' + props.backend),
    );
    act(() => mocks.sessions[0].detection({ getText: () => 'MISSING' }));
    await waitFor(() => expect(audio.start).toHaveBeenCalledTimes(2));
    expect(audio.frequencies[0]).not.toBe(audio.frequencies[1]);
    expect(navigator.vibrate).toHaveBeenCalledWith(20);
    expect(navigator.vibrate).toHaveBeenCalledWith(
      outcome === 'no-match' ? [60, 50, 60] : [100, 50, 100],
    );
  },
);

it('gives a trusted chooser selection its own workspace activation and ignores the older camera outcome', async () => {
  mocks.find.mockResolvedValue({
    ok: true,
    status: 'found',
    matches: [
      {
        path: '/inventory/quantity/' + id(4),
        kind: 'quantity',
        label: 'Adapters',
        state: 'active',
      },
      {
        path: '/inventory/quantity/' + id(5),
        kind: 'quantity',
        label: 'Cables',
        state: 'active',
      },
    ],
  });
  let settle!: (result: unknown) => void;
  mocks.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  renderManaged(
    <>
      <ScanFeedbackToggle />
      <AssignmentWorkspace {...props} />
    </>,
  );
  enableSound();
  await start();
  act(() => mocks.sessions[0].detection({ getText: () => 'AMBIGUOUS' }));
  const choose = await screen.findByRole('button', {
    name: /Adapters.*Quantity item/,
  });
  const oldCameraOutcome = mocks.outcomes[0];
  const workspace = mocks.owners.get(props.actorId + ':' + props.backend)!;
  const prime = workspace.prime;
  // Model the chooser's native trusted click at the same activation seam used
  // for Start. Calling this spy is required: no direct test-only activation.
  const gesture = vi
    .spyOn(workspace, 'prime')
    .mockImplementation(() => prime(true));
  try {
    fireEvent.click(choose);
    expect(gesture).toHaveBeenCalledExactlyOnceWith(false); // JSDOM native event
    expect(mocks.inspect).toHaveBeenCalledOnce();
    await act(async () => {});
    const count = audio.start.mock.calls.length;
    act(() => oldCameraOutcome('blocked', 'older-camera-outcome'));
    expect(audio.start).toHaveBeenCalledTimes(count);
    await act(async () =>
      settle({ ok: false, message: 'Chosen inspection blocked.' }),
    );
    expect(audio.start).toHaveBeenCalledTimes(count + 1);
    expect(audio.frequencies.at(-1)).toBe(150);
    expect(navigator.vibrate).toHaveBeenLastCalledWith([100, 50, 100]);
  } finally {
    if (settle)
      await act(async () =>
        settle({ ok: false, message: 'Chosen inspection blocked.' }),
      );
    gesture.mockRestore();
  }
});

it.each(['stop', 'restart', 'successor', 'privacy'])(
  'rejects a pending camera outcome after %s without borrowing another owner',
  async (retirement) => {
    let settle!: (result: unknown) => void;
    mocks.find.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const view = renderManaged(
      <>
        <ScanFeedbackToggle />
        <AssignmentWorkspace {...props} />
      </>,
    );
    enableSound();
    await start();
    act(() => mocks.sessions[0].detection({ getText: () => 'PENDING' }));
    expect(audio.start).toHaveBeenCalledOnce();
    try {
      if (retirement === 'privacy') act(() => invalidateAssignmentCallbacks());
      else {
        fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
        if (retirement === 'restart') await start();
        if (retirement === 'successor') {
          view.unmount();
          renderManaged(
            <>
              <ScanFeedbackToggle />
              <AssignmentWorkspace {...props} />
            </>,
          );
          await start();
        }
      }
      const count = audio.start.mock.calls.length;
      vi.mocked(navigator.vibrate).mockClear();
      await act(async () => settle(noMatch));
      expect(audio.start).toHaveBeenCalledTimes(count);
      expect(navigator.vibrate).not.toHaveBeenCalledWith([60, 50, 60]);
    } finally {
      await act(async () => settle(noMatch));
    }
  },
);

it('expires the actual captured capability on stop, restart, scope replacement and privacy', async () => {
  let outcome!: CameraOutcome;
  const view = renderManaged(
    <AssignCamera
      scope="first"
      onDetection={(_value, cue) => {
        outcome = cue;
        return true;
      }}
    />,
  );
  await start();
  act(() => mocks.sessions[0].detection({ getText: () => 'ONE' }));
  const first = outcome;
  fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
  expect(first('blocked', 'stopped')).toBe(false);
  await start();
  expect(first('blocked', 'restarted')).toBe(false);
  act(() => mocks.sessions[1].detection({ getText: () => 'TWO' }));
  const second = outcome;
  view.rerender(
    managed(
      <AssignCamera
        scope="successor"
        onDetection={(_value, cue) => {
          outcome = cue;
          return true;
        }}
      />,
    ),
  );
  expect(second('blocked', 'replaced')).toBe(false);
  await start();
  act(() => mocks.sessions[2].detection({ getText: () => 'THREE' }));
  const third = outcome;
  act(() => invalidateAssignmentCallbacks());
  expect(third('blocked', 'withdrawn')).toBe(false);
});
