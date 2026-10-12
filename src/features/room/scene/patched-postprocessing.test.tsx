import { act, render, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as patchedExports from '@react-three/postprocessing';
import {
  Activity,
  Component,
  createContext,
  StrictMode,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  type ReactNode,
  type Ref,
} from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  Camera,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer, SelectiveBloom } from '@react-three/postprocessing';
import type { EffectComposer as Composer } from 'postprocessing';
import { SceneEffectsProvider, useSceneEffects } from './scene-effects-context';
import type { SceneEffectsStore } from './scene-effects-state';
import { useSceneCurrent } from './scene-current';
import { SceneSessionContext } from './scene-budget-provider';
import type { RoomDefinition } from '../schema';
import SceneBloom from './scene-bloom';

const probe = vi.hoisted(() => ({
  three: null as unknown,
  frames: [] as Array<() => void>,
  refCleanups: [] as Array<() => void>,
  composers: [] as Array<{
    passes: unknown[];
    setSize: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  effects: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
  failPass: false,
  failSize: false,
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useLayoutEffect: (
      setup: () => void | (() => void),
      deps?: readonly unknown[],
    ) =>
      actual.useLayoutEffect(() => {
        const cleanup = setup();
        const record = deps?.[1] as
          | { current?: unknown; composer?: unknown; effect?: unknown }
          | undefined;
        if (
          typeof cleanup === 'function' &&
          deps?.length === 3 &&
          typeof record?.current === 'function' &&
          (record.composer || record.effect)
        )
          probe.refCleanups.push(cleanup);
        return cleanup;
      }, deps),
  };
});
vi.mock('@react-three/fiber', () => ({
  useThree: (selector?: (state: unknown) => unknown) =>
    selector ? selector(probe.three) : probe.three,
  useFrame: (frame: () => void) => {
    probe.frames.push(frame);
  },
  extend: () => {},
}));
vi.mock('./scene-palette', () => ({
  useScenePalette: () => ({ background: new Color('black') }),
  useScenePaletteRevision: () => 0,
}));
// Raw/composed framebuffer correctness is exercised by scene-bloom-runtime.test;
// this suite owns the actual wrapper lifecycle and application context integration.
vi.mock('./scene-bloom-runtime', async () => {
  const actual = await vi.importActual<typeof import('./scene-bloom-runtime')>(
    './scene-bloom-runtime',
  );
  return {
    ...actual,
    createSceneBloomFrames: () => ({ draw: vi.fn(), attach: () => () => {} }),
  };
});
// Exercise the real installed package entry, with instrumented GPU-owning
// lower-level constructors. Never mock @react-three/postprocessing itself.
vi.mock('postprocessing', async () => {
  const actual =
    await vi.importActual<typeof import('postprocessing')>('postprocessing');
  class InstrumentedComposer {
    passes: unknown[] = [];
    inputBuffer = new WebGLRenderTarget(2, 2);
    autoRenderToScreen = true;
    setSize = vi.fn(() => {
      if (probe.failSize) throw new Error('size allocation failed');
    });
    render = vi.fn();
    dispose = vi.fn(() => this.inputBuffer.dispose());
    constructor(gl: { autoClear: boolean }) {
      gl.autoClear = false;
      probe.composers.push(this);
    }
    addPass(pass: unknown) {
      this.passes.push(pass);
    }
    removePass(pass: unknown) {
      this.passes = this.passes.filter((entry) => entry !== pass);
    }
  }
  class InstrumentedRenderPass extends actual.RenderPass {
    constructor(...args: ConstructorParameters<typeof actual.RenderPass>) {
      if (probe.failPass) throw new Error('render pass failed');
      super(...args);
    }
  }
  class InstrumentedBloom extends actual.SelectiveBloomEffect {
    dispose = vi.fn(() => super.dispose());
    constructor(
      ...args: ConstructorParameters<typeof actual.SelectiveBloomEffect>
    ) {
      super(...args);
      probe.effects.push(this);
    }
  }
  return {
    ...actual,
    EffectComposer: InstrumentedComposer,
    RenderPass: InstrumentedRenderPass,
    SelectiveBloomEffect: InstrumentedBloom,
  };
});

type HostGroup = Group & { __r3f: { children: Array<{ object: unknown }> } };
const HostGroupContext = createContext<HostGroup | null>(null);
function GroupHost({
  ref,
  children,
}: {
  ref: Ref<Group>;
  children: ReactNode;
}) {
  const group = useMemo(() => {
    const instance = new Group() as HostGroup;
    instance.__r3f = { children: [] };
    return instance;
  }, []);
  useImperativeHandle(ref, () => group, [group]);
  return <HostGroupContext value={group}>{children}</HostGroupContext>;
}
function PrimitiveHost({ object }: { object: unknown }) {
  const group = useContext(HostGroupContext)!;
  useLayoutEffect(() => {
    const entry = { object };
    group.__r3f.children.push(entry);
    return () => {
      group.__r3f.children = group.__r3f.children.filter(
        (child) => child !== entry,
      );
    };
  }, [group, object]);
  return null;
}
vi.mock('react/jsx-runtime', async () => {
  const actual =
    await vi.importActual<typeof import('react/jsx-runtime')>(
      'react/jsx-runtime',
    );
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => {
      if (args[0] === 'group') args[0] = GroupHost;
      if (args[0] === 'primitive') args[0] = PrimitiveHost;
      return actual.jsx(...args);
    },
  };
});

const selection = [new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())];
const lights = [new DirectionalLight()];
let invalidate: ReturnType<typeof vi.fn>;
let gl: {
  autoClear: boolean;
  toneMapping: number;
  getSize: ReturnType<typeof vi.fn>;
  getPixelRatio: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  probe.frames = [];
  probe.composers = [];
  probe.effects = [];
  probe.refCleanups = [];
  for (const light of lights) {
    light.layers.disable(10);
    light.layers.disable(11);
  }
  probe.failPass = probe.failSize = false;
  invalidate = vi.fn();
  gl = {
    autoClear: true,
    toneMapping: 4,
    getSize: vi.fn((size: Vector2) => size.set(100, 80)),
    getPixelRatio: vi.fn(() => 1),
  };
  probe.three = {
    gl: { ...gl, domElement: document.createElement('canvas') },
    camera: new Camera(),
    scene: new Group(),
    invalidate,
  };
  gl = (probe.three as { gl: typeof gl }).gl;
});
afterEach(() => vi.restoreAllMocks());
const always = () => true;
function bloom(current = always, ref?: Ref<Composer>) {
  return (
    <EffectComposer ownerCurrent={current} ref={ref}>
      <SelectiveBloom lights={lights} selection={selection} intensity={0.22} />
    </EffectComposer>
  );
}
it('tests the exact installed patched distribution and retains unrelated package exports', () => {
  const manifest = JSON.parse(
    readFileSync(
      'patches/react-three-postprocessing-3.1.3/manifest.json',
      'utf8',
    ),
  ) as {
    files: Array<{ path: string; patchedSha256: string }>;
  };
  for (const entry of manifest.files) {
    const bytes = readFileSync(
      `node_modules/@react-three/postprocessing/${entry.path}`,
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      entry.patchedSha256,
    );
  }
  expect(patchedExports.SelectiveBloom).toBeTypeOf('function');
  expect(patchedExports.Selection).toBeTypeOf('function');
  expect(patchedExports.Bloom).toBeTypeOf('function');
  expect(patchedExports.N8AO).toBeTypeOf('function');
  expect(patchedExports.EffectComposer).toBe(EffectComposer);
});
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

it('checks current authority again between render and passive allocation', async () => {
  let current = true;
  const owner = () => current;
  function RetireBeforePassive() {
    useLayoutEffect(() => {
      current = false;
    }, []);
    return null;
  }
  render(
    <>
      {bloom(owner)}
      <RetireBeforePassive />
    </>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(probe.composers).toHaveLength(0);
  expect(probe.effects).toHaveLength(0);
  expect(gl.getSize).not.toHaveBeenCalled();
  expect(gl.autoClear).toBe(true);
  expect(gl.toneMapping).toBe(4);
});

it('checks SelectiveBloom authority after render before its committed allocation', async () => {
  let permitted = true;
  const current = () => permitted;
  function RetireBeforePassive() {
    useLayoutEffect(() => {
      permitted = false;
    }, []);
    return null;
  }
  render(
    <EffectComposer>
      <SelectiveBloom
        ownerCurrent={current}
        lights={lights}
        selection={selection}
      />
      <RetireBeforePassive />
    </EffectComposer>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(probe.composers).toHaveLength(1);
  expect(probe.effects).toHaveLength(0);
  expect(lights[0].layers.isEnabled(10)).toBe(false);
});

it('cannot clear a successor ref from retained old cleanup and preserves previously enabled light layers', async () => {
  let permitted = true;
  const original = () => permitted;
  const published = { current: null as Composer | null };
  lights[0].layers.enable(10);
  const view = render(bloom(original, published));
  await waitFor(() => expect(probe.effects).toHaveLength(1));
  const oldRefCleanup = probe.refCleanups[0];
  expect(oldRefCleanup).toBeTypeOf('function');
  permitted = false;
  view.rerender(bloom(always, published));
  await waitFor(() => expect(probe.effects).toHaveLength(2));
  const successor = published.current;
  expect(successor).not.toBeNull();
  oldRefCleanup();
  expect(published.current).toBe(successor);
  view.unmount();
  expect(published.current).toBeNull();
  expect(lights[0].layers.isEnabled(10)).toBe(true);
});

it('fences retained frames before resize and render, and disposes old resources once on owner replacement', async () => {
  let current = true;
  const original = () => current;
  const view = render(bloom(original));
  await waitFor(() => expect(probe.effects).toHaveLength(1));
  const owned = probe.composers[0];
  const frames = [...probe.frames];
  current = false;
  gl.getSize.mockClear();
  const sizeCalls = owned.setSize.mock.calls.length;
  act(() => {
    for (const frame of frames) frame();
  });
  expect(gl.getSize).not.toHaveBeenCalled();
  expect(owned.setSize).toHaveBeenCalledTimes(sizeCalls);
  expect(owned.render).not.toHaveBeenCalled();
  view.rerender(bloom(always));
  await waitFor(() => expect(probe.effects).toHaveLength(2));
  expect(owned.dispose).toHaveBeenCalledOnce();
  expect(probe.effects[0].dispose).toHaveBeenCalledOnce();
  gl.getSize.mockClear();
  act(() => {
    for (const frame of frames) frame();
  });
  expect(gl.getSize).not.toHaveBeenCalled();
  expect(owned.render).not.toHaveBeenCalled();
  view.unmount();
  expect(probe.composers[1].dispose).toHaveBeenCalledOnce();
  expect(probe.effects[1].dispose).toHaveBeenCalledOnce();
  expect(gl.autoClear).toBe(true);
  expect(gl.toneMapping).toBe(4);
});

it.each(['pass', 'size'] as const)(
  'rolls back acquired composer and renderer guards after %s setup failure',
  async (failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    probe.failPass = failure === 'pass';
    probe.failSize = failure === 'size';
    render(<Boundary>{bloom()}</Boundary>);
    await waitFor(() =>
      expect(probe.composers[0]?.dispose).toHaveBeenCalledOnce(),
    );
    expect(gl.autoClear).toBe(true);
    expect(gl.toneMapping).toBe(4);
    expect(probe.effects).toHaveLength(0);
  },
);

it('recreates committed composer and bloom resources after StrictMode rehearsal without an idle invalidation loop', async () => {
  const view = render(<StrictMode>{bloom()}</StrictMode>);
  await waitFor(() => expect(probe.effects.length).toBeGreaterThan(0));
  await act(async () => {
    await Promise.resolve();
  });
  expect(probe.composers).toHaveLength(2);
  expect(probe.composers[0].dispose).toHaveBeenCalledOnce();
  expect(probe.composers[1].dispose).not.toHaveBeenCalled();
  const current = probe.effects.at(-1)!;
  expect(current.dispose).not.toHaveBeenCalled();
  invalidate.mockClear();
  view.rerender(<StrictMode>{bloom()}</StrictMode>);
  await act(async () => {
    await Promise.resolve();
  });
  expect(probe.composers).toHaveLength(2);
  expect(invalidate).not.toHaveBeenCalled();
  view.unmount();
  for (const composer of probe.composers)
    expect(composer.dispose).toHaveBeenCalledOnce();
  for (const effect of probe.effects)
    expect(effect.dispose).toHaveBeenCalledOnce();
});

const room = {
  roomId: 'patched-package-room',
  dimensions: [100, 100, 96],
} as unknown as RoomDefinition;
function OwnedStoreComposer({
  observe,
}: {
  observe: (store: SceneEffectsStore) => void;
}) {
  const store = useSceneEffects();
  const current = useSceneCurrent(store);
  useLayoutEffect(() => {
    observe(store);
  }, [store, observe]);
  return (
    <SceneBloom
      current={current}
      lights={lights}
      selection={selection}
      rawColor={{
        toneMapping: 4,
        toneMappingExposure: 1,
        outputColorSpace: '',
      }}
    />
  );
}
it.each(['StrictMode', 'Activity'] as const)(
  'keeps the actual patched package alive through %s fresh-store reconnect',
  async (lifecycle) => {
    const stores: SceneEffectsStore[] = [];
    const observe = (store: SceneEffectsStore) => {
      stores.push(store);
    };
    const contents = (
      <SceneSessionContext value={{ current: always }}>
        <SceneEffectsProvider room={room}>
          <OwnedStoreComposer observe={observe} />
        </SceneEffectsProvider>
      </SceneSessionContext>
    );
    const tree = (mode: 'visible' | 'hidden') =>
      lifecycle === 'StrictMode' ? (
        <StrictMode>{contents}</StrictMode>
      ) : (
        <Activity mode={mode}>{contents}</Activity>
      );
    const view = render(tree('visible'));
    await waitFor(() => expect(probe.effects.length).toBeGreaterThan(0));
    if (lifecycle === 'Activity') {
      view.rerender(tree('hidden'));
      expect(stores[0].isDisposed()).toBe(true);
      view.rerender(tree('visible'));
    }
    await waitFor(() => expect(new Set(stores).size).toBe(2));
    await act(async () => {
      await Promise.resolve();
    });
    const latest = stores.at(-1)!;
    expect(latest.isCurrent()).toBe(true);
    expect(latest.isDisposed()).toBe(false);
    expect(probe.composers.at(-1)!.dispose).not.toHaveBeenCalled();
    expect(probe.effects.at(-1)!.dispose).not.toHaveBeenCalled();
    const count = probe.composers.length;
    invalidate.mockClear();
    view.rerender(tree('visible'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(probe.composers).toHaveLength(count);
    expect(invalidate).not.toHaveBeenCalled();
    view.unmount();
    for (const composer of probe.composers)
      expect(composer.dispose).toHaveBeenCalledOnce();
    for (const effect of probe.effects)
      expect(effect.dispose).toHaveBeenCalledOnce();
  },
);
