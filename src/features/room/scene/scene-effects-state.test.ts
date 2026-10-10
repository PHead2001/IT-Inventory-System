import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import {
  contactCacheKey,
  createEffectsQualityMonitor,
  createSceneEffectsStore,
  SCENE_EFFECTS,
} from './scene-effects-state';

function body() {
  return new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
}
describe('scene effects ownership', () => {
  it('registers only actual visual meshes and keeps scene generations and logical codes distinct', () => {
    const store = createSceneEffectsStore('room:1');
    const root = new Group(),
      main = body(),
      handle = body(),
      hitbox = body(),
      helper = new Group();
    hitbox.userData.hoverPassThrough = true;
    helper.userData.roomEffectHelper = true;
    helper.add(body());
    root.add(main, handle, hitbox, helper);
    const unregister = store.registerVisual('drawer', 'ITC-D01', root);
    expect(store.getCasters().map((entry) => entry.mesh)).toEqual([
      main,
      handle,
    ]);
    expect(store.getCasters()[0]).toMatchObject({
      sceneGeneration: 'room:1',
      nodeId: 'drawer',
      locationCode: 'ITC-D01',
    });
    expect(store.selectedMeshes(null, new Set(['ITC-D01']))).toEqual([]);
    expect(store.selectedMeshes('UNKNOWN', new Set())).toEqual([]);
    expect(store.selectedMeshes('ITC-L', new Set(['ITC-D01']))).toEqual([
      main,
      handle,
    ]);
    unregister();
    expect(store.getCasters()).toEqual([]);
  });
  it('does not let old registration cleanup remove a newer body for the same node', () => {
    const store = createSceneEffectsStore('room:1'),
      a = new Group(),
      b = new Group();
    a.add(body());
    b.add(body());
    const cleanup = store.registerVisual('drawer', 'ITC-D01', a);
    store.registerVisual('drawer', 'ITC-D01', b);
    cleanup();
    expect(store.getCasters()[0].mesh).toBe(b.children[0]);
  });
  it('retains visual hover only for its own geometry, refreshing on real pointer/camera/other geometry changes', () => {
    const store = createSceneEffectsStore('room:1'),
      root = new Group();
    root.add(body());
    store.registerVisual('drawer', 'ITC-D01', root);
    store.reconcileHover('ITC-D01', true);
    const epoch = store.getSnapshot().hoverEpoch;
    const finish = store.beginCasterMotion('hover:drawer', 'drawer', true);
    store.reconcileHover(null, false);
    expect(store.getSnapshot().hoverCode).toBe('ITC-D01');
    expect(store.getSnapshot().hoverEpoch).toBe(epoch);
    finish();
    expect(store.getSnapshot().hoverEpoch).toBe(epoch);
    store.reconcileHover(null, true);
    expect(store.getSnapshot().hoverCode).toBeNull();
    store.reconcileHover('ITC-D01', true);
    store.beginCasterMotion('reveal:other', 'other');
    expect(store.getSnapshot().hoverEpoch).toBeGreaterThan(epoch);
  });
  it('waits for both an old closing body and the new opening body; cache excludes camera/count/label activity', () => {
    const store = createSceneEffectsStore('room:1');
    const original = contactCacheKey(store, 0, 'standard');
    const closing = store.beginCasterMotion('reveal:old', 'old');
    const opening = store.beginCasterMotion('reveal:new', 'new');
    closing();
    expect(store.getSnapshot().casterMotions).toBe(1);
    opening();
    expect(store.getSnapshot().casterMotions).toBe(0);
    const settled = contactCacheKey(store, 0, 'standard');
    expect(settled).not.toBe(original);
    const activity = store.beginActivity('camera');
    activity();
    store.reconcileHover(null, true);
    store.setBloomReady(true);
    expect(contactCacheKey(store, 0, 'standard')).toBe(settled);
    expect(contactCacheKey(store, 1, 'standard')).not.toBe(settled);
    expect(contactCacheKey(store, 0, 'low')).not.toBe(settled);
  });
  it('latches actual failures without changing registry or selection and never retries them', () => {
    const store = createSceneEffectsStore('room:1'),
      root = new Group();
    root.add(body());
    store.registerVisual('drawer', 'ITC-D01', root);
    store.failBloom('framebuffer-allocation');
    store.failBloom('other');
    expect(store.getSnapshot().bloomFailure).toBe('framebuffer-allocation');
    expect(store.selectedMeshes('ITC-D01', new Set())).toHaveLength(1);
  });
});
describe('measured active-frame quality', () => {
  it('excludes idle/startup/capture samples and requires two consecutive bad 60-frame windows', () => {
    const monitor = createEffectsQualityMonitor();
    for (let i = 0; i < 100; i++) monitor.sample(5000, false);
    for (let i = 0; i < SCENE_EFFECTS.startupActiveFrames; i++)
      monitor.sample(5000, true);
    for (let i = 0; i < 60; i++) expect(monitor.sample(30, true)).toBe(false);
    expect(monitor.evidence()).toMatchObject({
      windows: 1,
      badWindows: 1,
      disabled: false,
    });
    for (let i = 0; i < 59; i++) expect(monitor.sample(30, true)).toBe(false);
    expect(monitor.sample(30, true)).toBe(true);
    expect(monitor.sample(10, true)).toBe(true);
  });
  it('resets consecutive degradation after a good window and rejects invalid sample values', () => {
    const monitor = createEffectsQualityMonitor();
    for (let i = 0; i < 70; i++) monitor.sample(30, true);
    for (let i = 0; i < 60; i++) monitor.sample(10, true);
    for (let i = 0; i < 60; i++) monitor.sample(30, true);
    for (const ms of [NaN, Infinity, 0, -1]) monitor.sample(ms, true);
    expect(monitor.evidence()).toMatchObject({
      windows: 3,
      badWindows: 1,
      pending: 0,
      disabled: false,
    });
  });
  it('excludes a newly attached lazy composer shader warmup without clearing latched degradation', () => {
    const monitor = createEffectsQualityMonitor();
    for (let i = 0; i < 30; i++) monitor.sample(10, true);
    monitor.restartWarmup();
    for (let i = 0; i < SCENE_EFFECTS.startupActiveFrames; i++)
      monitor.sample(5000, true);
    expect(monitor.evidence()).toMatchObject({ windows: 0, pending: 0 });
    for (let i = 0; i < 120; i++) monitor.sample(30, true);
    monitor.restartWarmup();
    expect(monitor.evidence().disabled).toBe(true);
  });
});
