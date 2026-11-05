import { canvasGestureCandidates } from './canvas-gesture';
import {
  roomDemandSnapshot,
  type RoomDemandSnapshot,
} from './room-demand-snapshot';
import { writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import rawRoom from '../../data/rooms/it-closet.json' with { type: 'json' };
import { buildRoomBindings } from '../../src/features/room/bindings';
import { roomSchema } from '../../src/features/room/schema';
import type { RoomOccupancy } from '../../src/features/room/occupancy-contract';
import {
  roomFailureMetadata,
  roomOccupancyFailureProjection,
  type RoomAssertionId,
} from './room-failure-metadata';
import { type RoomClickDiagnostics } from './room-click-witness';

export type CameraReading = {
  azimuth: number;
  elevation: number;
  unwrapped: number;
  zoom: number;
  target: number[];
  position: number[];
  view: number[];
  projection: number[];
  mode: string;
};

// Call once from each spec: fixtures and diagnostic state belong to that invocation.
export function registerRoomTestSupport() {
  // Sort the current fixture first even when iterative runs retain earlier local stock.
  const inventoryName =
    '000 Room stock ' +
    String(Number.MAX_SAFE_INTEGER - Date.now()) +
    ' ' +
    crypto.randomUUID();

  const locationNames = new Map<string, string>();

  const roomContract = roomSchema.parse(rawRoom);

  const bindingBounds = buildRoomBindings(roomContract);

  let navigationFixtureId: string | null = null;

  let navigationFixtureJournal: string | null = null;

  let occupancyFixtureId: string | null = null;

  let occupancyFixtureJournal: string | null = null;

  test.beforeAll(async ({}, testInfo) => {
    const url = new URL(process.env.LOCAL_API_URL!);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.port !== '45321'
    ) {
      throw new Error('Refusing a nonlocal room test fixture target');
    }
    const client = createClient(
      url.href,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const session = await client.auth.signInWithPassword({
      email: fixture.emails.staff,
      password: fixture.password,
    });
    if (session.error) throw session.error;
    try {
      const locations = await client
        .from('locations')
        .select('id,code,name')
        .in('code', ['ITC-L', 'ITC-S1A', 'ITC-D01', 'ITC-D04', 'ITC-RACK']);
      if (locations.error) throw locations.error;
      for (const location of locations.data)
        locationNames.set(location.code, location.name);
      const locationId = (code: string) => {
        const location = locations.data.find((row) => row.code === code);
        expect(location, 'required room fixture location ' + code).toBeTruthy();
        return location!.id;
      };
      const category = await client
        .from('categories')
        .select('id')
        .eq('code', 'CABLES')
        .single();
      if (category.error) throw category.error;
      const created = await client.rpc('quantity_create', {
        p_request_id: crypto.randomUUID(),
        p_payload: {
          name: inventoryName,
          category_id: category.data.id,
          initial_quantity: 7,
          initial_location_id: locationId('ITC-S1A'),
        },
      });
      if (created.error) throw created.error;
      navigationFixtureId = created.data.entity_id;
      navigationFixtureJournal = testInfo.outputPath(
        'owned-room-navigation-fixture.json',
      );
      writeFileSync(
        navigationFixtureJournal,
        JSON.stringify(
          {
            origin: url.origin,
            itemId: navigationFixtureId,
            locationCodes: ['ITC-S1A', 'ITC-D01'],
            cleanup: 'pending',
          },
          null,
          2,
        ),
      );
      const received = await client.rpc('quantity_receive', {
        p_request_id: crypto.randomUUID(),
        p_payload: {
          item_id: created.data.entity_id,
          expected_version: 1,
          location_id: locationId('ITC-D01'),
          quantity: 4,
          reason: 'Room navigation fixture',
        },
      });
      if (received.error) throw received.error;
      const modeled = await client
        .from('locations')
        .select('id,code,name,active,can_hold_inventory,parent_id')
        .in(
          'code',
          bindingBounds.map((binding) => binding.code),
        );
      if (modeled.error) throw modeled.error;
      const leaves = modeled.data
        .filter(
          (location) =>
            location.active &&
            location.can_hold_inventory &&
            !modeled.data.some((child) => child.parent_id === location.id),
        )
        .sort((a, b) => a.code.localeCompare(b.code));
      expect(leaves).toHaveLength(28);
      const occupancy = await client.rpc('quantity_create', {
        p_request_id: crypto.randomUUID(),
        p_payload: {
          name: 'ZZ Owned room occupancy ' + crypto.randomUUID(),
          category_id: category.data.id,
          initial_quantity: 31,
          initial_location_id: leaves[0].id,
        },
      });
      if (occupancy.error) throw occupancy.error;
      occupancyFixtureId = occupancy.data.entity_id;
      occupancyFixtureJournal = testInfo.outputPath(
        'owned-room-occupancy-fixture.json',
      );
      writeFileSync(
        occupancyFixtureJournal,
        JSON.stringify(
          {
            origin: url.origin,
            itemId: occupancyFixtureId,
            locationCodes: leaves.map((location) => location.code),
            cleanup: 'pending',
          },
          null,
          2,
        ),
      );
      for (const [index, location] of leaves.slice(1).entries()) {
        const receipt = await client.rpc('quantity_receive', {
          p_request_id: crypto.randomUUID(),
          p_payload: {
            item_id: occupancyFixtureId,
            expected_version: index + 1,
            location_id: location.id,
            quantity: 31,
            reason: 'Owned room occupancy browser fixture',
          },
        });
        if (receipt.error) throw receipt.error;
      }
    } finally {
      await client.auth.signOut({ scope: 'local' });
    }
  });

  test.afterAll(async () => {
    if (!navigationFixtureId && !occupancyFixtureId) return;
    const url = new URL(process.env.LOCAL_API_URL!);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.port !== '45321'
    )
      throw new Error('Refusing nonlocal room fixture cleanup');
    const client = createClient(
      url.href,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const session = await client.auth.signInWithPassword({
      email: fixture.emails.staff,
      password: fixture.password,
    });
    if (session.error) throw session.error;
    try {
      const errors: unknown[] = [];
      for (const [itemId, journal] of [
        [navigationFixtureId, navigationFixtureJournal],
        [occupancyFixtureId, occupancyFixtureJournal],
      ]) {
        if (!itemId) continue;
        try {
          const item = await client
            .from('quantity_items')
            .select('version,archived')
            .eq('id', itemId)
            .single();
          if (item.error) throw item.error;
          if (!item.data.archived) {
            const cleanup = await client.rpc('quantity_archive_and_clear', {
              p_request_id: crypto.randomUUID(),
              p_payload: {
                item_id: itemId,
                expected_version: String(item.data.version),
                confirm_clear_stock: true,
                reason: 'Clean owned room browser fixture',
              },
            });
            if (cleanup.error) throw cleanup.error;
          }
          const verified = await client
            .from('quantity_items')
            .select('version,archived')
            .eq('id', itemId)
            .single();
          if (verified.error) throw verified.error;
          expect(verified.data.archived).toBe(true);
          const balances = await client
            .from('stock_balances')
            .select('quantity')
            .eq('item_id', itemId)
            .gt('quantity', 0);
          if (balances.error) throw balances.error;
          expect(balances.data).toHaveLength(0);
          if (journal)
            writeFileSync(
              journal,
              JSON.stringify(
                {
                  origin: url.origin,
                  itemId,
                  version: String(verified.data.version),
                  positiveBalanceCount: 0,
                  cleanup: 'archived and cleared through audited RPC',
                },
                null,
                2,
              ),
            );
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(errors, 'Owned room fixture cleanup failed');
    } finally {
      await client.auth.signOut({ scope: 'local' });
    }
  });

  async function login(page: Page, role: 'staff' | 'viewer' = 'staff') {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(fixture.emails[role]);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Inventory', exact: true }),
    ).toBeVisible();
  }

  async function chooseMapMode(page: Page, mode: 'Guided' | 'Free Orbit') {
    const more = page.getByRole('button', {
      name: 'More map controls',
      exact: true,
    });
    const wasOpen = (await more.getAttribute('aria-expanded')) === 'true';
    if (!wasOpen) await more.click();
    await page
      .getByRole('region', { name: 'More map controls', exact: true })
      .getByRole('button', { name: mode, exact: true })
      .click();
    if (!wasOpen) await more.click();
  }

  async function setRoomLabels(page: Page, enabled: boolean) {
    const more = page.getByRole('button', {
      name: 'More map controls',
      exact: true,
    });
    const wasOpen = (await more.getAttribute('aria-expanded')) === 'true';
    if (!wasOpen) await more.click();
    const toggle = page.getByRole('button', {
      name: 'Show labels',
      exact: true,
    });
    if ((await toggle.getAttribute('aria-pressed')) !== String(enabled))
      await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', String(enabled));
    if (!wasOpen) await more.click();
  }

  async function selected(page: Page, code: string) {
    await expect(page).toHaveURL(
      new RegExp('/room\\?.*location=' + code + '(?:&|$)'),
    );
    await expect(
      page.getByRole('navigation', { name: 'Location browser' }),
    ).toContainText('Selected path:');
    const inventory = page.getByRole('region', {
      name: 'Location inventory',
      exact: true,
    });
    await expect(inventory).toBeVisible();
    await expect(
      inventory.getByRole('heading', {
        name: locationNames.get(code),
        exact: true,
      }),
    ).toBeVisible();
    await expect(inventory.getByText(code, { exact: true })).toBeVisible();
    await expect(
      inventory.getByRole('link', { name: 'Location details and history' }),
    ).toHaveAttribute('href', '/locations/' + code);
  }

  async function settledLabels(page: Page, afterRevision?: number) {
    const canvas = page.locator(
      '[aria-label="Interactive room canvas"] canvas',
    );
    const startedAt = Date.now();
    const matrix = (value: string | undefined): number[] | null => {
      if (!value || value.length > 1024) return null;
      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) &&
          parsed.length === 16 &&
          parsed.every(
            (entry) => typeof entry === 'number' && Number.isFinite(entry),
          )
          ? parsed
          : null;
      } catch {
        return null;
      }
    };
    type Observation = {
      atMs: number;
      pending: 'true' | 'false' | 'unknown';
      revision: number | null;
      status: string;
      layoutError: string | null;
      phase: string | null;
      sceneFrames: number | null;
      composerFrames: number | null;
      viewChanged: boolean;
      projectionChanged: boolean;
    };
    const recent: Observation[] = [];
    const demandSamples: (RoomDemandSnapshot | null)[] = [];
    let last:
      | (Observation & { view: number[] | null; projection: number[] | null })
      | null = null;
    let observations = 0,
      pendingObservations = 0,
      revisionChanges = 0,
      viewChanges = 0,
      projectionChanges = 0;
    let previousFrame: (string | undefined)[] | undefined;
    let previous = '';
    try {
      await expect
        .poll(async () => {
          const {
            current,
            status,
            layoutError,
            phase,
            sceneFrames,
            composerFrames,
            demand,
          } = await canvas.evaluate(async (element) => {
            // Let the requested control update project and measure before accepting
            // a settled flag that could still belong to the previous camera frame.
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            const current = {
              pending: element.dataset.labelLayoutPending,
              revision: Number(element.dataset.labelLayoutRevision ?? 0),
              frame: [
                element.dataset.cameraViewMatrix,
                element.dataset.cameraProjectionMatrix,
              ],
            };
            const counter = (value: string | undefined) => {
              const number = Number(value);
              return value !== undefined &&
                Number.isSafeInteger(number) &&
                number >= 0 &&
                number <= 1_000_000
                ? number
                : null;
            };
            let demand: RoomDemandSnapshot | null = null;
            try {
              demand = window.__readRoomDemandSnapshot?.(element) ?? null;
            } catch {
              /* A blocked diagnostic reader cannot change readiness. */
            }
            try {
              const statuses = [
                'complete',
                'candidate-infeasible',
                'budget-exhausted',
              ];
              const errors = [
                'Room viewport is not measured',
                'Label measurement work budget exhausted',
                'Label placement work budget exhausted',
                'Label remeasurement work budget exhausted',
                'Unstable label dimensions after four placement passes',
              ];
              const errorIndex = errors.indexOf(
                element.dataset.labelLayoutError ?? '',
              );
              return {
                current,
                demand,
                phase: [
                  'idle',
                  'flying',
                  'revealing',
                  'settled',
                  'cancelled',
                ].includes(element.dataset.spatialPhase ?? '')
                  ? element.dataset.spatialPhase!
                  : null,
                sceneFrames: counter(element.dataset.sceneEffectFrames),
                composerFrames: counter(element.dataset.composerFrames),
                status: statuses.includes(
                  element.dataset.labelLayoutStatus ?? '',
                )
                  ? element.dataset.labelLayoutStatus!
                  : 'unknown',
                // Only fixed codes leave the browser, never arbitrary attribute text.
                layoutError:
                  errorIndex >= 0
                    ? [
                        'viewport-unmeasured',
                        'measurement-budget',
                        'placement-budget',
                        'remeasurement-budget',
                        'unstable-dimensions',
                      ][errorIndex]
                    : element.dataset.labelLayoutError === undefined
                      ? null
                      : 'unknown',
              };
            } catch {
              return {
                current,
                demand: null,
                status: 'unavailable',
                layoutError: 'unavailable',
                phase: null,
                sceneFrames: null,
                composerFrames: null,
              };
            }
          });
          const key = JSON.stringify(current);
          const stable =
            current.pending === 'false' &&
            key === previous &&
            (afterRevision === undefined || current.revision > afterRevision);
          // Diagnostics do not participate in readiness or alter the poll cadence.
          try {
            const observation: Observation = {
              atMs: Date.now() - startedAt,
              pending:
                current.pending === 'true' || current.pending === 'false'
                  ? current.pending
                  : 'unknown',
              revision:
                Number.isSafeInteger(current.revision) && current.revision >= 0
                  ? current.revision
                  : null,
              status,
              layoutError,
              phase,
              sceneFrames,
              composerFrames,
              viewChanged:
                previousFrame !== undefined &&
                current.frame[0] !== previousFrame[0],
              projectionChanged:
                previousFrame !== undefined &&
                current.frame[1] !== previousFrame[1],
            };
            demandSamples.push(roomDemandSnapshot(demand));
            if (demandSamples.length > 8) demandSamples.shift();
            observations++;
            pendingObservations += Number(observation.pending === 'true');
            revisionChanges += Number(
              last !== null && observation.revision !== last.revision,
            );
            viewChanges += Number(observation.viewChanged);
            projectionChanges += Number(observation.projectionChanged);
            if (
              key !== previous ||
              status !== last?.status ||
              layoutError !== last?.layoutError ||
              phase !== last?.phase ||
              sceneFrames !== last?.sceneFrames ||
              composerFrames !== last?.composerFrames
            ) {
              recent.push(observation);
              if (recent.length > 12) recent.shift();
            }
            last = {
              ...observation,
              view: matrix(current.frame[0]),
              projection: matrix(current.frame[1]),
            };
            previousFrame = current.frame;
          } catch {
            /* A diagnostic failure must not change readiness. */
          }
          previous = key;
          return stable;
        })
        .toBe(true);
    } catch (error) {
      try {
        const failure = {
          schema: 1,
          elapsedMs: Date.now() - startedAt,
          afterRevision: Number.isSafeInteger(afterRevision)
            ? afterRevision
            : null,
          observations,
          pendingObservations,
          revisionChanges,
          viewChanges,
          projectionChanges,
          last,
          recent,
          demandSamples,
        };
        // Keep source attribution bounded even at maximum counter saturation.
        const prefix = 'ROOM_LABEL_SETTLE_FAILURE ';
        let report = JSON.stringify(failure);
        while (
          prefix.length + report.length > 16 * 1024 &&
          failure.demandSamples.length
        ) {
          failure.demandSamples.shift();
          report = JSON.stringify(failure);
        }
        console.error(prefix + report);
      } catch {
        /* Preserve the original assertion even if reporting fails. */
      }
      throw error;
    }
  }

  async function ready(page: Page) {
    const show = page.getByRole('button', { name: 'Show room', exact: true });
    if (await show.isVisible()) await show.click();
    const viewer = page.getByTestId('room-viewer');
    await expect(viewer).toHaveAttribute('data-camera-view', /"position":\[/, {
      timeout: 20_000,
    });
    await expect(viewer.locator('canvas')).toBeVisible();
    return viewer;
  }

  type RoomProgress = {
    journey:
      | 'effects'
      | 'spatial-reveal'
      | 'spatial-interruption'
      | 'room-labels'
      | 'drawer-labels';
    stage: string;
    pose?: string;
    code?: string;
    assertion?: RoomAssertionId;
    occupancyExpected?: RoomOccupancy[string];
    clickWitness?: RoomClickDiagnostics;
  };

  const roomProgressByTest = new WeakMap<TestInfo, RoomProgress>();

  const roomPageByTest = new WeakMap<TestInfo, Page>();

  function markRoomProgress(testInfo: TestInfo, progress: RoomProgress) {
    roomProgressByTest.set(testInfo, progress);
  }

  function markRoomAssertion(testInfo: TestInfo, assertion: RoomAssertionId) {
    const progress = roomProgressByTest.get(testInfo);
    if (progress) progress.assertion = assertion;
  }

  function trackRoomPage(testInfo: TestInfo, page: Page) {
    roomPageByTest.set(testInfo, page);
  }

  async function roomFailureMetrics(page: Page, progress: RoomProgress) {
    return page
      .evaluate((code) => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          '[data-room-surface] canvas',
        );
        const state = [...(window.__roomWitnessStores ?? [])]
          .map((store) => store.getState())
          .find((candidate) => candidate.gl.domElement === canvas);
        const integer = (value: number) =>
          Number.isFinite(value)
            ? Math.max(0, Math.min(1_000_000, Math.trunc(value)))
            : null;
        const decimal = (value: number) =>
          Number.isFinite(value)
            ? Math.max(
                -100_000,
                Math.min(100_000, Math.round(value * 1000) / 1000),
              )
            : null;
        const token = (value: string | undefined, allowed: string[]) =>
          value && allowed.includes(value) ? value : 'other';
        const vector = (value: string | undefined) => {
          try {
            const parsed: unknown = JSON.parse(value ?? '');
            return Array.isArray(parsed) &&
              parsed.length === 3 &&
              parsed.every(
                (part) => typeof part === 'number' && Number.isFinite(part),
              )
              ? parsed.map((part) => decimal(part)!)
              : null;
          } catch {
            return null;
          }
        };
        const labels = code
          ? [
              ...document.querySelectorAll<HTMLElement>(
                '[data-room-label-code]',
              ),
            ].filter((element) => element.dataset.roomLabelCode === code)
          : [];
        let quality: Record<string, unknown> = {};
        try {
          quality = JSON.parse(
            canvas?.dataset.effectsQualityEvidence ?? '{}',
          ) as Record<string, unknown>;
        } catch {
          /* unavailable */
        }
        return {
          labelObservation: {
            code: code ?? '',
            labelCount: labels.length,
            labels: labels.slice(0, 4).map((element) => ({
              aria: element.getAttribute('aria-label')?.slice(0, 512) ?? null,
              badge: (() => {
                const counts = element.querySelectorAll(
                  '[class*="countBadge"] [data-count-final]',
                );
                return counts.length > 0 && counts.length <= 3
                  ? [...counts]
                      .map((count) => count.textContent ?? '')
                      .join(' / ')
                      .slice(0, 128)
                  : null;
              })(),
              suppressed: element.dataset.labelSuppressed ?? null,
              compact: element.dataset.labelCompact ?? null,
              exposed: element.dataset.roomExposed ?? null,
            })),
          },
          browser: {
            name: /HeadlessChrome|Chrome\//.test(navigator.userAgent)
              ? 'chromium'
              : 'other',
            devicePixelRatio: decimal(window.devicePixelRatio),
            rendererPixelRatio: decimal(state?.gl.getPixelRatio() ?? NaN),
            reducedMotion: matchMedia('(prefers-reduced-motion: reduce)')
              .matches,
          },
          quality: {
            disabled:
              typeof quality.disabled === 'boolean' ? quality.disabled : null,
            pending: integer(Number(quality.pending ?? NaN)),
            windows: integer(Number(quality.windows ?? NaN)),
            badWindows: integer(Number(quality.badWindows ?? NaN)),
            lastP95: decimal(Number(quality.lastP95 ?? NaN)),
          },
          canvas: canvas !== null,
          viewport: {
            width: integer(window.innerWidth),
            height: integer(window.innerHeight),
          },
          spatialPhase: token(canvas?.dataset.spatialPhase, [
            'settled',
            'flying',
            'revealing',
            'cancelled',
            'idle',
          ]),
          contactStatus: token(canvas?.dataset.contactStatus, [
            'cached',
            'off',
            'moving',
            'failed',
            'allocation-failed',
            'capture-failed',
          ]),
          bloomStatus: token(canvas?.dataset.bloomStatus, [
            'active',
            'unselected',
            'loading',
            'quality-off',
            'failed',
            'import-or-allocation',
            'overlay-allocation',
            'sustained-frame-time',
            'shader-program',
            'unsupported-material-workaround',
            'incomplete-framebuffer',
            'framebuffer-allocation',
            'composer-render',
            'screen-render',
          ]),
          bloomFailure: token(canvas?.dataset.bloomStatus, [
            'import-or-allocation',
            'overlay-allocation',
            'sustained-frame-time',
            'shader-program',
            'unsupported-material-workaround',
            'incomplete-framebuffer',
            'framebuffer-allocation',
            'composer-render',
            'screen-render',
          ]),
          contactCaptures: integer(
            Number(canvas?.dataset.contactCaptures ?? 0),
          ),
          paletteRevision: integer(
            Number(canvas?.dataset.paletteRevision ?? 0),
          ),
          sceneFrames: integer(Number(canvas?.dataset.sceneEffectFrames ?? 0)),
          composerFrames: integer(Number(canvas?.dataset.composerFrames ?? 0)),
          drawFrame: integer(state?.gl.info.render.frame ?? 0),
          geometries: integer(state?.gl.info.memory.geometries ?? 0),
          textures: integer(state?.gl.info.memory.textures ?? 0),
          programs: integer(state?.gl.info.programs?.length ?? 0),
          labelLayoutPending: token(canvas?.dataset.labelLayoutPending, [
            'true',
            'false',
          ]),
          labelLayoutRevision: integer(
            Number(canvas?.dataset.labelLayoutRevision ?? 0),
          ),
          cameraPose: {
            position: vector(canvas?.dataset.cameraPosition),
            target: vector(canvas?.dataset.cameraTarget),
            zoom: decimal(Number(canvas?.dataset.cameraZoom ?? 0)),
            mode: token(canvas?.dataset.orbitMode, ['guided', 'free']),
          },
        };
      }, progress.code)
      .then(({ labelObservation, ...metrics }) => ({
        ...metrics,
        occupancy: roomOccupancyFailureProjection({
          ...labelObservation,
          expected: progress.occupancyExpected,
        }),
      }))
      .catch(() => ({ available: false }));
  }

  async function roomFailureSamples(page: Page, progress: RoomProgress) {
    return page
      .evaluate(async (code) => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          '[data-room-surface] canvas',
        );
        const number = (value: number) =>
          Number.isFinite(value)
            ? Math.max(
                -100_000,
                Math.min(100_000, Math.round(value * 1000) / 1000),
              )
            : null;
        const flag = (value: string | undefined) =>
          value === 'true' || value === 'false' ? value : null;
        const matrix = (value: string | undefined) => {
          try {
            const parsed: unknown = JSON.parse(value ?? '');
            return Array.isArray(parsed) &&
              parsed.length === 16 &&
              parsed.every(
                (entry) => typeof entry === 'number' && Number.isFinite(entry),
              )
              ? parsed
              : null;
          } catch {
            return null;
          }
        };
        const snapshot = () => {
          const layout = window.__roomLabelLayoutSnapshot;
          const visibility = window.__roomVisibilitySnapshot;
          const state = [...(window.__roomWitnessStores ?? [])]
            .map((store) => store.getState())
            .find((candidate) => candidate.gl.domElement === canvas);
          const offsets: {
            id: string;
            kind: 'hover' | 'reveal';
            offset: (number | null)[];
          }[] = [];
          state?.scene.traverse((object) => {
            // Fixed geometry identifiers only; never private label or inventory text.
            const id: unknown =
              object.userData.roomHoverVisualNode ??
              object.userData.roomRevealNode;
            if (
              typeof id === 'string' &&
              /^(?:drawer-(?:[1-9]|1[0-2])|(?:red|black|clear)-container|shelf-[1-4][abc]|server-rack)$/.test(
                id,
              ) &&
              offsets.length < 64
            )
              offsets.push({
                id,
                kind: object.userData.roomHoverVisualNode ? 'hover' : 'reveal',
                offset: object.position.toArray().map(number),
              });
          });
          return {
            at: Math.round(performance.now() * 1000) / 1000,
            camera: {
              view: matrix(canvas?.dataset.cameraViewMatrix),
              projection: matrix(canvas?.dataset.cameraProjectionMatrix),
            },
            effects: {
              sceneFrames: number(
                Number(canvas?.dataset.sceneEffectFrames ?? NaN),
              ),
              composerFrames: number(
                Number(canvas?.dataset.composerFrames ?? NaN),
              ),
              contactCaptures: number(
                Number(canvas?.dataset.contactCaptures ?? NaN),
              ),
              contact: [
                'cached',
                'moving',
                'off',
                'failed',
                'allocation-failed',
                'capture-failed',
              ].includes(canvas?.dataset.contactStatus ?? '')
                ? canvas!.dataset.contactStatus
                : 'other',
              offsets,
            },
            labels: {
              enabled: window.__roomLayoutDiagnosticsEnabled === true,
              pending: flag(canvas?.dataset.labelLayoutPending),
              revision: number(
                Number(canvas?.dataset.labelLayoutRevision ?? NaN),
              ),
              transaction: layout?.transaction ?? null,
              complete: layout?.complete ?? null,
              settled: layout?.settled ?? null,
              passCount: layout?.passes.length ?? null,
              passes:
                layout?.passes.slice(0, 4).map((pass) => ({
                  labels: pass.labels
                    .filter(
                      (label) =>
                        label.locationCode === code ||
                        label.id === 'hover-tooltip',
                    )
                    .slice(0, 4),
                  output: pass.output
                    ?.filter((output) =>
                      pass.labels.some(
                        (label) =>
                          label.id === output.id &&
                          (label.locationCode === code ||
                            label.id === 'hover-tooltip'),
                      ),
                    )
                    .slice(0, 4),
                })) ?? null,
              visibilityRevision: visibility?.revision ?? null,
              visibilityComplete: visibility?.complete ?? null,
              visibility:
                visibility?.entries
                  .filter((entry) => entry.code === code)
                  .slice(0, 1) ?? null,
            },
          };
        };
        const before = snapshot();
        // Observation only: one browser frame, no time advance or render invalidation.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        return { before, after: snapshot() };
      }, progress.code)
      .catch(() => ({ available: false }));
  }

  test.afterEach(async ({}, testInfo) => {
    const progress = roomProgressByTest.get(testInfo);
    const page = roomPageByTest.get(testInfo);
    roomProgressByTest.delete(testInfo);
    roomPageByTest.delete(testInfo);
    if (testInfo.status !== testInfo.expectedStatus)
      console.info(
        'ROOM_FAILURE_ERROR ' +
          JSON.stringify({
            ...roomFailureMetadata(testInfo, progress?.assertion),
            progress: progress
              ? {
                  journey: progress.journey,
                  stage: progress.stage,
                  pose: progress.pose,
                  code: progress.code,
                  assertion: progress.assertion,
                }
              : null,
          }),
      );
    if (!progress || !page || testInfo.status === testInfo.expectedStatus)
      return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let completedMetrics: Awaited<
      ReturnType<typeof roomFailureMetrics>
    > | null = null;
    const captured = await Promise.race([
      Promise.all([
        roomFailureMetrics(page, progress).then((metrics) => {
          completedMetrics = metrics;
          return metrics;
        }),
        progress.journey === 'spatial-reveal'
          ? roomFailureSamples(page, progress)
          : null,
      ]).then(([metrics, samples]) => ({ metrics, samples })),
      new Promise<{
        metrics:
          | Awaited<ReturnType<typeof roomFailureMetrics>>
          | { available: false; timedOut: true };
        samples: null;
      }>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              metrics: completedMetrics ?? { available: false, timedOut: true },
              samples: null,
            }),
          1_000,
        );
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (captured.samples) {
      const samples = JSON.stringify(captured.samples);
      console.info(
        'ROOM_FAILURE_SAMPLES ' +
          (samples.length <= 16_384
            ? samples
            : JSON.stringify({ available: false, sizeBound: true })),
      );
    }
    const safeProgress = { ...progress };
    delete safeProgress.occupancyExpected;
    if (safeProgress.clickWitness?.blockerSamples) {
      console.info(
        'ROOM_DOM_BLOCKERS ' +
          JSON.stringify(safeProgress.clickWitness.blockerSamples),
      );
      safeProgress.clickWitness = { ...safeProgress.clickWitness };
      delete safeProgress.clickWitness.blockerSamples;
    }
    const failure = { ...safeProgress, metrics: captured.metrics };
    const serialized = JSON.stringify(failure);
    const log =
      serialized.length <= 4_096
        ? serialized
        : JSON.stringify({
            ...safeProgress,
            metrics: { available: false, sizeBound: true },
          });
    console.info('ROOM_FAILURE_CONTEXT ' + log);
    try {
      await testInfo.attach('room-failure-context', {
        body: serialized,
        contentType: 'application/json',
      });
    } catch {
      console.info('ROOM_FAILURE_ATTACHMENT_UNAVAILABLE');
    }
  });

  async function keyboardRoomLocation(page: Page, code: string) {
    const browser = page.getByRole('navigation', { name: 'Location browser' });
    await browser
      .getByRole('searchbox', { name: 'Browse locations' })
      .fill(code);
    const target = browser.getByRole('button', {
      name: new RegExp(`${code}$`),
    });
    await target.focus();
    await target.press('Enter');
  }

  async function settledReveal(
    page: Page,
    code: string,
    assertion?: (id: RoomAssertionId) => void,
  ) {
    const canvas = page.locator('[data-room-surface] canvas');
    assertion?.('reveal-open-code');
    await expect(canvas).toHaveAttribute('data-spatial-open-code', code);
    assertion?.('reveal-phase');
    await expect(canvas).toHaveAttribute('data-spatial-phase', 'settled');
    assertion?.('reveal-label-layout');
    await settledLabels(page);
  }

  async function camera(page: Page): Promise<CameraReading> {
    const canvas = page.locator(
      '[aria-label="Interactive room canvas"] canvas',
    );
    await expect(canvas).toHaveAttribute('data-camera-azimuth-unwrapped', /.+/);
    return canvas.evaluate((element) => ({
      azimuth: Number(element.getAttribute('data-camera-azimuth')),
      elevation: Number(element.getAttribute('data-camera-elevation')),
      unwrapped: Number(element.getAttribute('data-camera-azimuth-unwrapped')),
      zoom: Number(element.getAttribute('data-camera-zoom')),
      target: JSON.parse(element.getAttribute('data-camera-target')!),
      position: JSON.parse(element.getAttribute('data-camera-position')!),
      view: JSON.parse(element.getAttribute('data-camera-view-matrix')!),
      projection: JSON.parse(
        element.getAttribute('data-camera-projection-matrix')!,
      ),
      mode: element.getAttribute('data-orbit-mode')!,
    }));
  }

  function near(actual: number[], expected: number[], tolerance = 0.001) {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((value, index) =>
      expect(Math.abs(value - expected[index])).toBeLessThan(tolerance),
    );
  }
  return {
    inventoryName,
    locationNames,
    bindingBounds,
    login,
    chooseMapMode,
    setRoomLabels,
    selected,
    settledLabels,
    ready,
    roomProgressByTest,
    markRoomProgress,
    markRoomAssertion,
    trackRoomPage,
    keyboardRoomLocation,
    settledReveal,
    camera,
    near,
  };
}

export async function activateMap(page: Page) {
  if (await page.locator('canvas[data-map-active="true"]').count()) return;
  const more = page.getByRole('button', {
    name: 'More map controls',
    exact: true,
  });
  let activation = page
    .getByRole('button', { name: 'Interact with map', exact: true })
    .filter({ visible: true });
  const needsOverflow = (await activation.count()) === 0;
  const wasOpen = (await more.getAttribute('aria-expanded')) === 'true';
  if (needsOverflow && !wasOpen) await more.click();
  activation = page
    .getByRole('button', { name: 'Interact with map', exact: true })
    .filter({ visible: true });
  await activation.evaluate((element) =>
    element.focus({ preventScroll: true }),
  );
  await page.keyboard.press('Enter');
  if (needsOverflow && !wasOpen) await more.click();
  await expect(page.locator('canvas')).toHaveAttribute(
    'data-map-active',
    'true',
  );
}

export async function uncoveredCanvasGesture(
  page: Page,
  dx: number,
  dy: number,
) {
  const canvas = page.locator('[aria-label="Interactive room canvas"] canvas');
  const geometry = await canvas.evaluate((element) => ({
    canvas: element.getBoundingClientRect().toJSON(),
    viewport: { width: innerWidth, height: innerHeight },
  }));
  const candidates = canvasGestureCandidates(
    geometry.canvas,
    geometry.viewport,
    { dx, dy },
  );
  return canvas.evaluate(
    (element, gesture) => {
      // Preserve the full gesture extent and prove every sampled physical hit.
      // DOM labels remain genuine controls; no pointer event is forced through.
      for (const point of gesture.candidates) {
        const uncovered = Array.from({ length: 9 }, (_, step) => {
          const px = point.x + (gesture.dx * step) / 8;
          const py = point.y + (gesture.dy * step) / 8;
          return document.elementFromPoint(px, py) === element;
        }).every(Boolean);
        if (uncovered) return point;
      }
      throw new Error('No uncovered native canvas gesture path');
    },
    { candidates, dx, dy },
  );
}
