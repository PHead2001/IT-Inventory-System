import { expect, test, type Locator, type Page } from '@playwright/test';
import rawRoom from '../../data/rooms/it-closet.json' with { type: 'json' };
import { roomSchema, type RoomNode } from '../../src/features/room/schema';
import { buildRoomBindings } from '../../src/features/room/bindings';
import { toScenePosition } from '../../src/features/room/coordinates';
import { revealOffset } from '../../src/features/room/scene/spatial-reveal';
import {
  occupancyText,
  type RoomOccupancy,
} from '../../src/features/room/occupancy-contract';
import {
  acceptanceCommand,
  acceptanceFixtures,
  acceptanceLogin,
} from './audit-three-acceptance-fixtures';
import { chooseLocation } from './location-picker';
import { installRoomDrawObservation } from './room-draw-observation';
import { chooseRevealWitness } from './spatial-witness-choice';
import {
  captureRoomWitness,
  captureRoomSelectionWitness,
  roomVisibilityWitnesses,
  uncoveredRoomWitnesses,
} from './room-visibility-witness';
import {
  beginNewRecordTransaction,
  openRecordTask,
} from './record-task-controls';
import {
  observeSpatialComposition,
  expectSingleLiveRenderer,
  expectNoRendererOverlap,
  expectRevealPosition,
  armSpatialFrames,
} from './spatial-composition-observations';

const room = roomSchema.parse(rawRoom);
const bindings = buildRoomBindings(room);
function revealNode(code: string): RoomNode {
  const binding = bindings.find(
    (entry) => entry.code === code && entry.primary,
  );
  expect(binding, 'canonical primary binding ' + code).toBeTruthy();
  const find = (nodes: RoomNode[]): RoomNode | undefined => {
    for (const node of nodes) {
      if (node.id === binding!.nodeId) return node;
      const child = find(node.children ?? []);
      if (child) return child;
    }
  };
  return find(room.nodes)!;
}
async function selectRoom(page: Page, code: string) {
  const browser = page.getByRole('navigation', { name: 'Location browser' });
  await browser.getByRole('searchbox', { name: 'Browse locations' }).fill(code);
  await browser.getByRole('button', { name: new RegExp(`${code}$`) }).click();
  await expect(page.getByTestId('room-viewer')).toHaveAttribute(
    'data-selected-code',
    code,
  );
}
async function sceneReady(scope: Locator) {
  const canvas = scope.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-camera-position', /\[/);
  return canvas;
}
async function stageDrawerLabel(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Fit room', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const labels = dialog.getByRole('button', {
    name: 'Show labels',
    exact: true,
  });
  if ((await labels.getAttribute('aria-pressed')) !== 'true')
    await labels.click();
  await dialog
    .getByRole('button', { name: 'More map controls', exact: true })
    .click();
  const label = dialog.locator('[data-room-label-code="ITC-D01"]');
  await expect(label).toBeVisible();
  await label.click();
  await expect(dialog.locator('canvas')).toHaveAttribute(
    'data-spatial-open-code',
    'ITC-D01',
  );
}
async function receiveForm(page: Page) {
  const form = await openRecordTask(page, 'Receive stock');
  await form.getByLabel('Quantity to receive').fill('3');
  await form
    .getByLabel('Reason (required)')
    .fill('Keep this unsubmitted map draft');
  return form;
}

test('A302 map stages a destination UUID, preserves Cancel drafts and hands the actual graphics slot back to detail', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const owned = await acceptanceFixtures();
  try {
    const source = await owned.location('ITC-S1A');
    const destination = await owned.location('ITC-D01');
    const item = await owned.quantity('Map draft ' + owned.suffix, source, 5);
    await observeSpatialComposition(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await acceptanceLogin(page);
    await page.goto('/inventory/quantity/' + item);
    const preview = page.getByRole('region', { name: 'Storage preview' });
    await preview.scrollIntoViewIfNeeded();
    const originalCanvas = await sceneReady(preview);
    const original = await originalCanvas.elementHandle();
    await expectSingleLiveRenderer(page);
    const form = await receiveForm(page);
    await chooseLocation(form, 'Receive at', 'ITC-S1A');
    const value = form.getByRole('combobox', {
      name: 'Receive at',
      exact: true,
    });
    await expect(value).toContainText('ITC-S1A');
    // This counter observes server-action transport, not every POST endpoint.
    // The persisted version below independently proves no inventory write.
    let serverActionPosts = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action'])
        serverActionPosts++;
    });
    await form.getByRole('button', { name: 'Pick on map' }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Pick a storage location',
    });
    await expect(dialog).toBeVisible();
    await sceneReady(dialog);
    await expectSingleLiveRenderer(page);
    await expect
      .poll(() => original!.evaluate((canvas) => canvas.isConnected))
      .toBe(false);
    // Change from the source through the real visible map label, not through
    // a test callback or the dialog's conventional picker.
    await stageDrawerLabel(dialog);
    await expect(value).toContainText('ITC-S1A');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(value).toContainText('ITC-S1A');
    await expect(form.getByLabel('Quantity to receive')).toHaveValue('3');
    await expect(form.getByLabel('Reason (required)')).toHaveValue(
      'Keep this unsubmitted map draft',
    );
    await expect(
      form.getByRole('combobox', { name: 'Receive at', exact: true }),
    ).toBeFocused();
    await expect(
      preview.getByRole('button', { name: 'Resume map' }),
    ).toBeVisible();
    await preview.getByRole('button', { name: 'Resume map' }).click();
    await sceneReady(preview);
    await expectSingleLiveRenderer(page);
    await form.getByRole('button', { name: 'Pick on map' }).click();
    await sceneReady(dialog);
    await stageDrawerLabel(dialog);
    await dialog
      .getByRole('button', { name: 'Use location', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(value).toContainText('ITC-D01');
    await expect(value).toBeFocused();
    await expect(
      form.getByRole('region', { name: 'Review changes' }),
    ).toHaveCount(0);
    await expect(form.getByLabel('Reason (required)')).toHaveValue(
      'Keep this unsubmitted map draft',
    );
    expect(
      serverActionPosts,
      'no server-action POST during picker-only interactions',
    ).toBe(0);
    const persisted = await owned.caller
      .from('quantity_items')
      .select('version')
      .eq('id', item)
      .single();
    expect(persisted.error).toBeNull();
    expect(persisted.data!.version).toBe(1);
    // Only an explicit review and confirm may write. Read the persisted UUID;
    // this form's controlled picker intentionally renders no hidden UUID input.
    const confirmReceive = async (current: Locator) => {
      await current
        .getByRole('button', { name: 'Review receive stock', exact: true })
        .click();
      await current
        .getByRole('button', { name: 'Confirm receive stock', exact: true })
        .click();
      await expect(
        page
          .getByRole('region', { name: 'Record tasks' })
          .getByRole('button', { name: 'Done', exact: true }),
      ).toBeVisible();
    };
    const balance = async () => {
      const result = await owned.caller
        .from('stock_balances')
        .select('location_id,quantity')
        .eq('item_id', item)
        .eq('location_id', destination)
        .single();
      expect(result.error).toBeNull();
      return result.data!;
    };
    await confirmReceive(form);
    expect(await balance()).toEqual({ location_id: destination, quantity: 3 });
    await beginNewRecordTransaction(page, 'New transaction');
    const treeForm = await receiveForm(page);
    await chooseLocation(treeForm, 'Receive at', 'ITC-D01');
    await confirmReceive(treeForm);
    expect(await balance()).toEqual({ location_id: destination, quantity: 6 });
    await expectNoRendererOverlap(page);
    await page.screenshot({
      path: testInfo.outputPath('map-destination-draft.png'),
      fullPage: true,
    });
  } finally {
    await owned.cleanup();
  }
});

test('A302 graphics failure and unmodeled destination keep the real keyboard tree and form draft usable', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const owned = await acceptanceFixtures();
  try {
    const item = await owned.quantity(
      'Map alternatives ' + owned.suffix,
      await owned.location('ITC-S1A'),
      2,
    );
    const unmodeled = await owned.ownedLocation('Unmodeled map destination');
    await acceptanceLogin(page);
    await page.goto('/inventory/quantity/' + item);
    const form = await receiveForm(page);
    await form.getByRole('button', { name: 'Pick on map' }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Pick a storage location',
    });
    const canvas = await sceneReady(dialog);
    // Browser's actual context-loss event exercises the production failure path.
    await canvas.evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement))
        throw new Error('Expected actual canvas');
      const gl = element.getContext('webgl2');
      if (!gl) throw new Error('Actual WebGL2 context unavailable');
      const extension = gl.getExtension('WEBGL_lose_context');
      if (!extension)
        throw new Error('Browser cannot exercise actual context loss');
      extension.loseContext();
    });
    await expect(
      dialog.getByText(
        'Map unavailable. The recorded location and location browser remain available.',
      ),
    ).toBeVisible();
    const browser = dialog.getByRole('combobox', {
      name: 'Choose location in browser',
      exact: true,
    });
    await browser.focus();
    await browser.press('Enter');
    const search = dialog.getByRole('combobox', { name: 'Search locations' });
    await expect(search).toBeFocused();
    await search.fill(unmodeled.code);
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(browser).toContainText(unmodeled.code);
    await expect(
      dialog.getByText(
        'This location has no modeled map. Use its recorded location below.',
      ),
    ).toBeVisible();
    await expect(dialog.locator('canvas')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Use location' }).click();
    await expect(
      form.getByRole('combobox', { name: 'Receive at', exact: true }),
    ).toContainText(unmodeled.code);
    await expect(form.getByLabel('Quantity to receive')).toHaveValue('3');
    await expect(
      form.getByRole('region', { name: 'Review changes' }),
    ).toHaveCount(0);
  } finally {
    await owned.cleanup();
  }
});

for (const surface of ['quantity', 'asset', 'location'] as const) {
  test(`A303 ${surface} detail initializes its actual lazy preview independently of record readiness`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const owned = await acceptanceFixtures();
    try {
      const source = await owned.location('ITC-S1A');
      let path = '/locations/ITC-S1A';
      if (surface === 'quantity') {
        const item = await owned.quantity(
          'Explicit preview choice ' + owned.suffix,
          source,
          5,
        );
        await acceptanceCommand(owned.caller, 'quantity_receive', {
          item_id: item,
          expected_version: 1,
          location_id: await owned.location('ITC-D01'),
          quantity: 4,
          reason: 'Owned preview second holding',
        });
        path = '/inventory/quantity/' + item;
      } else if (surface === 'asset') {
        path =
          '/inventory/assets/' +
          (await owned.asset('Lazy preview asset ' + owned.suffix, source));
      }
      await observeSpatialComposition(page);
      // Deliberately small initial visible region places the preview outside
      // its documented 100px lazy margin; restore phone height for inspection.
      await page.setViewportSize({ width: 390, height: 200 });
      await acceptanceLogin(page);
      await page.goto(path);
      await expect(
        page.getByRole('main').getByRole('heading', { level: 1 }),
      ).toBeVisible();
      const progress = page.locator('.experience-route-progress');
      await expect(progress).toHaveAttribute('data-visible', 'false');
      await expect(progress).toHaveAttribute('aria-hidden', 'true');
      await expect(progress.locator('[role="status"]')).toHaveCount(0);
      const preview = page.getByRole('region', { name: 'Storage preview' });
      if (surface === 'quantity') {
        await expect(
          preview.getByText('Choose a location to preview its map.'),
        ).toBeVisible();
        await expect(preview.locator('canvas')).toHaveCount(0);
        const choice = preview.getByLabel('Choose a recorded stock location');
        await expect(choice).toHaveValue('');
        await expect(choice.locator('option')).toHaveCount(3);
        await choice.selectOption('ITC-D01');
      } else {
        // The near-region observer must not initialize an offscreen preview.
        const bounds = await preview.boundingBox();
        expect(bounds!.y).toBeGreaterThan(300);
        await expect(preview.locator('canvas')).toHaveCount(0);
      }
      await preview.scrollIntoViewIfNeeded();
      await page.setViewportSize({ width: 390, height: 844 });
      const canvas = await sceneReady(preview);
      const code = surface === 'quantity' ? 'ITC-D01' : 'ITC-S1A';
      await expect(canvas).toHaveAttribute('data-spatial-open-code', code);
      await expect(
        preview.getByRole('button', { name: /^Select / }),
      ).toHaveCount(0);
      await expect(
        preview.locator('[data-room-decorative-label]'),
      ).not.toHaveCount(0);
      expect(
        await canvas.evaluate((element) => {
          const state = [...(window.__roomWitnessStores ?? [])]
            .map((store) => store.getState())
            .find((state) => state.gl.domElement === element);
          if (!state) throw new Error('Expected actual preview scene');
          let selectionVolumes = 0,
            selectionHandlers = 0;
          state.scene.traverse((object) => {
            if (object.userData.roomSelectionTarget) selectionVolumes++;
            if (!object.userData.roomHoverTarget) return;
            const handlers = (
              object as typeof object & {
                __r3f?: { handlers?: Record<string, unknown> };
              }
            ).__r3f?.handlers;
            for (const key of [
              'onClick',
              'onPointerDown',
              'onPointerUp',
              'onPointerCancel',
            ])
              if (handlers?.[key]) selectionHandlers++;
          });
          return { selectionVolumes, selectionHandlers };
        }),
      ).toEqual({ selectionVolumes: 0, selectionHandlers: 0 });
      await expect(
        (surface === 'location'
          ? page.getByRole('navigation', { name: 'Location actions' })
          : preview
        ).getByRole('link', { name: 'Show ' + code + ' in room' }),
      ).toBeVisible();
      if (surface === 'location')
        await expect(
          page.getByRole('link', { name: 'Show ' + code + ' in room' }),
        ).toHaveCount(1);
      await expectSingleLiveRenderer(page);
      if (surface === 'quantity') {
        await preview
          .getByLabel('Choose a recorded stock location')
          .selectOption('ITC-S1A');
        await expect(preview.locator('canvas')).toHaveAttribute(
          'data-spatial-open-code',
          'ITC-S1A',
        );
        await expect(
          preview.getByRole('link', { name: 'Show ITC-S1A in room' }),
        ).toBeVisible();
        await expectSingleLiveRenderer(page);
      }
      await page.screenshot({
        path: testInfo.outputPath(surface + '-lazy-preview-390.png'),
        fullPage: true,
      });
      await expectNoRendererOverlap(page);
    } finally {
      await owned.cleanup();
    }
  });
}

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`W13 ${motion} drawer, container and shelf bodies visibly reveal with exact selected counts and reverse on clear`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const owned = await acceptanceFixtures();
    try {
      const codes = ['ITC-D01', 'ITC-RED', 'ITC-S1A'];
      const item = await owned.quantity(
        'Reveal counts ' + owned.suffix,
        await owned.location(codes[0]),
        5,
      );
      for (const [index, code] of codes.slice(1).entries())
        await acceptanceCommand(owned.caller, 'quantity_receive', {
          item_id: item,
          expected_version: index + 1,
          location_id: await owned.location(code),
          quantity: 5,
          reason: 'Owned revealed stock fixture',
        });
      await observeSpatialComposition(page);
      await page.emulateMedia({ reducedMotion: motion });
      await acceptanceLogin(page);
      await page.goto('/room');
      const viewer = page.getByTestId('room-viewer');
      const canvas = await sceneReady(viewer);
      for (const code of codes) {
        const node = revealNode(code);
        await expectRevealPosition(canvas, node.id, [0, 0, 0]);
        const snapshot = page.waitForResponse(
          (response) =>
            response.url().includes('/api/room/occupancy?') &&
            response.status() === 200,
        );
        await selectRoom(page, code);
        const counts: { counts: RoomOccupancy } = await (await snapshot).json();
        await expect(canvas).toHaveAttribute('data-spatial-phase', 'settled');
        await expectRevealPosition(
          canvas,
          node.id,
          toScenePosition(revealOffset(node)),
        );
        const badge = viewer.locator('[data-room-label-code="' + code + '"]');
        await expect(badge).toBeVisible();
        await expect(badge).toContainText(
          occupancyText(counts.counts[code], true),
        );
        await expect(badge).toHaveAccessibleName(
          new RegExp(occupancyText(counts.counts[code], true)),
        );
        await viewer.getByRole('button', { name: 'More map controls' }).click();
        await expect(
          viewer.getByRole('button', { name: 'Show item counts' }),
        ).toHaveAttribute('aria-pressed', 'false');
        await viewer.getByRole('button', { name: 'More map controls' }).click();
        await page.screenshot({
          path: testInfo.outputPath(code + '-revealed-counts.png'),
        });
        await page.getByRole('button', { name: 'Clear selection' }).click();
        await expect(canvas).toHaveAttribute('data-spatial-open-code', '');
        await expectRevealPosition(canvas, node.id, [0, 0, 0]);
        await expect(viewer).toHaveAttribute('data-selected-code', '');
        await page.screenshot({
          path: testInfo.outputPath(code + '-cleared-rest.png'),
        });
      }
    } finally {
      await owned.cleanup();
    }
  });
}

test('A303 an owned unmodeled closet child keeps truthful recorded previews without a canvas or counts read', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const owned = await acceptanceFixtures();
  try {
    const location = await owned.ownedLocation(
      'Recorded unmodeled closet storage',
      'ITC',
    );
    const quantity = await owned.quantity(
      'Unmodeled preview stock ' + owned.suffix,
      location.id,
      2,
    );
    const asset = await owned.asset(
      'Unmodeled preview asset ' + owned.suffix,
      location.id,
    );
    await acceptanceLogin(page);
    let countReads = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/room/occupancy?')) countReads++;
    });
    for (const path of [
      '/locations/' + location.code,
      '/inventory/quantity/' + quantity,
      '/inventory/assets/' + asset,
    ]) {
      await page.goto(path);
      const preview = page.getByRole('region', { name: 'Storage preview' });
      await preview.scrollIntoViewIfNeeded();
      await expect(
        preview.getByText(
          'This location has no modeled map. Use its recorded location below.',
        ),
      ).toBeVisible();
      await expect(preview.getByText(new RegExp(location.name))).toBeVisible();
      await expect(
        (path.startsWith('/locations/')
          ? page.getByRole('navigation', { name: 'Location actions' })
          : preview
        ).getByRole('link', {
          name: 'Show ' + location.code + ' in Spaces',
        }),
      ).toBeVisible();
      if (path.startsWith('/locations/'))
        await expect(
          page.getByRole('link', {
            name: 'Show ' + location.code + ' in Spaces',
          }),
        ).toHaveCount(1);
      await expect(preview.locator('canvas')).toHaveCount(0);
    }
    expect(countReads).toBe(0);
  } finally {
    await owned.cleanup();
  }
});

test('W14 actual Full flight precedes reveal, newer selection retires it, and Reduced snaps the complete endpoint', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await observeSpatialComposition(page);
  await page.clock.install();
  await page.addInitScript(installRoomDrawObservation);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await acceptanceLogin(page);
  await page.goto('/room');
  const viewer = page.getByTestId('room-viewer');
  const canvas = await sceneReady(viewer);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 10_000));
  const initialTarget = await canvas.getAttribute('data-camera-target');
  await selectRoom(page, 'ITC-D01');
  // The workspace and Fiber are separate React roots. Wait for this request,
  // not the workspace selection or a phase left over from the previous flight,
  // before advancing the paused clock through its physical motion budget.
  const expectAcceptedRequest = async (code: string) => {
    await expect
      .poll(async () => {
        const raw = await canvas.getAttribute('data-spatial-request');
        return raw ? (JSON.parse(raw) as { code: string | null }).code : null;
      })
      .toBe(code);
  };
  await expectAcceptedRequest('ITC-D01');
  await page.clock.runFor(16);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'flying');
  await expectRevealPosition(canvas, revealNode('ITC-D01').id, [0, 0, 0]);
  await page.clock.runFor(400);
  expect(await canvas.getAttribute('data-camera-target')).not.toBe(
    initialTarget,
  );
  await expect(canvas).toHaveAttribute('data-spatial-open-code', '');
  const witness = await captureRoomWitness(page);
  const physicalWitnesses = roomVisibilityWitnesses(witness);
  // A physically visible face can lie behind a different resting selection
  // volume. Retain physical/DOM visibility and require the same selection owner
  // at each point before choosing the real interrupted-flight click.
  const selectionWitness = await captureRoomSelectionWitness(page);
  const exposed = await uncoveredRoomWitnesses(
    page,
    physicalWitnesses,
    selectionWitness,
  );
  const replacement = chooseRevealWitness(
    bindings
      .filter((binding) => binding.primary)
      .map((binding) => revealNode(binding.code)),
    'ITC-D01',
    exposed,
  );
  if (!replacement) {
    await testInfo.attach('interrupted-flight-visible-surface-diagnostic', {
      body: JSON.stringify({
        target: await canvas.getAttribute('data-camera-target'),
        position: await canvas.getAttribute('data-camera-position'),
        view: witness.view,
        projection: witness.projection,
        frame: witness.frame,
        maskCount: witness.masks.length,
        candidateCodes: bindings
          .filter((binding) => binding.primary)
          .map((binding) => revealNode(binding.code))
          .filter(
            (node) =>
              node.kind === 'box' &&
              node.visual?.style !== 'rack' &&
              node.interaction?.selectable &&
              node.locationCode !== 'ITC-D01' &&
              revealOffset(node).some((value) => value !== 0),
          )
          .map((node) => node.locationCode)
          .sort(),
        physicalCodes: [...physicalWitnesses.keys()].sort(),
        uncoveredCodes: [...exposed.keys()].sort(),
        selectionOwnershipChecked: true,
      }),
      contentType: 'application/json',
    });
    throw new Error(
      'No independently witnessed uncovered revealable surface is available to interrupt the drawer flight',
    );
  }
  const {
    code: replacementCode,
    node: replacementNode,
    point: replacementPoint,
  } = replacement;
  await page.evaluate(() => window.__roomDrawObservation!.reset());
  const requestedAt = await page.evaluate(() => performance.now());
  await page.mouse.click(replacementPoint.x, replacementPoint.y);
  await expect(viewer).toHaveAttribute('data-selected-code', replacementCode);
  await expectAcceptedRequest(replacementCode);
  const acceptedAt = await page.evaluate(() => performance.now());
  // Synchronization must not consume or restart the click-to-reveal budget.
  expect(acceptedAt).toBe(requestedAt);
  await page.clock.runFor(16);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'flying');
  await page.clock.runFor(728);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'flying');
  await expect(canvas).toHaveAttribute('data-spatial-open-code', '');
  await expectRevealPosition(canvas, replacementNode.id, [0, 0, 0]);
  // Observe the first phase publication across this narrow frame boundary.
  // Its timestamp is independent of the next draw's passive telemetry.
  for (let step = 0; step < 32; step++) {
    await page.clock.runFor(1);
    if ((await canvas.getAttribute('data-spatial-phase')) === 'revealing')
      break;
  }
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'revealing');
  await expect(canvas).toHaveAttribute(
    'data-spatial-open-code',
    replacementCode,
  );
  const arrivedTarget = await canvas.getAttribute('data-camera-target');
  await expectRevealPosition(canvas, revealNode('ITC-D01').id, [0, 0, 0]);
  const revealAt = await page.evaluate(() => performance.now());
  expect(revealAt - requestedAt).toBeGreaterThanOrEqual(750);
  expect(revealAt - requestedAt).toBeLessThanOrEqual(776);
  await page.clock.runFor(384);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'revealing');
  await page.clock.runFor(32);
  await expect(canvas).toHaveAttribute('data-camera-target', arrivedTarget!);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'settled');
  await expectRevealPosition(
    canvas,
    replacementNode.id,
    toScenePosition(revealOffset(replacementNode)),
  );
  const temporalDraws = await page.evaluate(() =>
    window.__roomDrawObservation!.snapshot(),
  );
  expect(temporalDraws.overflow).toBe(false);
  expect(
    temporalDraws.frames.some(
      (frame) => frame.phase === 'flying' && frame.open === '',
    ),
  ).toBe(true);
  expect(
    temporalDraws.frames.some(
      (frame) => frame.phase === 'settled' && frame.open === replacementCode,
    ),
  ).toBe(true);
  await testInfo.attach('full-flight-reveal-draw-timeline', {
    body: JSON.stringify({
      replacementCode,
      requestedAt,
      acceptedAt,
      revealAt,
      flightMs: revealAt - requestedAt,
      beforeRevealCompletionMs: 384,
      afterRevealCompletionMs: 416,
      draws: temporalDraws,
    }),
    contentType: 'application/json',
  });
  // Real toolbar input interrupts before the older drawer flight can reveal.
  await selectRoom(page, 'ITC-D01');
  await page.clock.runFor(100);
  await viewer.getByRole('button', { name: 'More map controls' }).click();
  await viewer.getByRole('button', { name: 'Pan right' }).click();
  await page.clock.runFor(1200);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'cancelled');
  await expect(canvas).toHaveAttribute('data-spatial-open-code', '');
  await expectRevealPosition(canvas, revealNode('ITC-D01').id, [0, 0, 0]);
  await viewer.getByRole('button', { name: 'More map controls' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await selectRoom(page, 'ITC-S1A');
  await page.clock.runFor(32);
  await expect(canvas).toHaveAttribute('data-spatial-phase', 'settled');
  await expectRevealPosition(
    canvas,
    revealNode('ITC-S1A').id,
    toScenePosition(revealOffset(revealNode('ITC-S1A'))),
  );
  const pendingFrames = await armSpatialFrames(canvas, 3);
  try {
    await page.clock.runFor(64);
    const samples = await pendingFrames.read();
    expect(samples).toHaveLength(3);
    expect(
      samples.every(
        (sample) => sample.phase === 'settled' && sample.open === 'ITC-S1A',
      ),
    ).toBe(true);
  } finally {
    await pendingFrames.dispose();
  }
  await page.screenshot({
    path: testInfo.outputPath('reduced-complete-spatial-endpoint.png'),
  });
  await page.evaluate(() => window.__roomDrawObservation!.stop());
});

test('A303 cold compact scene chunk preserves the normal phone preview and downstream anchor through counts arrival', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await acceptanceLogin(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const pattern = '**/_next/static/chunks/*.js';
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    // Hold the actual served module, identified by its unique scene markup.
    // Other chunks retain their real response bodies; no app state is injected.
    if (
      body.length <= 4_194_304 &&
      body.toString().includes('Interactive room canvas')
    ) {
      held = true;
      await gate;
    }
    await route.fulfill({ response });
  });
  try {
    await page.goto('/locations/ITC-S1A', { waitUntil: 'domcontentloaded' });
    const preview = page.getByRole('region', { name: 'Storage preview' });
    await preview.scrollIntoViewIfNeeded();
    await expect.poll(() => held).toBe(true);
    await expect(
      preview.locator('[data-loading-shape="compact-room"]'),
    ).toBeVisible();
    await expect(preview.locator('[data-loading-shape="room"]')).toHaveCount(0);
    await expect(preview.locator('canvas')).toHaveCount(0);
    const measure = () =>
      preview.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        downstream:
          element.nextElementSibling!.getBoundingClientRect().top +
          window.scrollY,
      }));
    await page.evaluate(() => document.fonts.ready);
    const loading = await measure();
    await page.screenshot({
      path: testInfo.outputPath('compact-cold-390.png'),
    });
    const counts = page.waitForResponse((response) =>
      response.url().includes('/api/room/occupancy?'),
    );
    release();
    const canvas = await sceneReady(preview);
    await expect(canvas).toHaveAttribute('data-spatial-phase', 'settled');
    const response = await counts;
    expect(response.ok()).toBe(true);
    await expect(
      preview.getByText('Loading counts for the opened location…'),
    ).toHaveCount(0);
    const ready = await measure();
    expect(Math.abs(ready.height - loading.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(ready.downstream - loading.downstream)).toBeLessThanOrEqual(
      1,
    );
    await expect(
      preview.getByRole('button', { name: 'Zoom in' }),
    ).toBeEnabled();
    await expect(
      preview.getByRole('button', { name: 'More map controls' }),
    ).toBeEnabled();
    await testInfo.attach('compact-cold-chunk-phone-layout', {
      body: JSON.stringify({
        loading,
        ready,
        viewport: { width: 390, height: 844 },
      }),
      contentType: 'application/json',
    });
    await page.screenshot({
      path: testInfo.outputPath('compact-ready-390.png'),
    });
  } finally {
    release();
    await page.unroute(pattern);
  }
});
