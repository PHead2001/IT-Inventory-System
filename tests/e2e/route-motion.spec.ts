import { expect, test, type Page, type Request } from '@playwright/test';
import { withHeldQuantityPrimary } from './route-primary-delay';
import { documentRecordRoute } from '../../src/lib/document-route';
import { holdRouteWork } from './held-route-work';
import { createClient } from '@supabase/supabase-js';
import fixture from '../fixtures/auth.json' with { type: 'json' };
import { withDisposablePasswordAccount } from './disposable-password-account';
import {
  auditCategory,
  auditCreateRecord,
  auditLogin,
  auditReadback,
  auditOpenMetadataTask,
  auditSaveDesigner,
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
type ColdTitleGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  headingWidth: number;
  headingHeight: number;
  followingTop: number;
};
type ColdTitleProbe = {
  samples: ColdTitleGeometry[];
  firstAdmittedAt: number | null;
  shifts: Array<{ at: number; value: number }>;
  stop: () => void;
};
type DocumentDepartureProbe = {
  read: () => {
    sourceKey: string | null;
    sourceURL: string;
    event: {
      navigationType: NavigationType;
      sameDocument: boolean;
      sourceKey: string | null;
      sourceURL: string;
      trusted: boolean;
      signalAborted: boolean;
    } | null;
  };
  cleanup: () => void;
};
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

/** Cancel any real partial prefetch attempted by the production router. The
 * old link policy exercised Next's canceled/fulfilled-null prefetch path here;
 * the mitigation must prevent those requests rather than patching that cache. */
async function inventoryPrefetchProbe(page: Page) {
  const attempts: Array<{ pathname: string; segment: boolean }> = [];
  const handler: Parameters<Page['route']>[1] = async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const headers = request.headers();
    const record = documentRecordRoute(pathname);
    if (
      (pathname === '/inventory' ||
        (record?.prefix.startsWith('/inventory/') && record.key !== 'new')) &&
      (headers['next-router-prefetch'] ||
        headers['next-router-segment-prefetch'])
    ) {
      attempts.push({
        pathname,
        segment: !!headers['next-router-segment-prefetch'],
      });
      await route.abort('aborted');
    } else await route.fallback();
  };
  await page.route('**/*', handler);
  return {
    assertNone: () =>
      expect(
        attempts,
        'Inventory links must not seed a canceled partial-prefetch cache entry.',
      ).toEqual([]),
    attempts,
    dispose: () => page.unroute('**/*', handler),
  };
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
      return route.fallback();
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
  test(`measured title disclosure preserves privacy-gated cold admission geometry at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await observeMotion(page);
    await auditLogin(page);
    const category = await auditCategory(page);
    const name =
      `Hydration ${crypto.randomUUID()} ${'multiline cable '.repeat(9)}`.trim();
    const record = await auditCreateRecord(
      page,
      'quantity',
      category.name,
      name,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let blockedScripts = 0;
    const handler: Parameters<Page['route']>[1] = async (route) => {
      const url = new URL(route.request().url());
      if (
        url.pathname.startsWith('/_next/static/') &&
        url.pathname.endsWith('.js')
      ) {
        blockedScripts++;
        await gate;
      }
      await route.fallback();
    };
    await page.route('**/*', handler);
    try {
      // The Auth privacy gate admits no private DOM until genuine bundles run.
      // The component's standalone SSR slot is covered separately by its unit
      // regression; a cold protected document cannot expose that private row.
      await page.goto(record.url, { waitUntil: 'commit' });
      const heading = page.getByRole('heading', { name, exact: true });
      await expect.poll(() => blockedScripts).toBeGreaterThan(0);
      await expect(heading).toHaveCount(0);
      const row = page.locator('[data-record-name-row]');
      await expect(row).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      // Sample only real, positive admitted geometry. React can batch admission
      // and the measured disclosure, so a before-toggle sample is not required.
      await page.evaluate((name) => {
        const probe: ColdTitleProbe = {
          samples: [],
          firstAdmittedAt: null,
          shifts: [],
          stop: () => {},
        };
        Object.assign(window, { coldTitleProbe: probe });
        const shifts = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & {
              hadRecentInput: boolean;
              value: number;
            };
            if (!shift.hadRecentInput)
              probe.shifts.push({ at: shift.startTime, value: shift.value });
          }
        });
        shifts.observe({ type: 'layout-shift', buffered: true });
        let frame = 0;
        const capture = () => {
          const node = document.querySelector('[data-record-name-row]');
          const h = node?.querySelector('h1');
          const following = node?.closest('section')?.querySelector('dl');
          if (
            node &&
            h &&
            following &&
            h.textContent === name &&
            getComputedStyle(h).visibility === 'visible' &&
            !node.closest('[hidden], [inert]')
          ) {
            const r = node.getBoundingClientRect();
            const hr = h.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && hr.width > 0 && hr.height > 0) {
              probe.firstAdmittedAt ??= performance.now();
              probe.samples.push({
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                headingWidth: hr.width,
                headingHeight: hr.height,
                followingTop: following.getBoundingClientRect().top,
              });
            }
          }
        };
        const mutations = new MutationObserver(capture);
        mutations.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        const sample = () => {
          capture();
          frame = requestAnimationFrame(sample);
        };
        frame = requestAnimationFrame(sample);
        probe.stop = () => {
          cancelAnimationFrame(frame);
          mutations.disconnect();
          // Preserve queued entries before disconnect, including shell shifts
          // before admission. Report them separately from title geometry.
          for (const entry of shifts.takeRecords()) {
            const shift = entry as PerformanceEntry & {
              hadRecentInput: boolean;
              value: number;
            };
            if (!shift.hadRecentInput)
              probe.shifts.push({ at: shift.startTime, value: shift.value });
          }
          shifts.disconnect();
        };
      }, name);
      release();
      await expect(heading).toBeVisible();
      const control = row.getByRole('button', {
        name: 'Show full name',
        exact: true,
      });
      await expect(control).toBeVisible();
      await expect(control).toHaveAttribute(
        'aria-controls',
        (await heading.getAttribute('id'))!,
      );
      const touch = await control.boundingBox();
      expect(touch!.width).toBeGreaterThanOrEqual(44);
      expect(touch!.height).toBeGreaterThanOrEqual(44);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const admitted = await page.evaluate(() => {
        const probe = (
          window as unknown as Window & { coldTitleProbe: ColdTitleProbe }
        ).coldTitleProbe;
        probe.stop();
        return {
          samples: probe.samples,
          firstAdmittedAt: probe.firstAdmittedAt,
          preAdmissionCLS: probe.shifts
            .filter((entry) => entry.at < probe.firstAdmittedAt!)
            .reduce((total, entry) => total + entry.value, 0),
          postAdmissionCLS: probe.shifts
            .filter((entry) => entry.at >= probe.firstAdmittedAt!)
            .reduce((total, entry) => total + entry.value, 0),
        };
      });
      const totalCLS = (await proof(page)).cls;
      expect(admitted.preAdmissionCLS).toBe(0);
      expect(admitted.postAdmissionCLS).toBe(0);
      expect(totalCLS).toBe(0);
      await info.attach('privacy-gated-cold-title-admission', {
        body: JSON.stringify({
          ...admitted,
          totalCLS,
        }),
        contentType: 'application/json',
      });
      expect(admitted.firstAdmittedAt).not.toBeNull();
      expect(admitted.samples.length).toBeGreaterThan(1);
      for (const sample of admitted.samples)
        expect(sample).toEqual(admitted.samples[0]);
      await control.focus();
      await page.keyboard.press('Enter');
      await expect(
        row.getByRole('button', { name: 'Show less', exact: true }),
      ).toBeFocused();
      await expect(heading).toHaveText(name);
    } finally {
      release();
      await page
        .evaluate(() =>
          (
            window as Window & { coldTitleProbe?: ColdTitleProbe }
          ).coldTitleProbe?.stop(),
        )
        .catch(() => {});
      await page.unroute('**/*', handler);
    }
  });

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
    const designer = page.getByRole('region', { name: 'Forms and fields' });
    if (width === 390) {
      await designer
        .getByRole('navigation', { name: 'Designer panels' })
        .getByRole('button', { name: 'Library', exact: true })
        .click();
    }
    await designer
      .getByRole('button', { name: 'Add field', exact: true })
      .click();
    const fieldDialog = page.getByRole('dialog', {
      name: 'Add field',
      exact: true,
    });
    await fieldDialog
      .getByRole('button', { name: 'Short text', exact: true })
      .click();
    await fieldDialog
      .getByLabel('Field name', { exact: true })
      .fill('Pairing sibling note');
    await fieldDialog
      .getByRole('button', { name: 'Add to form', exact: true })
      .click();
    await auditSaveDesigner(designer);
    const name = `Route motion ${crypto.randomUUID()} long cable name for multiline title matching`;
    await page.goto('/inventory/quantity/new');
    const create = page.getByRole('form', {
      name: 'Add quantity item',
      exact: true,
    });
    await create.getByLabel('Name', { exact: true }).fill(name);
    await create
      .getByLabel('Category', { exact: true })
      .selectOption({ label: category.name });
    await create
      .getByLabel('Pairing sibling note', { exact: true })
      .fill('Owned source details link');
    await metadataReviewButton(create).click();
    await metadataSaveButton(create).click();
    await expect(page).toHaveURL(/\/inventory\/quantity\/[0-9a-f-]+$/);
    const record = { id: new URL(page.url()).pathname.split('/').at(-1)! };
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
    const prefetch = await inventoryPrefetchProbe(page);
    // Hard navigation discards the prior creation/detail router cache. The
    // source page must preserve its actual second title on a truly cold visit.
    await page.goto(scope);
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(2);
    const details = page
      .locator('#inventory-row-2')
      .getByRole('link', { name: 'Full details', exact: true });
    await expect(details).toBeVisible();
    await details.scrollIntoViewIfNeeded();
    await details.hover();
    await details.focus();
    await expect(details).toBeFocused();
    const sourceHref = await page
      .locator('#inventory-row-2')
      .getByRole('link', { name, exact: true })
      .getAttribute('href');
    await expect(details).toHaveAttribute('href', sourceHref!);
    const inventoryNavigation = await navigationLink(page, 'Inventory');
    await inventoryNavigation.hover();
    await inventoryNavigation.focus();
    const closeMenu = page.getByRole('button', {
      name: 'Close menu',
      exact: true,
    });
    if (await closeMenu.isVisible()) await closeMenu.click();
    await expect(page).toHaveURL(new URL(scope, page.url()).href);
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
    prefetch.assertNone();
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
    prefetch.assertNone();
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
    prefetch.assertNone();
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
    const browserBack = await proof(page);
    // Full pairing retains source content and history while Flight is held.
    // Native Back restores the earlier detail, not a speculative new entry.
    const pendingRow = page
      .locator('#inventory-row-2')
      .getByRole('link', { name, exact: true });
    const pendingHref = await pendingRow.getAttribute('href');
    expect(pendingHref).not.toBeNull();
    const pendingDestination = new URL(pendingHref!, page.url());
    expect(pendingDestination.pathname).toBe(
      `/inventory/quantity/${record.id}`,
    );
    const pendingSource = await pendingRow.elementHandle();
    expect(pendingSource).not.toBeNull();
    const pendingListHref = new URL(scope + '#inventory-row-2', page.url())
      .href;
    const interrupted = await holdRouteWork(page, pendingDestination.pathname);
    const pendingNativeProof: {
      back?: Proof;
      lateDelivery?: Proof;
      appBack?: Proof;
      urls: { stage: string; href: string }[];
      canceledDeparture?: Awaited<
        ReturnType<typeof verifyCanceledDocumentScroll>
      >;
    } = { urls: [{ stage: 'anchored-source', href: page.url() }] };
    try {
      await resetProof(page);
      await pendingRow.click();
      await interrupted.arrival;
      pendingNativeProof.urls.push({
        stage: 'held-response-arrived',
        href: page.url(),
      });
      await expect(routeProgress(page)).toHaveAttribute('data-visible', 'true');
      expect(
        await pendingSource!.evaluate(
          (node) =>
            node.isConnected &&
            node.getClientRects().length > 0 &&
            node === document.querySelector('#inventory-row-2 a'),
        ),
      ).toBe(true);
      expect(await page.locator('[data-loading-shape]').count()).toBe(0);
      expect((await proof(page)).transitions).toHaveLength(0);
      await expect(page).toHaveURL(pendingListHref);
      pendingNativeProof.urls.push({
        stage: 'held-source-uncommitted',
        href: page.url(),
      });
      await page.goBack();
      await expect(page).toHaveURL(pendingDestination.href);
      pendingNativeProof.urls.push({ stage: 'native-back', href: page.url() });
      pendingNativeProof.back = await proof(page);
      expect(pendingNativeProof.back.transitions).toHaveLength(0);
      expect(pendingNativeProof.back.replacements).toHaveLength(0);
      interrupted.release();
      await interrupted.delivery;
      await expect(page).toHaveURL(pendingDestination.href);
      pendingNativeProof.urls.push({
        stage: 'late-delivery',
        href: page.url(),
      });
      await expect(
        page.getByRole('heading', { name, exact: true }),
      ).toBeVisible();
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
      await settled(page);
      pendingNativeProof.lateDelivery = await proof(page);
      expect(pendingNativeProof.lateDelivery.transitions).toHaveLength(0);
      expect(pendingNativeProof.lateDelivery.replacements).toHaveLength(0);
      pendingNativeProof.canceledDeparture = await verifyCanceledDocumentScroll(
        page,
        name,
      );
      await resetProof(page);
      await page.getByRole('link', { name: 'Back to results' }).click();
      await expect(page).toHaveURL(
        new URL(scope + '#inventory-row-2', page.url()).href,
      );
      await expect(page.locator('#inventory-row-2')).toBeVisible();
      pendingNativeProof.appBack = await completedTitlePair(page);
      expect(pendingNativeProof.appBack.replacements).toHaveLength(1);
    } finally {
      try {
        await info.attach('held-native-history-timeline', {
          body: JSON.stringify(pendingNativeProof.urls),
          contentType: 'application/json',
        });
      } finally {
        await interrupted.dispose();
      }
    }
    await info.attach('native-route-proof', {
      body: JSON.stringify({
        forward,
        firstBrowserBack,
        firstBrowserForward,
        appBackAfterNativeForward,
        back,
        browserBack,
        pendingNativeProof,
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
    prefetch.assertNone();
    await info.attach('cold-inventory-prefetch-proof', {
      body: JSON.stringify({
        canceledPrefetchAttempts: prefetch.attempts,
        siblingExactHref: true,
      }),
      contentType: 'application/json',
    });
    await prefetch.dispose();
    expect(
      (await proof(page)).transitions
        .flatMap((entry) => [...entry.old, ...entry.next])
        .every((capture) => !capture.canvas && !capture.shell),
    ).toBe(true);
  });
}

for (const mode of ['system-reduced', 'local-reduced'] as const) {
  for (const width of [1280, 390]) {
    test(`${mode} delayed record arrival and native/app Back at ${width}px`, async ({
      page,
    }, info) => {
      test.setTimeout(150_000);
      await page.setViewportSize({ width, height: width === 390 ? 480 : 900 });
      await page.emulateMedia({
        reducedMotion: mode === 'system-reduced' ? 'reduce' : 'no-preference',
      });
      await page.addInitScript((localReduced) => {
        localStorage.setItem(
          'it-inventory-reduce-motion',
          String(localReduced),
        );
      }, mode === 'local-reduced');
      await observeMotion(page);
      await auditLogin(page);
      await expect(page.locator('html')).toHaveAttribute(
        'data-motion',
        'reduced',
      );
      const category = await auditCategory(page);
      const name = `Reduced route ${crypto.randomUUID()} long cable name for multiline title matching`;
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
              reason: 'Reduced route duplicate holding proof',
            },
          });
          expect(received.error).toBeNull();
          version = (received.data as { version: number }).version;
        }
      } finally {
        await client.auth.signOut({ scope: 'local' });
      }
      const scope = `/inventory?${new URLSearchParams({ q: name, type: 'quantity' })}`;
      const anchoredScope = scope + '#inventory-row-2';
      const row = page
        .locator('#inventory-row-2')
        .getByRole('link', { name, exact: true });
      const heading = page.getByRole('heading', { name, exact: true });
      const instant = async () => {
        await settled(page);
        const observed = await proof(page);
        expect(observed.transitions).toHaveLength(0);
        expect(observed.replacements).toHaveLength(0);
        expect(observed.cls).toBe(0);
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
        return observed;
      };
      const results = async (href: string) => {
        await expect(page).toHaveURL(new URL(href, page.url()).href);
        await expect(row).toBeVisible();
        await expect(page.getByRole('link', { name, exact: true })).toHaveCount(
          2,
        );
        await expect(
          page.getByRole('textbox', { name: 'Search inventory' }),
        ).toHaveValue(name);
        await expect(
          page.getByRole('combobox', { name: 'Tracking type' }),
        ).toHaveValue('quantity');
        await expect(routeProgress(page)).toHaveAttribute(
          'data-visible',
          'false',
        );
      };
      const appBack = async () => {
        const back = page.getByRole('link', { name: 'Back to results' });
        await expect(back).toHaveAttribute('href', anchoredScope);
        await back.focus();
        await expect(back).toBeFocused();
        await page.keyboard.press('Enter');
        await results(anchoredScope);
        // The installed Next scroll handler leaves focus untouched. Its
        // departing Back link is removed, so normal focus falls to the body;
        // the restored result remains focusable without a presentation trap.
        await expect(page.locator('body')).toBeFocused();
        await row.focus();
        await expect(row).toBeFocused();
        return instant();
      };
      await page.goto(scope);
      await results(scope);
      if (width === 390) {
        await page.mouse.move(width / 2, 240);
        await page.mouse.wheel(0, 400);
        await expect
          .poll(() => page.evaluate(() => window.scrollY))
          .toBeGreaterThan(0);
      }
      await row.scrollIntoViewIfNeeded();
      await row.focus();
      await expect(row).toBeFocused();
      const sourceScroll = await page.evaluate(() => window.scrollY);
      if (width === 390) expect(sourceScroll).toBeGreaterThan(0);
      const destination = new URL(
        (await row.getAttribute('href'))!,
        page.url(),
      );
      expect(destination.pathname).toBe(`/inventory/quantity/${record.id}`);
      await resetProof(page);
      const streaming = await withHeldQuantityPrimary(info, async (held) => {
        const requested = page.waitForRequest(
          (request) =>
            new URL(request.url()).pathname === destination.pathname &&
            request.headers().rsc === '1' &&
            !request.headers()['next-router-prefetch'],
          { timeout: 1000 },
        );
        try {
          await page.keyboard.press('Enter');
          const browserRequest = await requested;
          await expect
            .poll(held.blockedReads, {
              timeout: 1000,
              intervals: [25, 50, 100],
            })
            .toBeGreaterThan(0);
          const streamed = await earlyQuantityFallback(browserRequest);
          // Reduced mode reveals the ordinary fallback instead of retaining a
          // paired outgoing title, while real server primary data is blocked.
          const skeleton = page.locator('[data-loading-shape="record"]');
          await expect(skeleton).toBeVisible();
          await expect(skeleton).toHaveAttribute('data-shimmer', 'false');
          // Inspect the actual block pseudo-elements: the OS media query alone
          // would hide a broken browser-local preference in the system cases.
          const blocks = skeleton.locator('[aria-hidden="true"] span');
          expect(await blocks.count()).toBeGreaterThan(0);
          for (const block of await blocks.all()) {
            await expect(block).toHaveCSS('animation-name', 'none', {
              pseudo: 'after',
            });
          }
          await expect(routeProgress(page)).toHaveAttribute(
            'data-visible',
            'true',
          );
          await instant();
          return streamed;
        } finally {
          await held.release();
        }
      });
      await expect(page).toHaveURL(destination.href);
      await expect(heading).toBeVisible();
      await expect(page.locator('[data-loading-shape]')).toHaveCount(0);
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
      const arrival = await instant();
      await resetProof(page);
      await page.goBack();
      await results(scope);
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBe(sourceScroll);
      const nativeBack = await instant();
      await resetProof(page);
      await page.goForward();
      await expect(page).toHaveURL(destination.href);
      await expect(heading).toBeVisible();
      const nativeForward = await instant();
      await resetProof(page);
      const applicationBack = await appBack();
      // Observe the known detail's committed history entry while its genuine
      // response is held. Back restores the anchored list; late Flight delivery
      // must preserve it, and Forward restores detail without title motion.
      const interrupted = await holdRouteWork(page, destination.pathname);
      const interruptedSourceScroll = await page.evaluate(() => window.scrollY);
      const restoredInterruptedResults = async () => {
        await results(anchoredScope);
        await expect
          .poll(() => page.evaluate(() => window.scrollY))
          .toBe(interruptedSourceScroll);
      };
      const interruptedUrls = [{ stage: 'anchored-source', href: page.url() }];
      let pendingBack: Proof | undefined;
      let lateDelivery: Proof | undefined;
      let pendingForward: Proof | undefined;
      let finalAppBack: Proof | undefined;
      try {
        await resetProof(page);
        await row.focus();
        await expect(row).toBeFocused();
        await page.keyboard.press('Enter');
        await interrupted.arrival;
        interruptedUrls.push({
          stage: 'held-response-arrived',
          href: page.url(),
        });
        await expect(routeProgress(page)).toHaveAttribute(
          'data-visible',
          'true',
        );
        await instant();
        await expect(page).toHaveURL(destination.href);
        interruptedUrls.push({
          stage: 'held-history-committed',
          href: page.url(),
        });
        await page.goBack();
        await restoredInterruptedResults();
        interruptedUrls.push({ stage: 'native-back', href: page.url() });
        pendingBack = await instant();
        interrupted.release();
        await interrupted.delivery;
        await restoredInterruptedResults();
        interruptedUrls.push({ stage: 'late-delivery', href: page.url() });
        lateDelivery = await instant();
        await resetProof(page);
        await page.goForward();
        await expect(page).toHaveURL(destination.href);
        await expect(heading).toBeVisible();
        interruptedUrls.push({
          stage: 'native-forward',
          href: page.url(),
        });
        await expect(routeProgress(page)).toHaveAttribute(
          'data-visible',
          'false',
        );
        pendingForward = await instant();
        await resetProof(page);
        finalAppBack = await appBack();
      } finally {
        try {
          await info.attach('reduced-held-native-history-timeline', {
            body: JSON.stringify(interruptedUrls),
            contentType: 'application/json',
          });
        } finally {
          await interrupted.dispose();
        }
      }
      await info.attach('reduced-delayed-record-route-proof', {
        body: JSON.stringify({
          mode,
          width,
          sourceScroll,
          streaming,
          arrival,
          nativeBack,
          nativeForward,
          applicationBack,
          pendingBack,
          lateDelivery,
          pendingForward,
          finalAppBack,
        }),
        contentType: 'application/json',
      });
      await info.attach('reduced-after-app-back', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });
  }
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

const routeProgress = (page: Page) =>
  page.locator('.experience-route-progress');

/** Exercise the native beforeunload platform path, without an app/router
 * interception, synthetic abort, or fabricated readiness/checkpoint. */
async function verifyCanceledDocumentScroll(page: Page, name: string) {
  const viewport = page.viewportSize()!;
  const heading = page.getByRole('heading', { name, exact: true });
  const originalHeading = await heading.elementHandle();
  expect(originalHeading).not.toBeNull();
  const source = await page.evaluate(() => ({
    key: navigation.currentEntry?.key ?? null,
    url: location.href,
  }));
  expect(source.key).not.toBeNull();
  try {
    await page.setViewportSize({ width: viewport.width, height: 300 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      ),
    ).toBeGreaterThan(200);
    await page.keyboard.press('Home');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.mouse.move(viewport.width / 2, 150);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(100);
    await page.evaluate(() => {
      const probeWindow = window as Window & {
        documentDepartureProbe?: DocumentDepartureProbe;
      };
      let observed:
        | { event: NavigateEvent; sourceKey: string | null; sourceURL: string }
        | undefined;
      const link = document.createElement('a');
      link.id = 'test-native-document-departure';
      link.textContent = 'Test native document departure';
      link.href = new URL('/dashboard', location.href).href;
      link.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:white;color:black;padding:8px';
      const observe = (event: NavigateEvent) => {
        if (event.destination.url !== link.href) return;
        observed = {
          event,
          sourceKey: navigation.currentEntry?.key ?? null,
          sourceURL: location.href,
        };
      };
      const beforeUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = '';
      };
      navigation.addEventListener('navigate', observe);
      window.addEventListener('beforeunload', beforeUnload);
      document.body.append(link);
      probeWindow.documentDepartureProbe = {
        read: () => ({
          sourceKey: navigation.currentEntry?.key ?? null,
          sourceURL: location.href,
          event: observed
            ? {
                navigationType: observed.event.navigationType,
                sameDocument: observed.event.destination.sameDocument,
                sourceKey: observed.sourceKey,
                sourceURL: observed.sourceURL,
                trusted: observed.event.isTrusted,
                signalAborted: observed.event.signal.aborted,
              }
            : null,
        }),
        cleanup: () => {
          navigation.removeEventListener('navigate', observe);
          window.removeEventListener('beforeunload', beforeUnload);
          link.remove();
          delete probeWindow.documentDepartureProbe;
        },
      };
    });
    const dialogReady = page.waitForEvent('dialog');
    const clicked = page
      .getByRole('link', {
        name: 'Test native document departure',
        exact: true,
      })
      .click({ noWaitAfter: true });
    void clicked.catch(() => {});
    const dialog = await dialogReady;
    try {
      expect(dialog.type()).toBe('beforeunload');
    } finally {
      await dialog.dismiss();
    }
    await clicked;
    const canceled = await page.evaluate(() =>
      (
        window as Window & {
          documentDepartureProbe?: DocumentDepartureProbe;
        }
      ).documentDepartureProbe!.read(),
    );
    expect(canceled).toMatchObject({
      sourceKey: source.key,
      sourceURL: source.url,
    });
    expect(canceled.event).toMatchObject({
      navigationType: 'push',
      sameDocument: false,
      sourceKey: source.key,
      sourceURL: source.url,
      trusted: true,
    });
    // Record the real signal state, rather than depending on a universal abort
    // event after Stay. Neither the probe nor the app intercepts this departure.
    await expect(page).toHaveURL(source.url);
    expect(
      await originalHeading!.evaluate(
        (node) => node.isConnected && node === document.querySelector('h1'),
      ),
    ).toBe(true);
    await page.evaluate(() =>
      (
        window as Window & { documentDepartureProbe?: DocumentDepartureProbe }
      ).documentDepartureProbe!.cleanup(),
    );
    await page.mouse.move(viewport.width / 2, 150);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
    await resetProof(page);
    await page.goBack();
    await expect(
      page.getByRole('heading', { name: 'Inventory', exact: true }),
    ).toBeVisible();
    await expect(routeProgress(page)).toHaveAttribute('data-visible', 'false');
    await settled(page);
    const nativeBack = await proof(page);
    expect(nativeBack.transitions).toHaveLength(0);
    expect(nativeBack.replacements).toHaveLength(0);
    await resetProof(page);
    await page.goForward();
    await expect(page).toHaveURL(source.url);
    await expect(heading).toBeVisible();
    await expect(routeProgress(page)).toHaveAttribute('data-visible', 'false');
    await expect(page.locator('html')).toHaveAttribute(
      'data-route-motion-private',
      'true',
    );
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
    expect(await page.evaluate(() => navigation.currentEntry?.key)).toBe(
      source.key,
    );
    await settled(page);
    const nativeForward = await proof(page);
    expect(nativeForward.transitions).toHaveLength(0);
    expect(nativeForward.replacements).toHaveLength(0);
    return {
      canceled,
      sourceScroll: 100,
      latestScroll: 200,
      nativeBack,
      nativeForward,
    };
  } finally {
    await page
      .evaluate(() =>
        (
          window as Window & { documentDepartureProbe?: DocumentDepartureProbe }
        ).documentDepartureProbe?.cleanup(),
      )
      .catch(() => {});
    await page.setViewportSize(viewport);
  }
}

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
      return route.fallback();
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

  for (const motion of ['full', 'reduced'] as const) {
    test(`stable Fiber real WebGL remount and native Back preserve camera and exclude all canvas ancestors at ${width}px in ${motion} motion`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({
        reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference',
      });
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
      // Exercise the hosted regression before Hide/Show can recreate the renderer:
      // a settled Free Orbit pan must survive the ordinary room content link.
      await page
        .getByRole('button', { name: 'More map controls', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Free Orbit', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Pan right', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Close controls', exact: true })
        .click();
      await settled(page);
      await expect
        .poll(
          async () =>
            JSON.parse((await viewer.getAttribute('data-camera-view'))!).target,
        )
        .not.toEqual(JSON.parse(before!).target);
      const panned = await viewer.getAttribute('data-camera-view');
      expect(JSON.parse(panned!).target).not.toEqual(
        JSON.parse(before!).target,
      );
      expect(JSON.parse(panned!).mode).toBe('free');
      const documents: string[] = [];
      page.on('request', (request) => {
        if (
          request.isNavigationRequest() &&
          request.resourceType() === 'document'
        )
          documents.push(new URL(request.url()).pathname);
      });
      await page
        .getByRole('link', { name: 'Search inventory', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Inventory', exact: true }),
      ).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/room$/);
      await expect(canvas).toBeVisible();
      await settled(page);
      await expect(viewer).toHaveAttribute('data-camera-view', panned!);
      // Compare the live renderer as well as the saved-store diagnostic.
      await expect(canvas).toHaveAttribute('data-camera-view', panned!);
      await page
        .getByRole('button', { name: 'Hide room', exact: true })
        .click();
      await expect(canvas).toHaveCount(0);
      expect(await first!.evaluate((element) => element.isConnected)).toBe(
        false,
      );
      await page
        .getByRole('button', { name: 'Show room', exact: true })
        .click();
      await expect(canvas).toBeVisible();
      expect(
        await first!.evaluate(
          (element) => element === document.querySelector('canvas'),
        ),
      ).toBe(false);
      await expect(viewer).toHaveAttribute('data-camera-view', panned!);
      await settled(page);
      await expectCanvasExcluded();
      await resetProof(page);
      await (await navigationLink(page, 'Inventory')).click();
      await expect(
        page.getByRole('heading', { name: 'Inventory', exact: true }),
      ).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/room$/);
      await expect(canvas).toBeVisible();
      await expect(viewer).toHaveAttribute('data-camera-view', panned!);
      await expect(routeProgress(page)).toHaveAttribute(
        'data-visible',
        'false',
      );
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
      expect(captured.every((entry) => !entry.canvas && !entry.shell)).toBe(
        true,
      );
      expect(
        await page
          .locator('html')
          .evaluate((element) => getComputedStyle(element).viewTransitionName),
      ).toBe('none');
    });
  }
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
      return route.fallback();
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
