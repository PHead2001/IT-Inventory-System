import { expect, test, type Page, type Request } from '@playwright/test';
import { withHeldQuantityPrimary } from './route-primary-delay';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { withDisposablePasswordAccount } from './disposable-password-account';
import {
  auditCategory,
  auditCreateRecord,
  auditLogin,
  auditReadback,
  auditOpenMetadataTask,
} from './audit-two-controls';
import { metadataReviewButton, metadataSaveButton } from './metadata-controls';
import {
  isLogoutGeneration,
  logoutAcknowledgementKey,
} from '../../src/lib/auth/privacy-barrier';
import {
  fetchFullQuantityFlightProbe,
  readFallbackMarker,
} from './quantity-flight-probe';

type Capture = { name: string; tag: string; canvas: boolean; shell: boolean };
type Proof = {
  transitions: Array<{
    old: Capture[];
    next: Capture[];
    ready: boolean;
    finished: boolean;
    completionMs?: number;
    finishRejected?: boolean;
  }>;
  cancellations: Array<{ pseudo: string; whileActive: boolean }>;
  replacements: Array<{
    pseudo: string;
    frames: Keyframe[];
    duration: number;
    delay: number;
  }>;
  cls: number;
};

/** Passive native/WAAPI observation; React still invokes and commits transitions. */
async function observeMotion(page: Page, unsupported = false) {
  await page.addInitScript(
    ({ unsupported }) => {
      const proof: Proof = {
        transitions: [],
        cancellations: [],
        replacements: [],
        cls: 0,
      };
      Object.assign(window, { routeMotionProof: proof });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            hadRecentInput: boolean;
            value: number;
          };
          if (!shift.hadRecentInput) proof.cls += shift.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      const capture = (): Capture[] =>
        Array.from(document.querySelectorAll('*')).flatMap((element) => {
          const name = getComputedStyle(element).viewTransitionName;
          if (!name || name === 'none') return [];
          return [
            {
              name,
              tag: element.tagName,
              canvas:
                element.tagName === 'CANVAS' ||
                !!element.querySelector('canvas'),
              shell:
                !!element.querySelector('.experience-header') ||
                element.classList.contains('experience-header'),
            },
          ];
        });
      if (unsupported) {
        Object.defineProperty(document, 'startViewTransition', {
          configurable: true,
          value: undefined,
        });
        return;
      }
      const native = document.startViewTransition.bind(document);
      document.startViewTransition = ((
        options: Parameters<Document['startViewTransition']>[0],
      ) => {
        const entry: Proof['transitions'][number] = {
          old: capture(),
          next: [],
          ready: false,
          finished: false,
        };
        proof.transitions.push(entry);
        const update =
          typeof options === 'function' ? options : options?.update;
        const wrapped = async () => {
          await update?.();
          entry.next = capture();
        };
        const transition = native(
          typeof options === 'function'
            ? wrapped
            : { ...options, update: wrapped },
        );
        let readyAt: number | undefined;
        void transition.ready.then(
          () => {
            readyAt = performance.now();
            entry.ready = true;
            // A timing barrier only: the binding never starts, pauses or
            // changes the native animation or React's commit.
            void (
              window as Window & { routeMotionReady?: () => Promise<void> }
            ).routeMotionReady?.();
          },
          () => {},
        );
        void transition.finished.then(
          () => {
            entry.finished = true;
            if (readyAt !== undefined)
              entry.completionMs = performance.now() - readyAt;
          },
          () => {
            entry.finished = true;
            entry.finishRejected = true;
          },
        );
        return transition;
      }) as Document['startViewTransition'];
      const cancel = Animation.prototype.cancel;
      Animation.prototype.cancel = function () {
        const pseudo = (this.effect as KeyframeEffect | null)?.pseudoElement;
        if (pseudo?.startsWith('::view-transition'))
          proof.cancellations.push({
            pseudo,
            whileActive: proof.transitions.some(
              (entry) => entry.ready && !entry.finished,
            ),
          });
        return cancel.call(this);
      };
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (
          typeof options === 'object' &&
          options.pseudoElement?.startsWith(
            '::view-transition-group(inventory-title-',
          )
        ) {
          proof.replacements.push({
            pseudo: options.pseudoElement,
            frames: frames as Keyframe[],
            duration: Number(options.duration),
            delay: Number(options.delay ?? 0),
          });
        }
        return animate.call(this, frames, options);
      };
    },
    { unsupported },
  );
}
async function proof(page: Page) {
  return page.evaluate(
    () => (window as Window & { routeMotionProof?: Proof }).routeMotionProof!,
  );
}
async function settled(page: Page) {
  await expect
    .poll(async () =>
      (await proof(page)).transitions.every((entry) => entry.finished),
    )
    .toBe(true);
}
async function resetProof(page: Page) {
  await settled(page);
  await page.evaluate(() => {
    const p = (window as Window & { routeMotionProof?: Proof })
      .routeMotionProof!;
    p.transitions = [];
    p.cancellations = [];
    p.replacements = [];
    p.cls = 0;
  });
}

/** A paired image fade must release the native transition, so the next real
 * navigation can capture. No animation is started, resumed or skipped here. */
async function completedTitlePair(
  page: Page,
  preserveProof?: (observed: Proof) => Promise<void>,
) {
  let settlementError: unknown;
  try {
    await settled(page);
  } catch (error) {
    settlementError = error;
  }
  const observed = await proof(page);
  await preserveProof?.(observed);
  const paired = observed.transitions.filter((entry) =>
    entry.old.some(
      (old) =>
        old.name.startsWith('inventory-title-') &&
        entry.next.some((next) => next.name === old.name),
    ),
  );
  const tags = (captures: Capture[]) =>
    captures
      .slice(0, 6)
      .map(({ tag }) =>
        ['A', 'H1', 'DIV', 'MAIN', 'SPAN', 'CANVAS'].includes(tag)
          ? tag
          : 'other',
      );
  // CI artifact quotas must not erase the failure's bounded, non-private facts.
  const diagnostic =
    'Native title pairing: ' +
    JSON.stringify({
      transitions: observed.transitions.length,
      pairs: paired.length,
      replacements: observed.replacements.length,
      entries: observed.transitions.slice(0, 6).map((entry) => ({
        ready: entry.ready,
        finished: entry.finished,
        rejected: entry.finishRejected === true,
        oldCount: entry.old.length,
        nextCount: entry.next.length,
        oldTags: tags(entry.old),
        nextTags: tags(entry.next),
      })),
    });
  if (settlementError) throw new Error(diagnostic, { cause: settlementError });
  expect(paired, diagnostic).toHaveLength(1);
  expect(paired[0], diagnostic).toMatchObject({ ready: true, finished: true });
  expect(paired[0].finishRejected, diagnostic).not.toBe(true);
  expect(Number.isFinite(paired[0].completionMs), diagnostic).toBe(true);
  expect(paired[0].completionMs!, diagnostic).toBeGreaterThanOrEqual(0);
  // Motion is 200ms; leave bounded scheduler headroom, never a native timeout.
  expect(paired[0].completionMs!, diagnostic).toBeLessThan(1500);
  return observed;
}

/** A separate full-route Flight reader proves fallback bytes while the actual
 * browser navigation streams normally and its database read is held. Cookie
 * and body stay in memory and are never attached or logged. */
async function earlyQuantityFallback(request: Request) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 1500);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stage = 'request-headers';
  let status: number | undefined;
  let bytes = 0;
  try {
    const browserHeaders = await request.allHeaders();
    stage = 'response-headers';
    const response = await fetchFullQuantityFlightProbe(
      request.url(),
      browserHeaders.cookie ?? '',
      controller.signal,
    );
    status = response.status;
    if (response.body) reader = response.body.getReader();
    if (
      response.status !== 200 ||
      response.redirected ||
      response.headers.get('content-type')?.split(';')[0].trim() !==
        'text/x-component' ||
      !reader
    ) {
      throw new Error('Invalid full Flight response.');
    }
    stage = 'body';
    const streamedBytes = await readFallbackMarker(reader, (readBytes) => {
      bytes = readBytes;
      if (bytes > 0) stage = 'markerwait';
    });
    return { fallbackBeforePrimaryRelease: true, streamedBytes };
  } catch {
    throw new Error(
      `Quantity Flight probe failed: stage=${stage}; bytes=${bytes}; status=${status ?? 'none'}.`,
    );
  } finally {
    clearTimeout(deadline);
    controller.abort();
    await reader?.cancel().catch(() => {});
  }
}

/** Owned actor only; no shared Staff permissions or hosted fixture mutation. */
async function withMotionActor(
  page: Page,
  run: (actor: {
    id: string;
    signIn: () => Promise<void>;
    configurationAccess: (allowed: boolean) => Promise<void>;
  }) => Promise<void>,
) {
  const api = new URL(process.env.LOCAL_API_URL!);
  expect(['localhost', '127.0.0.1']).toContain(api.hostname);
  expect(api.port).toBe('54321');
  const admin = createClient(api.href, process.env.LOCAL_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `motion-${crypto.randomUUID()}@example.test`;
  const signIn = async () => {
    if (new URL(page.url()).pathname !== '/login') await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Inventory', exact: true }),
    ).toBeVisible();
  };
  await withDisposablePasswordAccount(
    admin,
    { email, password: fixture.password },
    async () => {
      const logout = page.getByRole('button', {
        name: 'Sign out',
        exact: true,
      });
      if (await logout.isVisible()) {
        await logout.click();
        await expect(page).toHaveURL(/\/login$/);
      }
    },
    async () => {
      const users = await admin.auth.admin.listUsers({ perPage: 1000 });
      expect(users.error).toBeNull();
      const id = users.data.users.find((user) => user.email === email)!.id;
      const configurationAccess = async (allowed: boolean) => {
        const result = await admin
          .from('app_members')
          .update({
            role: 'staff',
            active: true,
            can_manage_configuration: allowed,
          })
          .eq('user_id', id)
          .select('user_id,role,active,can_manage_configuration')
          .single();
        expect(result.error).toBeNull();
        expect(result.data).toMatchObject({
          user_id: id,
          role: 'staff',
          active: true,
          can_manage_configuration: allowed,
        });
      };
      await configurationAccess(true);
      await signIn();
      await run({ id, signIn, configurationAccess });
    },
  );
}

/** Hold delivery of a genuine read-only server denial, never fabricate Flight. */
async function holdIdentityDenial(page: Page, actorId: string) {
  let release!: () => void;
  let fetched!: () => void;
  let fetchFailed!: (error: unknown) => void;
  let delivered!: () => void;
  let deliveryFailed!: (error: unknown) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve, reject) => {
    fetched = resolve;
    fetchFailed = reject;
  });
  const delivery = new Promise<void>((resolve, reject) => {
    delivered = resolve;
    deliveryFailed = reject;
  });
  void delivery.catch(() => {});
  void ready.catch(() => {});
  const pattern = '**/settings/forms/**';
  const handler: Parameters<Page['route']>[1] = async (route) => {
    const request = route.request();
    if (
      request.method() !== 'POST' ||
      !request.headers()['next-action'] ||
      request.postData() !== JSON.stringify([actorId])
    )
      return route.continue();
    try {
      const response = await route.fetch({ timeout: 15_000 });
      expect(response.ok()).toBe(true);
      expect(await response.text()).toMatch(/"ok":false[^\n]*"code":"P1001"/);
      fetched();
      await gate;
      await route.fulfill({ response });
      delivered();
    } catch (error) {
      fetchFailed(error);
      deliveryFailed(error);
      await route.abort('failed').catch(() => {});
    }
  };
  await page.route(pattern, handler);
  const request = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      !!request.headers()['next-action'] &&
      request.postData() === JSON.stringify([actorId]),
    { timeout: 15_000 },
  );
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await request;
    await ready;
  } catch (error) {
    release();
    await page.unroute(pattern, handler);
    throw error;
  }
  return {
    release,
    delivery,
    dispose: async () => {
      release();
      await delivery;
      await page.unroute(pattern, handler);
    },
  };
}

async function assertNoNativeSnapshots(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) =>
              (
                animation.effect as KeyframeEffect | null
              )?.pseudoElement?.startsWith('::view-transition'),
            ).length,
      ),
    )
    .toBe(0);
}

async function atNextNativeReady(page: Page, run: () => Promise<void>) {
  let done!: () => void;
  let failed!: (error: unknown) => void;
  const completed = new Promise<void>((resolve, reject) => {
    done = resolve;
    failed = reject;
  });
  let armed = true;
  await page.exposeBinding('routeMotionReady', async () => {
    if (!armed) return;
    armed = false;
    try {
      const active = await page.evaluate(() => {
        const p = (window as Window & { routeMotionProof?: Proof })
          .routeMotionProof!;
        return (
          p.transitions.some((entry) => entry.ready && !entry.finished) &&
          document
            .getAnimations()
            .some(
              (animation) =>
                (
                  animation.effect as KeyframeEffect | null
                )?.pseudoElement?.startsWith('::view-transition') &&
                animation.playState === 'running',
            )
        );
      });
      expect(
        active,
        'The operation must occur during an actual running native snapshot animation',
      ).toBe(true);
      await run();
      done();
    } catch (error) {
      failed(error);
    }
  });
  return { completed };
}

async function navigationLink(page: Page, name: string) {
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  if (!(await navigation.isVisible())) {
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.click();
    await expect(
      page.getByRole('button', { name: 'Close menu', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
  }
  const link = navigation.getByRole('link', { name, exact: true });
  await expect(link).toBeVisible();
  return link;
}

for (const width of [1280, 390]) {
  test(`permitted logout cancels a running native snapshot before leaving the protected shell at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await observeMotion(page);
    await auditLogin(page);
    await resetProof(page);
    const originalDocument = await page.evaluate(() => performance.timeOrigin);
    const { completed } = await atNextNativeReady(page, async () => {
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    });
    await (await navigationLink(page, 'History')).click();
    await completed;
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      originalDocument,
    );
    await expect(page.locator('html')).toHaveAttribute(
      'data-route-motion-private',
      'false',
    );
    await assertNoNativeSnapshots(page);
    const cancelled = await proof(page);
    expect(cancelled.cancellations.some((entry) => entry.whileActive)).toBe(
      true,
    );
    await info.attach('logout-during-native-route-animation', {
      body: JSON.stringify(cancelled),
      contentType: 'application/json',
    });
  });

  test(`real same-actor access denial cancels a running snapshot and suppresses later routes at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await observeMotion(page);
    // Audit fixture Staff creates the category. The disposable subject performs
    // only reads, so append-only event actor FKs never obstruct account cleanup.
    await auditLogin(page);
    const category = await auditCategory(page);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await withMotionActor(page, async (actor) => {
      await page.goto(category.url);
      await expect(
        page.getByRole('heading', {
          name: `${category.name} form`,
          exact: true,
        }),
      ).toBeVisible();
      await actor.configurationAccess(false);
      const pending = await holdIdentityDenial(page, actor.id);
      try {
        await resetProof(page);
        const { completed } = await atNextNativeReady(page, async () => {
          pending.release();
          await pending.delivery;
          await expect(page.locator('html')).toHaveAttribute(
            'data-route-motion-private',
            'false',
          );
        });
        await (await navigationLink(page, 'History')).click();
        await completed;
        await expect(
          page.getByRole('heading', { name: 'Inventory history', exact: true }),
        ).toBeVisible();
        await assertNoNativeSnapshots(page);
        const cancelled = await proof(page);
        expect(cancelled.transitions.some((entry) => entry.ready)).toBe(true);
        expect(cancelled.cancellations.some((entry) => entry.whileActive)).toBe(
          true,
        );
        await info.attach('real-read-action-denial-snapshot-cancellation', {
          body: JSON.stringify(cancelled),
          contentType: 'application/json',
        });
        // Permission denial is not sign-out: this same active Staff actor can
        // still read inventory. Restoring its grant cannot rearm this provider.
        await actor.configurationAccess(true);
        await resetProof(page);
        await (await navigationLink(page, 'Inventory')).click();
        await expect(
          page.getByRole('heading', { name: 'Inventory', exact: true }),
        ).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute(
          'data-route-motion-private',
          'false',
        );
        await settled(page);
        expect((await proof(page)).transitions).toHaveLength(0);
        await (await navigationLink(page, 'History')).click();
        await expect(
          page.getByRole('heading', { name: 'Inventory history', exact: true }),
        ).toBeVisible();
        expect((await proof(page)).transitions).toHaveLength(0);
      } finally {
        await pending.dispose();
      }
    });
  });

  test(`deferred denial transport across logout/login preserves replacement native navigation at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await observeMotion(page);
    await auditLogin(page);
    const category = await auditCategory(page);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await withMotionActor(page, async (actor) => {
      await page.goto(category.url);
      await expect(
        page.getByRole('heading', {
          name: `${category.name} form`,
          exact: true,
        }),
      ).toBeVisible();
      await actor.configurationAccess(false);
      const pending = await holdIdentityDenial(page, actor.id);
      try {
        // Retire through actual logout, restore this owned fixture's grant,
        // then sign in normally. This proves real response transport and later
        // navigation, not private observer-continuation completion: its valid
        // retired-scope path intentionally has no observable application effect.
        // The completed-callback/generation unit regression proves that rule.
        await (await navigationLink(page, 'Inventory')).click();
        await expect(
          page.getByRole('heading', { name: 'Inventory', exact: true }),
        ).toBeVisible();
        await settled(page);
        const originalDocument = await page.evaluate(
          () => performance.timeOrigin,
        );
        await page
          .getByRole('button', { name: 'Sign out', exact: true })
          .click();
        await expect(page).toHaveURL(/\/login$/);
        await actor.configurationAccess(true);
        await actor.signIn();
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(
          originalDocument,
        );
        await expect(page.locator('html')).toHaveAttribute(
          'data-route-motion-private',
          'true',
        );
        await resetProof(page);
        const { completed } = await atNextNativeReady(page, async () => {
          pending.release();
          await pending.delivery;
        });
        await (await navigationLink(page, 'History')).click();
        await completed;
        await expect(
          page.getByRole('heading', { name: 'Inventory history', exact: true }),
        ).toBeVisible();
        await settled(page);
        await expect(page.locator('html')).toHaveAttribute(
          'data-route-motion-private',
          'true',
        );
        expect(
          (await proof(page)).transitions.some((entry) => entry.ready),
        ).toBe(true);
        const replacement = await proof(page);
        expect(
          replacement.cancellations.filter((entry) => entry.whileActive),
        ).toHaveLength(0);
        await resetProof(page);
        await (await navigationLink(page, 'Inventory')).click();
        await expect(
          page.getByRole('heading', { name: 'Inventory', exact: true }),
        ).toBeVisible();
        await settled(page);
        await expect(page.locator('html')).toHaveAttribute(
          'data-route-motion-private',
          'true',
        );
        const later = await proof(page);
        expect(later.transitions.some((entry) => entry.ready)).toBe(true);
        expect(
          later.cancellations.filter((entry) => entry.whileActive),
        ).toHaveLength(0);
        await info.attach(
          'deferred-denial-transport-and-replacement-navigation',
          {
            body: JSON.stringify({
              contract:
                'Real deferred denial transport and replacement navigation; private continuation completion is not observed.',
              replacement,
              later,
            }),
            contentType: 'application/json',
          },
        );
      } finally {
        await pending.dispose();
      }
    });
  });

  for (const mode of ['system', 'local'] as const) {
    test(`${mode} reduction cancels a running native snapshot and keeps later routes instant at ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await observeMotion(page);
      await auditLogin(page);
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
      const preferences =
        mode === 'local' ? await page.context().newPage() : null;
      try {
        if (preferences) {
          await preferences.emulateMedia({ reducedMotion: 'no-preference' });
          await preferences.goto('/settings');
          const toggle = preferences.getByRole('switch', {
            name: 'Reduce motion in this browser',
            exact: true,
          });
          await expect(toggle).toBeEnabled();
          await expect(toggle).toHaveAttribute('aria-checked', 'false');
          await toggle.focus();
          await expect(toggle).toBeFocused();
          await page.bringToFront();
          await expect
            .poll(() => page.evaluate(() => document.visibilityState))
            .toBe('visible');
        }
        await resetProof(page);
        const { completed } = await atNextNativeReady(page, async () => {
          if (mode === 'system') {
            await page.emulateMedia({ reducedMotion: 'reduce' });
          } else {
            // Real keyboard input on the stationary Settings control creates the
            // browser's cross-tab storage event while the first route animates.
            await preferences!.keyboard.press('Space');
            // Keep this attribution about preference changes, not tab hiding.
            expect(await page.evaluate(() => document.visibilityState)).toBe(
              'visible',
            );
          }
          await expect(page.locator('html')).toHaveAttribute(
            'data-motion',
            'reduced',
          );
        });
        await (await navigationLink(page, 'History')).click();
        await completed;
        await expect(
          page.getByRole('heading', { name: 'Inventory history', exact: true }),
        ).toBeVisible();
        await assertNoNativeSnapshots(page);
        const cancelled = await proof(page);
        expect(cancelled.cancellations.some((entry) => entry.whileActive)).toBe(
          true,
        );
        await info.attach('in-flight-effective-reduction', {
          body: JSON.stringify({
            ...cancelled,
            contract:
              mode === 'local'
                ? 'Real cross-tab Settings switch and browser storage event during native navigation'
                : 'System reduced-motion change during native navigation',
          }),
          contentType: 'application/json',
        });
        await resetProof(page);
        await (await navigationLink(page, 'Inventory')).focus();
        await page.keyboard.press('Enter');
        await expect(
          page.getByRole('heading', { name: 'Inventory', exact: true }),
        ).toBeVisible();
        await settled(page);
        expect((await proof(page)).transitions).toHaveLength(0);
        await expect(page.locator('html')).toHaveAttribute(
          'data-route-motion-private',
          'true',
        );
      } finally {
        await preferences?.close();
      }
    });
  }
}

for (const width of [1280, 390]) {
  test(`commit-aware navigation and duplicate holding title/Back at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await observeMotion(page);
    await auditLogin(page);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
    const category = await auditCategory(page);
    const name = `Route motion ${crypto.randomUUID()} long cable name for multiline title matching`;
    const record = await auditCreateRecord(
      page,
      'quantity',
      category.name,
      name,
    );
    const client = await auditReadback();
    try {
      const locations = await client
        .from('inventory_locations')
        .select('id,code')
        .in('code', ['ITC-S1A', 'ITC-S1B'])
        .order('code');
      expect(locations.error).toBeNull();
      expect(locations.data).toHaveLength(2);
      let version = 1;
      for (const location of locations.data!) {
        const received = await client.rpc('quantity_receive', {
          p_request_id: crypto.randomUUID(),
          p_payload: {
            item_id: record.id,
            expected_version: version,
            location_id: location.id,
            quantity: 1,
            reason: 'Route motion duplicate holding proof',
          },
        });
        expect(received.error).toBeNull();
        version = (received.data as { version: number }).version;
      }
    } finally {
      await client.auth.signOut({ scope: 'local' });
    }
    const scope = `/inventory?${new URLSearchParams({ q: name, type: 'quantity' })}`;
    await page.goto(scope);
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(2);
    if (width === 390) {
      // A short mobile viewport makes this existing populated page scrollable.
      // Exercise real input rather than allowing a zero-offset restoration pass.
      await page.setViewportSize({ width, height: 480 });
      await page.mouse.move(width / 2, 240);
      await page.mouse.wheel(0, 400);
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(0);
    }
    const row = page
      .locator('#inventory-row-2')
      .getByRole('link', { name, exact: true });
    await row.scrollIntoViewIfNeeded();
    await resetProof(page);
    await info.attach('before-row-navigation', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    const sourceNode = await row.elementHandle();
    expect(sourceNode).not.toBeNull();
    await row.focus();
    const sourceScroll = await page.evaluate(() => window.scrollY);
    if (width === 390) expect(sourceScroll).toBeGreaterThan(0);
    const streaming = await withHeldQuantityPrimary(info, async (held) => {
      const requested = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname ===
            `/inventory/quantity/${record.id}` &&
          request.headers().rsc === '1' &&
          !request.headers()['next-router-prefetch'],
        { timeout: 1000 },
      );
      try {
        await page.keyboard.press('Enter');
        const browserRequest = await requested;
        await expect
          .poll(held.blockedReads, { timeout: 1000, intervals: [25, 50, 100] })
          .toBeGreaterThan(0);
        const fallback = earlyQuantityFallback(browserRequest);
        void fallback.catch(() => {});
        const streamed = await fallback;
        await expect(routeProgress(page)).toHaveAttribute(
          'data-visible',
          'true',
          { timeout: 750 },
        );
        expect(
          await sourceNode!.evaluate(
            (node) => node.isConnected && node.getClientRects().length > 0,
          ),
        ).toBe(true);
        expect(
          await sourceNode!.evaluate(
            (node) => node === document.querySelector('#inventory-row-2 a'),
          ),
        ).toBe(true);
        expect(await page.locator('[data-loading-shape]').count()).toBe(0);
        expect((await proof(page)).transitions).toHaveLength(0);
        return streamed;
      } finally {
        await held.release();
      }
    });
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    const forward = await completedTitlePair(page, async (observed) => {
      // Preserve evidence after the same bounded wait, including its failure.
      await info.attach('forward-native-route-proof', {
        body: JSON.stringify(observed),
        contentType: 'application/json',
      });
    });
    await info.attach('primary-data-delayed-after-fallback-stream', {
      body: JSON.stringify(streaming),
      contentType: 'application/json',
    });
    const shared = forward.transitions.flatMap((entry) =>
      entry.old.filter(
        (old) =>
          old.name.startsWith('inventory-title-') &&
          entry.next.some((next) => next.name === old.name),
      ),
    );
    expect(shared).toHaveLength(1);
    expect(forward.replacements).toHaveLength(1);
    for (const replacement of forward.replacements) {
      expect(replacement.duration).toBe(200);
      expect(replacement.delay).toBe(0);
      expect(
        replacement.frames.every((frame) =>
          Object.keys(frame).every((property) =>
            ['transform', 'opacity', 'offset', 'easing', 'composite'].includes(
              property,
            ),
          ),
        ),
      ).toBe(true);
    }
    expect(
      forward.transitions
        .flatMap((entry) => [...entry.old, ...entry.next])
        .every((capture) => !capture.canvas && !capture.shell),
    ).toBe(true);
    expect(
      await page
        .locator('html')
        .evaluate((element) => getComputedStyle(element).viewTransitionName),
    ).toBe('none');
    expect(forward.cls).toBe(0);
    await resetProof(page);
    // Native browser history is instant under the installed eager Next restore.
    // Verify real results/filter/scroll restoration and Forward separately from
    // the animated application Back link below.
    await page.goBack();
    await expect(page).toHaveURL(new URL(scope, page.url()).href);
    await expect(page.locator('#inventory-row-2')).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Search inventory' }),
    ).toHaveValue(name);
    await expect(
      page.getByRole('combobox', { name: 'Tracking type' }),
    ).toHaveValue('quantity');
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBe(sourceScroll);
    await settled(page);
    const firstBrowserBack = await proof(page);
    expect(firstBrowserBack.transitions).toHaveLength(0);
    expect(firstBrowserBack.replacements).toHaveLength(0);
    expect(firstBrowserBack.cls).toBe(0);
    expect(new URL(page.url()).hash).toBe('');
    await resetProof(page);
    await page.goForward();
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await settled(page);
    const firstBrowserForward = await proof(page);
    expect(firstBrowserForward.transitions).toHaveLength(0);
    expect(firstBrowserForward.replacements).toHaveLength(0);
    await resetProof(page);
    await page.getByRole('link', { name: 'Back to results' }).click();
    await expect(page).toHaveURL(
      new URL(scope + '#inventory-row-2', page.url()).href,
    );
    await expect(page.locator('#inventory-row-2')).toBeVisible();
    const appBackAfterNativeForward = await completedTitlePair(page);
    expect(appBackAfterNativeForward.replacements).toHaveLength(1);
    await resetProof(page);
    await page
      .locator('#inventory-row-2')
      .getByRole('link', { name, exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await completedTitlePair(page);
    await resetProof(page);
    await page.getByRole('link', { name: 'Back to results' }).click();
    await expect(page).toHaveURL(
      new URL(scope + '#inventory-row-2', page.url()).href,
    );
    await expect(page.locator('#inventory-row-2')).toBeVisible();
    await completedTitlePair(page);
    const back = await proof(page);
    expect(back.replacements).toHaveLength(1);
    const pair = back.transitions.find((entry) =>
      entry.old.some((old) => old.name.startsWith('inventory-title-')),
    )!;
    expect(
      pair.next.filter((next) => next.name.startsWith('inventory-title-')),
    ).toHaveLength(1);
    expect(back.cls).toBe(0);
    await info.attach('after-app-back', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    // Native browser Back to a real anchored history entry is a separate path.
    await resetProof(page);
    await page
      .locator('#inventory-row-2')
      .getByRole('link', { name, exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await completedTitlePair(page);
    await resetProof(page);
    await page.goBack();
    await expect(page.locator('#inventory-row-2')).toBeVisible();
    await expect(page).toHaveURL(
      new URL(scope + '#inventory-row-2', page.url()).href,
    );
    await settled(page);
    expect((await proof(page)).transitions).toHaveLength(0);
    expect((await proof(page)).replacements).toHaveLength(0);
    await info.attach('native-route-proof', {
      body: JSON.stringify({
        forward,
        firstBrowserBack,
        firstBrowserForward,
        appBackAfterNativeForward,
        back,
        browserBack: await proof(page),
      }),
      contentType: 'application/json',
    });
    // Live search commits change only queries and must not replay the page.
    await resetProof(page);
    await page
      .getByRole('textbox', { name: /Search/i })
      .first()
      .fill(name.slice(0, 48));
    await expect(page).toHaveURL(
      (url) => url.searchParams.get('q') === name.slice(0, 48),
    );
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(2);
    await settled(page);
    expect((await proof(page)).transitions).toHaveLength(0);
    // A post-capture geometry failure must reveal the live destination, not
    // leave native dimension interpolation or an invisible named-title hole.
    await page.evaluate(() => {
      const original = KeyframeEffect.prototype.getKeyframes;
      Object.assign(window, {
        restoreTitleKeyframes: () => {
          KeyframeEffect.prototype.getKeyframes = original;
        },
      });
      KeyframeEffect.prototype.getKeyframes = function () {
        if (
          this.pseudoElement?.startsWith(
            '::view-transition-group(inventory-title-',
          )
        )
          return [
            {
              offset: 0,
              computedOffset: 0,
              width: '0px',
              height: '0px',
              transform: 'none',
              easing: 'linear',
              composite: 'auto',
            },
          ] as ComputedKeyframe[];
        return original.call(this);
      };
    });
    await resetProof(page);
    await page
      .locator('#inventory-row-2')
      .getByRole('link', { name, exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await settled(page);
    expect((await proof(page)).replacements).toHaveLength(0);
    expect(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((animation) =>
              (
                animation.effect as KeyframeEffect | null
              )?.pseudoElement?.startsWith('::view-transition'),
            ).length,
      ),
    ).toBe(0);
    await page.evaluate(() =>
      (window as Window & { restoreTitleKeyframes?: () => void })
        .restoreTitleKeyframes!(),
    );
    await (await navigationLink(page, 'Spaces & maps')).click();
    await expect(page).toHaveURL(/\/room/);
    await expect(page.locator('canvas')).toBeVisible();
    await settled(page);
    await resetProof(page);
    await (await navigationLink(page, 'Inventory')).click();
    await expect(
      page.getByRole('heading', { name: 'Inventory', exact: true }),
    ).toBeVisible();
    await settled(page);
    expect(
      (await proof(page)).transitions
        .flatMap((entry) => [...entry.old, ...entry.next])
        .every((capture) => !capture.canvas && !capture.shell),
    ).toBe(true);
  });
}

for (const mode of [
  'system-reduced',
  'local-reduced',
  'unsupported',
] as const) {
  test(`${mode} navigation is instant and retains normal focus/URLs`, async ({
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: mode === 'system-reduced' ? 'reduce' : 'no-preference',
    });
    await observeMotion(page, mode === 'unsupported');
    if (mode === 'local-reduced')
      await page.addInitScript(() =>
        localStorage.setItem('it-inventory-reduce-motion', 'true'),
      );
    await auditLogin(page);
    await resetProof(page);
    await (await navigationLink(page, 'History')).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Inventory history', exact: true }),
    ).toBeVisible();
    await settled(page);
    expect((await proof(page)).replacements).toHaveLength(0);
    expect((await proof(page)).transitions).toHaveLength(0);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
}

/** Holds one genuine navigation/action response; never invents Flight or readiness. */
async function holdRouteWork(page: Page, pathname: string, action = false) {
  let release!: () => void;
  let received!: () => void;
  let failed!: (error: unknown) => void;
  let finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrival = new Promise<void>((resolve, reject) => {
    received = resolve;
    failed = reject;
  });
  const delivery = new Promise<void>((resolve) => {
    finished = resolve;
  });
  void arrival.catch(() => {});
  let claimed = false;
  const pattern = '**/*';
  const handler: Parameters<Page['route']>[1] = async (route) => {
    const request = route.request();
    const headers = request.headers();
    if (
      claimed ||
      new URL(request.url()).pathname !== pathname ||
      (action
        ? request.method() !== 'POST' || !headers['next-action']
        : request.method() !== 'GET' ||
          headers.rsc !== '1' ||
          !!headers['next-router-prefetch'])
    ) {
      return route.continue();
    }
    claimed = true;
    try {
      const response = await route.fetch({ timeout: 15_000 });
      expect(response.ok()).toBe(true);
      received();
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      failed(error);
      await route.abort('failed').catch(() => {});
    } finally {
      finished();
    }
  };
  await page.route(pattern, handler);
  return {
    arrival,
    delivery,
    release,
    dispose: async () => {
      release();
      if (claimed) await delivery;
      await page.unroute(pattern, handler);
    },
  };
}
const routeProgress = (page: Page) =>
  page.locator('.experience-route-progress');

async function holdRoomContents(page: Page, code: string, fail = false) {
  let release!: () => void;
  let received!: () => void;
  let rejected!: (error: unknown) => void;
  let finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrival = new Promise<void>((resolve, reject) => {
    received = resolve;
    rejected = reject;
  });
  void arrival.catch(() => {});
  const delivery = new Promise<void>((resolve) => {
    finished = resolve;
  });
  let claimed = false;
  const pattern = '**/api/room/contents?*';
  const handler: Parameters<Page['route']>[1] = async (route) => {
    if (
      claimed ||
      new URL(route.request().url()).searchParams.get('location') !== code
    )
      return route.continue();
    claimed = true;
    try {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      received();
      await gate;
      if (fail) await route.abort('failed');
      else await route.fulfill({ response });
    } catch (error) {
      rejected(error);
      await route.abort('failed').catch(() => {});
    } finally {
      finished();
    }
  };
  await page.route(pattern, handler);
  return {
    arrival,
    release,
    delivery,
    dispose: async () => {
      release();
      if (claimed) await delivery;
      await page.unroute(pattern, handler);
    },
  };
}
async function selectRoomLocation(page: Page, code: string) {
  const browser = page.getByRole('navigation', {
    name: 'Location browser',
    exact: true,
  });
  await browser
    .getByRole('searchbox', { name: 'Browse locations', exact: true })
    .fill(code);
  await browser.getByRole('button', { name: new RegExp(`${code}$`) }).click();
}

for (const width of [1280, 390]) {
  test(`room-local native Back/Forward waits for current contents and commits errors without stale acknowledgement at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await auditLogin(page);
    await (await navigationLink(page, 'Spaces & maps')).click();
    const pane = page.getByRole('region', {
      name: 'Location inventory',
      exact: true,
    });
    await selectRoomLocation(page, 'ITC-S1A');
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    await selectRoomLocation(page, 'ITC-S1B');
    await expect(pane).toHaveAttribute('aria-busy', 'false');
    const back = await holdRoomContents(page, 'ITC-S1A');
    try {
      await page.goBack();
      await back.arrival;
      await expect(page).toHaveURL(/location=ITC-S1A/);
      await expect(pane).toHaveAttribute('aria-busy', 'true');
      await expect(routeProgress(page)).toHaveAttribute('data-visible', 'true');
      // Forward supersedes the held request; its later payload cannot certify A.
      await page.goForward();
      await expect(page).toHaveURL(/location=ITC-S1B/);
      await expect(pane).toHaveAttribute('aria-busy', 'false');
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
      back.release();
      await back.delivery;
      await expect(page).toHaveURL(/location=ITC-S1B/);
      await expect(pane).toHaveAttribute('aria-busy', 'false');
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
    } finally {
      await back.dispose();
    }
    const failure = await holdRoomContents(page, 'ITC-S1A', true);
    try {
      await page.goBack();
      await failure.arrival;
      await expect(routeProgress(page)).toHaveAttribute('data-visible', 'true');
      failure.release();
      await failure.delivery;
      await expect(pane).toContainText('Inventory could not be loaded.');
      await expect(pane).toHaveAttribute('aria-busy', 'false');
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
    } finally {
      await failure.dispose();
    }
  });

  test(`stable Fiber real WebGL remount and native Back preserve camera and exclude all canvas ancestors at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await observeMotion(page);
    await auditLogin(page);
    await (await navigationLink(page, 'Spaces & maps')).click();
    const canvas = page.locator('canvas');
    const expectCanvasExcluded = async () => {
      await expect(canvas).toBeVisible();
      const ancestorNames = await canvas.evaluate((element) => {
        const names: string[] = [];
        for (
          let ancestor: Element | null = element;
          ancestor;
          ancestor = ancestor.parentElement
        )
          names.push(getComputedStyle(ancestor).viewTransitionName);
        return names;
      });
      // A nonempty live chain proves exclusion even when this ordinary route
      // reveals synchronously through privacy verification without a snapshot.
      expect(ancestorNames.length).toBeGreaterThan(1);
      expect(ancestorNames.every((name) => name === 'none')).toBe(true);
    };
    await expect(canvas).toBeVisible();
    const first = await canvas.elementHandle();
    expect(first).not.toBeNull();
    expect(
      await canvas.evaluate((element) => {
        const gl = (element as HTMLCanvasElement).getContext('webgl2');
        return Boolean(
          gl &&
          !gl.isContextLost() &&
          gl.drawingBufferWidth > 0 &&
          gl.drawingBufferHeight > 0,
        );
      }),
    ).toBe(true);
    const viewer = page.getByTestId('room-viewer');
    await expect
      .poll(() => viewer.getAttribute('data-camera-view'))
      .not.toBe('null');
    const initial = JSON.parse(
      (await viewer.getAttribute('data-camera-view'))!,
    ) as { zoom: number };
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect
      .poll(
        async () =>
          JSON.parse((await viewer.getAttribute('data-camera-view'))!)
            .zoom as number,
      )
      .toBeGreaterThan(initial.zoom);
    const before = await viewer.getAttribute('data-camera-view');
    expect(before).toBeTruthy();
    await page.getByRole('button', { name: 'Hide room', exact: true }).click();
    await expect(canvas).toHaveCount(0);
    expect(await first!.evaluate((element) => element.isConnected)).toBe(false);
    await page.getByRole('button', { name: 'Show room', exact: true }).click();
    await expect(canvas).toBeVisible();
    expect(
      await first!.evaluate(
        (element) => element === document.querySelector('canvas'),
      ),
    ).toBe(false);
    await expect(viewer).toHaveAttribute('data-camera-view', before!);
    await settled(page);
    await expectCanvasExcluded();
    await resetProof(page);
    const documents: string[] = [];
    page.on('request', (request) => {
      if (
        request.isNavigationRequest() &&
        request.resourceType() === 'document'
      )
        documents.push(new URL(request.url()).pathname);
    });
    await (await navigationLink(page, 'Inventory')).click();
    await expect(
      page.getByRole('heading', { name: 'Inventory', exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/room$/);
    await expect(canvas).toBeVisible();
    await expect(viewer).toHaveAttribute('data-camera-view', before!);
    await expect(routeProgress(page)).toHaveAttribute('data-visible', 'false');
    await settled(page);
    await expectCanvasExcluded();
    expect(documents).toEqual([]);
    const captured = (await proof(page)).transitions.flatMap((entry) => [
      ...entry.old,
      ...entry.next,
    ]);
    // PageArrival deliberately excludes room source/destination ancestors;
    // CanvasFreeRouteContent may capture only its separate header. A positive
    // capture count belongs to eligible paired-title tests, not this roundtrip.
    expect(captured.every((entry) => !entry.canvas && !entry.shell)).toBe(true);
    expect(
      await page
        .locator('html')
        .evaluate((element) => getComputedStyle(element).viewTransitionName),
    ).toBe('none');
  });
}

for (const width of [1280, 390]) {
  test(`real delayed RSC, overlapping navigation and native Back settle shared progress at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await auditLogin(page);
    const slow = await holdRouteWork(page, '/history');
    try {
      await (await navigationLink(page, 'History')).click();
      await slow.arrival;
      await expect(routeProgress(page)).toHaveAttribute('data-visible', 'true');
      // The shell remains usable while the destination's actual data is held.
      await (await navigationLink(page, 'Overview')).click();
      await expect(
        page.getByRole('heading', { name: 'Low-stock overview', exact: true }),
      ).toBeVisible();
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
      slow.release();
      await slow.delivery;
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
      await page.goBack();
      await expect(
        page.getByRole('heading', { name: /^(Inventory|Inventory history)$/ }),
      ).toBeVisible();
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
    } finally {
      await slow.dispose();
    }
  });

  test(`progress tracks actual history GET form readiness and native Back cancels a held route at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await auditLogin(page);
    await (await navigationLink(page, 'History')).click();
    const form = page.getByRole('form', {
      name: 'Filter history',
      exact: true,
    });
    await expect(form).toBeVisible();
    await form
      .getByLabel('Tracking type', { exact: true })
      .selectOption('quantity');
    const slow = await holdRouteWork(page, '/history');
    try {
      await form
        .getByRole('button', { name: 'Filter history', exact: true })
        .click();
      await slow.arrival;
      await expect(routeProgress(page)).toHaveAttribute('data-visible', 'true');
      slow.release();
      await slow.delivery;
      await expect(page).toHaveURL(/\/history\?[^#]*type=quantity/);
      await expect(
        page
          .getByRole('form', { name: 'Filter history' })
          .getByLabel('Tracking type'),
      ).toHaveValue('quantity');
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
    } finally {
      await slow.dispose();
    }
    const next = await holdRouteWork(page, '/sites');
    try {
      await (await navigationLink(page, 'Properties & sites')).click();
      await next.arrival;
      await expect(routeProgress(page)).toHaveAttribute('data-visible', 'true');
      await page.goBack();
      await expect(page).toHaveURL(/\/history$/);
      await expect(
        page.getByRole('form', { name: 'Filter history' }),
      ).toBeVisible();
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
      next.release();
      await next.delivery;
      await expect(page).toHaveURL(/\/history$/);
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
    } finally {
      await next.dispose();
    }
  });

  test(`real server action success and transport error settle progress; reduction is static at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await auditLogin(page);
    await (await navigationLink(page, 'Overview')).click();
    await expect(
      page.getByRole('button', { name: 'Refresh overview', exact: true }),
    ).toBeVisible();
    const slow = await holdRouteWork(page, '/dashboard', true);
    try {
      await page
        .getByRole('button', { name: 'Refresh overview', exact: true })
        .click();
      await slow.arrival;
      await expect(routeProgress(page)).toHaveAttribute('data-visible', 'true');
      await expect(routeProgress(page)).toHaveAttribute('data-static', 'true');
      expect(
        await routeProgress(page)
          .locator('.experience-route-progress-bar')
          .evaluate((element) => getComputedStyle(element).animationName),
      ).toBe('none');
      slow.release();
      await slow.delivery;
      // This positive UI signal proves the actual client action continuation.
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: 'Overview refreshed successfully.' }),
      ).toBeVisible();
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
    } finally {
      await slow.dispose();
    }
    const pattern = '**/dashboard';
    const abort: Parameters<Page['route']>[1] = async (route) => {
      if (
        route.request().method() === 'POST' &&
        route.request().headers()['next-action']
      )
        return route.abort('failed');
      return route.continue();
    };
    await page.route(pattern, abort);
    try {
      await page
        .getByRole('button', { name: 'Refresh overview', exact: true })
        .click();
      await expect(
        page.getByRole('alert').filter({ hasText: 'Refresh failed.' }),
      ).toBeVisible();
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
    } finally {
      await page.unroute(pattern, abort);
    }
  });

  test(`real post-save router refresh remains pending until updated metadata is ready at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 900 });
    await auditLogin(page);
    const category = await auditCategory(page);
    const name = `Pending refresh ${crypto.randomUUID()}`;
    const record = await auditCreateRecord(
      page,
      'quantity',
      category.name,
      name,
    );
    const form = await auditOpenMetadataTask(page, 'Edit quantity metadata');
    await form
      .getByLabel('Manufacturer', { exact: true })
      .fill('Pending proof maker');
    await metadataReviewButton(form).click();
    const slow = await holdRouteWork(page, new URL(record.url).pathname);
    try {
      await metadataSaveButton(form).click();
      await slow.arrival;
      await expect(routeProgress(page)).toHaveAttribute('data-visible', 'true');
      slow.release();
      await slow.delivery;
      await expect(page.locator('#main-content')).toContainText(
        'Pending proof maker',
      );
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
    } finally {
      await slow.dispose();
    }
  });

  test(`logout retires held progress and late route delivery cannot restore private pending at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await auditLogin(page);
    const reminderNames = new Set([
      'inventory-logout-local-v1',
      '__Host-inventory-logout-v1',
    ]);
    const previousReminder = (await page.context().cookies()).find((cookie) =>
      reminderNames.has(cookie.name),
    )?.value;
    const slow = await holdRouteWork(page, '/history');
    try {
      await (await navigationLink(page, 'History')).click();
      await slow.arrival;
      await expect(routeProgress(page)).toHaveAttribute('data-visible', 'true');
      const signout = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/auth/logout' &&
          response.request().method() === 'POST',
      );
      const cleanup = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/auth/privacy-confirm' &&
          response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      // Both independent HTTP requests must respond while History Flight stays
      // held. The app can already have navigated away when click resolves, so
      // old-context CDP response bodies are not reliable assertion evidence.
      const signedOut = await signout;
      expect(signedOut.status()).toBe(200);
      const cleaned = await cleanup;
      expect(cleaned.status()).toBe(200);
      const confirmation = cleaned.request().postDataJSON();
      expect(Object.keys(confirmation)).toEqual(['generation']);
      expect(isLogoutGeneration(confirmation.generation)).toBe(true);
      await expect(page).toHaveURL(/\/login$/);
      await expect(
        page.getByRole('form', { name: 'Sign in', exact: true }),
      ).toBeVisible();
      const reminder = (await page.context().cookies()).find((cookie) =>
        reminderNames.has(cookie.name),
      );
      // Boolean comparisons preserve exact identity without putting generation
      // or cookie values into a failing assertion's output/artifact.
      expect(reminder?.httpOnly).toBe(true);
      expect(reminder!.value !== previousReminder).toBe(true);
      expect(
        decodeURIComponent(reminder!.value) === `v1:${confirmation.generation}`,
      ).toBe(true);
      // verifyTabPrivacy records this only after the server confirms the exact
      // generation and authoritative cleanup succeeds; HTTP 200 alone cannot.
      expect(
        await page.evaluate(
          ({ key, generation }) => sessionStorage.getItem(key) === generation,
          {
            key: logoutAcknowledgementKey,
            generation: confirmation.generation,
          },
        ),
      ).toBe(true);
      await expect(routeProgress(page)).toHaveCount(0);
      slow.release();
      await slow.delivery;
      await expect(page).toHaveURL(/\/login$/);
      await expect(routeProgress(page)).toHaveCount(0);
    } finally {
      await slow.dispose();
    }
  });
}
