import { act, fireEvent, render, screen } from '@testing-library/react';
import { Activity, useContext, useLayoutEffect } from 'react';
import { expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  invalidateAssignmentCallbacks,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
import {
  RoomCameraSnapshotProvider,
  useRoomCameraSnapshot,
} from './camera-snapshot-provider';
import type { CameraView } from './camera-view';

const pose: CameraView = {
  position: [1, 2, 3],
  target: [0, 0, 0],
  zoom: 3.197955622141161,
  mode: 'free',
};
function Probe({
  keyName = 'geometry',
  actor = 'actor',
  backend = 'https://backend.example',
  capture,
}: {
  keyName?: string;
  actor?: string;
  backend?: string;
  capture?: (write: (view: CameraView) => boolean) => void;
}) {
  const camera = useRoomCameraSnapshot(keyName, actor, backend);
  useLayoutEffect(() => {
    capture?.(camera.write);
  });
  return (
    <>
      <output aria-label="Saved camera">{JSON.stringify(camera.view)}</output>
      <button onClick={() => camera.write(pose)}>Record camera</button>
    </>
  );
}
function fixture(
  children: React.ReactNode,
  options: {
    actor?: string;
    backend?: string;
    generation?: string;
    ready?: boolean;
    visible?: boolean;
  } = {},
) {
  const {
    actor = 'actor',
    backend = 'https://backend.example',
    generation = 'camera-authority',
    ready = true,
    visible = true,
  } = options;
  return (
    <PrivacyReadinessContext
      value={{
        ready,
        visible,
        generation,
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: ready ? assignmentEpoch() : undefined,
      }}
    >
      <RoomCameraSnapshotProvider actorId={actor} backend={backend}>
        {children}
      </RoomCameraSnapshotProvider>
    </PrivacyReadinessContext>
  );
}

it('silently disposes a real provider on unmount without insertion-cleanup updates or writable departed callbacks', () => {
  let write!: (view: CameraView) => boolean;
  const page = render(
    fixture(
      <Probe
        capture={(callback) => {
          write = callback;
        }}
      />,
    ),
  );
  const departedWrite = write;
  act(() => {
    expect(departedWrite(pose)).toBe(true);
  });
  const warnings: Array<{ message: string; stack: string | undefined }> = [];
  const originalError = console.error;
  // Observe only this real provider's unmount. Preserve the console output and
  // attach the synchronous stack so a regression identifies its notifying store.
  const observation = vi
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => {
      if (
        args.some(
          (value) =>
            typeof value === 'string' &&
            value.includes('useInsertionEffect must not schedule updates'),
        )
      ) {
        warnings.push({
          message: args.map(String).join(' '),
          stack: new Error('Provider unmount warning').stack,
        });
      }
      originalError(...args);
    });
  try {
    page.unmount();
    expect(departedWrite(pose)).toBe(false);
    expect(warnings).toEqual([]);
  } finally {
    observation.mockRestore();
  }
});

it('returns null and a no-op without a layout provider', () => {
  render(<Probe />);
  fireEvent.click(screen.getByRole('button', { name: 'Record camera' }));
  expect(screen.getByLabelText('Saved camera')).toHaveTextContent('null');
});

it('does not rerender the layout or unrelated context consumers on camera publication', () => {
  let unrelatedCommits = 0;
  function Unrelated() {
    useContext(PrivacyReadinessContext);
    useLayoutEffect(() => {
      unrelatedCommits += 1;
    });
    return <p>Unrelated</p>;
  }
  render(
    fixture(
      <>
        <Probe />
        <Unrelated />
      </>,
    ),
  );
  const before = unrelatedCommits;
  fireEvent.click(screen.getByRole('button', { name: 'Record camera' }));
  expect(screen.getByLabelText('Saved camera')).toHaveTextContent(
    String(pose.zoom),
  );
  expect(unrelatedCommits).toBe(before);
});

it('keeps a scene callback writable across same-owner renders and camera publications', () => {
  let write!: (view: CameraView) => boolean;
  const capture = (callback: typeof write) => {
    write = callback;
  };
  const page = render(fixture(<Probe capture={capture} />));
  // Canvas has its own React root. Its last committed callback can outlive
  // a workspace render until the scene's passive effects receive new props.
  const sceneWrite = write;
  act(() => {
    expect(sceneWrite(pose)).toBe(true);
  });
  page.rerender(fixture(<Probe capture={capture} />));
  const panned = { ...pose, target: [12, 3, 4] as CameraView['target'] };
  act(() => {
    expect(sceneWrite(panned)).toBe(true);
  });
  expect(write).toBe(sceneWrite);
  expect(
    JSON.parse(screen.getByLabelText('Saved camera').textContent!),
  ).toEqual(panned);
  page.rerender(fixture(<Probe keyName="other-room" capture={capture} />));
  act(() => {
    expect(sceneWrite(pose)).toBe(false);
  });
  expect(screen.getByLabelText('Saved camera')).toHaveTextContent('null');
  page.rerender(fixture(<Probe capture={capture} />));
  expect(
    JSON.parse(screen.getByLabelText('Saved camera').textContent!),
  ).toEqual(panned);
  act(() => {
    expect(sceneWrite(pose)).toBe(false);
  });
});

it('mints a new scene writer after Activity restores layout effects without reviving the hidden writer', () => {
  let write!: (view: CameraView) => boolean;
  const capture = (callback: typeof write) => {
    write = callback;
  };
  const content = (mode: 'visible' | 'hidden') =>
    fixture(
      <Activity mode={mode}>
        <Probe capture={capture} />
      </Activity>,
    );
  const page = render(content('visible'));
  const old = write;
  act(() => {
    expect(old(pose)).toBe(true);
  });
  page.rerender(content('hidden'));
  act(() => {
    expect(old(pose)).toBe(false);
  });
  page.rerender(content('visible'));
  act(() => {
    expect(old(pose)).toBe(false);
    expect(write({ ...pose, zoom: 4 })).toBe(true);
  });
  expect(
    JSON.parse(screen.getByLabelText('Saved camera').textContent!),
  ).toEqual({
    ...pose,
    zoom: 4,
  });
});

it.each([
  'actor',
  'backend',
  'generation',
  'space',
  'unmount',
  'provider',
] as const)(
  'keeps old callbacks retired on %s changes without reviving saved poses',
  (change) => {
    let write!: (view: CameraView) => boolean;
    const capture = (callback: typeof write) => {
      write = callback;
    };
    const page = render(fixture(<Probe capture={capture} />));
    fireEvent.click(screen.getByRole('button', { name: 'Record camera' }));
    const old = write;
    if (change === 'actor')
      page.rerender(
        fixture(<Probe actor="other" capture={capture} />, { actor: 'other' }),
      );
    if (change === 'backend')
      page.rerender(
        fixture(<Probe backend="https://other.example" capture={capture} />, {
          backend: 'https://other.example',
        }),
      );
    if (change === 'generation')
      page.rerender(
        fixture(<Probe capture={capture} />, { generation: 'reverified' }),
      );
    if (change === 'space')
      page.rerender(
        fixture(<Probe keyName="new-geometry" capture={capture} />),
      );
    if (change === 'unmount') page.rerender(fixture(<p>Inventory route</p>));
    if (change === 'provider') {
      page.unmount();
      render(fixture(<Probe capture={capture} />));
    }
    act(() => {
      expect(old({ ...pose, zoom: 1 })).toBe(false);
    });
    if (change !== 'unmount')
      expect(screen.getByLabelText('Saved camera')).toHaveTextContent('null');
  },
);

it.each(['privacy', 'assignment'] as const)(
  'clears synchronously on %s invalidation and mints a fresh same-actor writer after verification',
  (signal) => {
    let write!: (view: CameraView) => boolean;
    const capture = (callback: typeof write) => {
      write = callback;
    };
    const page = render(fixture(<Probe capture={capture} />));
    fireEvent.click(screen.getByRole('button', { name: 'Record camera' }));
    const old = write;
    act(() => {
      if (signal === 'privacy') revokePrivatePresentation();
      else invalidateAssignmentCallbacks();
      expect(old(pose)).toBe(false);
    });
    expect(screen.getByLabelText('Saved camera')).toHaveTextContent('null');
    page.rerender(fixture(<Probe capture={capture} />));
    act(() => {
      expect(old(pose)).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record camera' }));
    expect(screen.getByLabelText('Saved camera')).toHaveTextContent(
      String(pose.zoom),
    );
  },
);

it('retains stored data through an ordinary visible recheck but denies new restore/write grants until ready', () => {
  let write!: (view: CameraView) => boolean;
  const capture = (callback: typeof write) => {
    write = callback;
  };
  const page = render(fixture(<Probe capture={capture} />));
  fireEvent.click(screen.getByRole('button', { name: 'Record camera' }));
  const old = write;
  page.rerender(fixture(<Probe capture={capture} />, { ready: false }));
  expect(screen.getByLabelText('Saved camera')).toHaveTextContent('null');
  act(() => {
    expect(old(pose)).toBe(false);
    expect(write(pose)).toBe(false);
  });
  page.rerender(fixture(<Probe capture={capture} />));
  expect(screen.getByLabelText('Saved camera')).toHaveTextContent(
    String(pose.zoom),
  );
  act(() => {
    expect(old(pose)).toBe(false);
  });
});

it('withholds a remounted scene snapshot during a recheck and restores the exact pose when verified', () => {
  let write!: (view: CameraView) => boolean;
  const capture = (callback: typeof write) => {
    write = callback;
  };
  const page = render(fixture(<Probe capture={capture} />));
  fireEvent.click(screen.getByRole('button', { name: 'Record camera' }));
  const old = write;
  page.rerender(fixture(<p>Unmodeled space</p>, { ready: false }));
  page.rerender(fixture(<Probe capture={capture} />, { ready: false }));
  const pending = write;
  expect(screen.getByLabelText('Saved camera')).toHaveTextContent('null');
  act(() => {
    expect(pending({ ...pose, target: [9, 9, 9] })).toBe(false);
  });
  page.rerender(fixture(<Probe capture={capture} />));
  expect(
    JSON.parse(screen.getByLabelText('Saved camera').textContent!),
  ).toEqual(pose);
  act(() => {
    expect(old(pose)).toBe(false);
    expect(pending(pose)).toBe(false);
    expect(write(pose)).toBe(true);
  });
});
