import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { StrictMode, useLayoutEffect, useRef } from 'react';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  invalidateAssignmentCallbacks,
} from '@/features/scan/assign-batch';
import {
  ScanFeedbackToggle,
  stopScanFeedback,
  useScanFeedback,
} from './scan-feedback';
const key = 'it-inventory-scan-feedback-v1';
const audio = {
  start: vi.fn(),
  stop: vi.fn(),
  resume: vi.fn(async () => {}),
  suspend: vi.fn(async () => {}),
  frequency: { value: 0 },
};
const contexts: FakeContext[] = [];
class FakeContext {
  state = 'running';
  currentTime = 10;
  destination = {};
  constructor() {
    contexts.push(this);
  }
  resume = audio.resume;
  suspend = audio.suspend;
  createOscillator() {
    return {
      frequency: audio.frequency,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: audio.start,
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
let cue: ReturnType<typeof useScanFeedback>;
function Probe() {
  const host = useRef<HTMLDivElement>(null);
  const feedback = useScanFeedback(host, 'test-scanner');
  useLayoutEffect(() => {
    cue = feedback;
  }, [feedback]);
  return (
    <div ref={host}>
      <ScanFeedbackToggle />
    </div>
  );
}
function managed(children = <Probe />, generation = 'verified') {
  return (
    <PrivacyReadinessContext.Provider
      value={{
        ready: true,
        visible: true,
        generation,
        verifiedEpoch: assignmentEpoch(),
        revocationRevision: readPrivacyRevocationRevision(),
      }}
    >
      {children}
    </PrivacyReadinessContext.Provider>
  );
}
beforeEach(() => {
  stopScanFeedback();
  localStorage.clear();
  const reset = render(<ScanFeedbackToggle />);
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
  reset.unmount();
  vi.clearAllMocks();
  vi.stubGlobal('AudioContext', FakeContext);
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  document.documentElement.dataset.motion = 'full';
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: vi.fn(),
  });
  audio.resume.mockImplementation(async () => {
    contexts.at(-1)!.state = 'running';
  });
});
afterEach(() => {
  stopScanFeedback();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function enable() {
  fireEvent.click(screen.getByRole('switch', { name: 'Scan sounds' }));
}
it('provides supported haptics after a trusted scanner action with sounds still off, and preserves a saved disable choice', () => {
  const view = render(managed());
  expect(screen.getByRole('switch', { name: /Scan vibrations/ })).toBeChecked();
  cue.prime(true);
  cue('decode', 'default-haptic');
  expect(navigator.vibrate).toHaveBeenLastCalledWith(20);
  expect(audio.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('switch', { name: /Scan vibrations/ }));
  view.unmount();
  render(managed());
  expect(
    screen.getByRole('switch', { name: /Scan vibrations/ }),
  ).not.toBeChecked();
  vi.mocked(navigator.vibrate).mockClear();
  cue.prime(true);
  cue('decode', 'disabled');
  expect(navigator.vibrate).not.toHaveBeenCalled();
});
it('defaults sound off and supported haptics on, persists explicit choices, and stays silent on load/toggle/untrusted activation', () => {
  const view = render(managed());
  expect(screen.getByRole('switch', { name: 'Scan sounds' })).not.toBeChecked();
  cue('decode', 'default');
  enable();
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
    sound: true,
    haptics: true,
  });
  expect(audio.start).not.toHaveBeenCalled();
  expect(navigator.vibrate).not.toHaveBeenCalled();
  cue.prime(false);
  cue('decode', 'untrusted');
  expect(audio.start).not.toHaveBeenCalled();
  expect(navigator.vibrate).not.toHaveBeenCalled();
  view.unmount();
  render(managed());
  expect(screen.getByRole('switch', { name: 'Scan sounds' })).toBeChecked();
  expect(audio.start).not.toHaveBeenCalled();
});
it('distinguishes decode, confirmed assignment, no-match and blocked outcomes and deduplicates identities', () => {
  render(managed());
  enable();
  cue.prime(true);
  cue('decode', 'decode:1');
  cue('decode', 'decode:1');
  expect(audio.start).toHaveBeenCalledOnce();
  expect(audio.frequency.value).toBe(660);
  expect(navigator.vibrate).toHaveBeenLastCalledWith(20);
  cue('assignment', 'event:1');
  expect(audio.frequency.value).toBe(990);
  expect(navigator.vibrate).toHaveBeenLastCalledWith([20, 35, 20]);
  cue('no-match', 'lookup:2');
  expect(audio.frequency.value).toBe(220);
  expect(navigator.vibrate).toHaveBeenLastCalledWith([60, 50, 60]);
  cue('blocked', 'lookup:3');
  expect(audio.frequency.value).toBe(150);
  expect(navigator.vibrate).toHaveBeenLastCalledWith([100, 50, 100]);
});
it('suppresses unmanaged, inert, hidden, invalidated and retired callbacks without replay after readmission', async () => {
  const view = render(managed(<Probe />, 'unmanaged'));
  enable();
  cue.prime(true);
  expect(cue('assignment', 'unmanaged')).toBe(false);
  expect(audio.start).not.toHaveBeenCalled();
  view.rerender(managed());
  cue.prime(true);
  const root = screen
    .getByRole('switch', { name: 'Scan sounds' })
    .closest('div')!.parentElement!;
  await act(async () => root.setAttribute('inert', ''));
  cue('decode', 'inert');
  expect(audio.start).not.toHaveBeenCalled();
  await act(async () => root.removeAttribute('inert'));
  cue.prime(true);
  cue('decode', 'inert');
  expect(audio.start).not.toHaveBeenCalled();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  cue('blocked', 'hidden');
  expect(audio.start).not.toHaveBeenCalled();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  act(() => invalidateAssignmentCallbacks());
  cue.prime(true);
  cue('assignment', 'stale');
  expect(audio.start).not.toHaveBeenCalled();
  view.unmount();
  const previous = vi.mocked(navigator.vibrate).mock.calls.length;
  cue('decode', 'retired');
  expect(navigator.vibrate).toHaveBeenCalledTimes(previous);
});
it('honors canonical reduced motion for vibrations while retaining optional sounds', () => {
  localStorage.setItem('it-inventory-reduce-motion', 'true');
  render(managed());
  enable();
  cue.prime(true);
  cue('decode', 'reduced');
  expect(navigator.vibrate).not.toHaveBeenCalled();
  expect(audio.start).toHaveBeenCalledOnce();
});
it('drops suspended audio, cancels deferred resume at teardown and does not queue a cue', async () => {
  const view = render(managed());
  enable();
  let finish!: () => void;
  const resumed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  audio.resume.mockImplementationOnce(() => {
    contexts.at(-1)!.state = 'suspended';
    return resumed.then(() => {
      contexts.at(-1)!.state = 'running';
    });
  });
  cue.prime(true);
  cue('decode', 'suspended');
  expect(audio.start).not.toHaveBeenCalled();
  view.unmount();
  const count = audio.suspend.mock.calls.length;
  await act(async () => {
    finish();
    await resumed;
  });
  expect(audio.suspend).toHaveBeenCalledTimes(count + 1);
  expect(audio.start).not.toHaveBeenCalled();
});
it('keeps volatile preferences usable under blocked storage and degrades quietly without feedback APIs', () => {
  render(managed());
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  enable();
  expect(screen.getByRole('switch', { name: 'Scan sounds' })).toBeChecked();
  vi.stubGlobal('AudioContext', undefined);
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: undefined,
  });
  cue.prime(true);
  expect(() => cue('blocked', 'unsupported')).not.toThrow();
});
it('survives StrictMode replay and disabling sounds cancels an active voice immediately', () => {
  render(<StrictMode>{managed()}</StrictMode>);
  enable();
  cue.prime(true);
  cue('decode', 'once');
  expect(audio.start).toHaveBeenCalledOnce();
  const stops = audio.stop.mock.calls.length;
  fireEvent.click(screen.getByRole('switch', { name: 'Scan sounds' }));
  expect(audio.stop.mock.calls.length).toBeGreaterThan(stops);
  cue('decode', 'silent');
  expect(audio.start).toHaveBeenCalledOnce();
});

const owned = new Map<string, ReturnType<typeof useScanFeedback>>();
function OwnedProbe({ name }: { name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const feedback = useScanFeedback(host, name);
  useLayoutEffect(() => {
    owned.set(name, feedback);
  });
  return <div ref={host}>Scanner {name}</div>;
}
it('binds trusted activation to its admitted owner and ignores retired cleanup and priming', () => {
  const tree = (show = true) =>
    managed(
      <>
        <ScanFeedbackToggle />
        {show && <OwnedProbe key="A" name="A" />}
        <OwnedProbe key="B" name="B" />
      </>,
    );
  const view = render(tree());
  enable();
  const a = owned.get('A')!,
    b = owned.get('B')!;
  a.prime(true);
  a('decode', 'a:1');
  expect(audio.start).toHaveBeenCalledOnce();
  b('decode', 'b:unprimed');
  expect(audio.start).toHaveBeenCalledOnce();
  b.prime(true);
  b('decode', 'b:1');
  expect(audio.start).toHaveBeenCalledTimes(2);
  const stops = audio.stop.mock.calls.length,
    suspends = audio.suspend.mock.calls.length;
  view.rerender(tree(false));
  a.stop();
  a.prime(true);
  a('assignment', 'a:late');
  expect(audio.stop).toHaveBeenCalledTimes(stops);
  expect(audio.suspend).toHaveBeenCalledTimes(suspends);
  b('assignment', 'b:2');
  expect(audio.start).toHaveBeenCalledTimes(3);
});
it.each(['root', 'os'])(
  'cancels a synchronous %s Reduced gap before effects, with opt-in sound allowed only after a fresh gesture',
  (mode) => {
    let os = false;
    vi.stubGlobal('matchMedia', () => ({
      matches: os,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(managed());
    enable();
    cue.prime(true);
    cue('decode', 'before');
    const starts = audio.start.mock.calls.length,
      stops = audio.stop.mock.calls.length;
    vi.mocked(navigator.vibrate).mockClear();
    if (mode === 'root') document.documentElement.dataset.motion = 'reduced';
    else os = true;
    cue('assignment', 'gap');
    expect(audio.start).toHaveBeenCalledTimes(starts);
    expect(audio.stop.mock.calls.length).toBeGreaterThan(stops);
    expect(navigator.vibrate).toHaveBeenCalledWith(0);
    cue('decode', 'no-auto-resume');
    expect(audio.start).toHaveBeenCalledTimes(starts);
    cue.prime(true);
    vi.mocked(navigator.vibrate).mockClear();
    cue('decode', 'fresh-reduced');
    expect(audio.start).toHaveBeenCalledTimes(starts + 1);
    expect(navigator.vibrate).not.toHaveBeenCalled();
  },
);
it('keeps generated voices at two and ignores a retired pending resume without suspending the successor', async () => {
  let finish!: () => void;
  const delayed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const tree = (show = true) =>
    managed(
      <>
        <ScanFeedbackToggle />
        {show && <OwnedProbe key="old" name="old" />}
        <OwnedProbe key="new" name="new" />
      </>,
    );
  const view = render(tree());
  enable();
  audio.resume.mockReturnValueOnce(delayed);
  const old = owned.get('old')!,
    next = owned.get('new')!;
  old.prime(true);
  next.prime(true);
  next('decode', '1');
  next('assignment', '2');
  next('blocked', '3');
  expect(audio.start).toHaveBeenCalledTimes(3);
  expect(
    audio.stop.mock.calls.filter((call) => call.length === 0),
  ).toHaveLength(1);
  view.rerender(tree(false));
  const suspends = audio.suspend.mock.calls.length;
  await act(async () => {
    finish();
    await delayed;
  });
  expect(audio.suspend).toHaveBeenCalledTimes(suspends);
  next('decode', '4');
  expect(audio.start).toHaveBeenCalledTimes(4);
});
it('observes cross-tab preference changes while only a scanner owner remains mounted', () => {
  const view = render(managed());
  enable();
  view.rerender(managed(<OwnedProbe name="scanner-only" />));
  const feedback = owned.get('scanner-only')!;
  feedback.prime(true);
  feedback('decode', 'before-storage');
  const starts = audio.start.mock.calls.length;
  localStorage.setItem(key, JSON.stringify({ sound: false, haptics: false }));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key })));
  feedback('assignment', 'after-storage');
  expect(audio.start).toHaveBeenCalledTimes(starts);
  feedback.prime(true);
  vi.mocked(navigator.vibrate).mockClear();
  feedback('decode', 'disabled');
  expect(audio.start).toHaveBeenCalledTimes(starts);
  expect(navigator.vibrate).not.toHaveBeenCalled();
});

it('does not lend a prior trusted activation to a later untrusted operation on the same scanner', () => {
  render(managed());
  enable();
  cue.prime(true);
  cue('decode', 'trusted');
  expect(audio.start).toHaveBeenCalledOnce();
  cue.prime(false);
  cue('assignment', 'untrusted-after-trusted');
  expect(audio.start).toHaveBeenCalledOnce();
});

it('retires the original scanner identity before a same-host replacement can prime feedback', () => {
  const tree = (name: string, key = 'same-host') =>
    managed(
      <>
        <ScanFeedbackToggle />
        <OwnedProbe key={key} name={name} />
      </>,
    );
  const view = render(tree('original'));
  enable();
  const original = owned.get('original')!;
  original.prime(true);
  original('decode', 'original:decode');
  expect(audio.start).toHaveBeenCalledOnce();
  view.rerender(tree('replacement'));
  const replacement = owned.get('replacement')!;
  original.prime(true);
  original('assignment', 'original:late');
  replacement.prime(true);
  replacement('decode', 'replacement:unremounted');
  expect(audio.start).toHaveBeenCalledOnce();
  view.rerender(tree('fresh', 'new-host'));
  const fresh = owned.get('fresh')!;
  fresh.prime(true);
  fresh('decode', 'fresh:decode');
  expect(audio.start).toHaveBeenCalledTimes(2);
});
