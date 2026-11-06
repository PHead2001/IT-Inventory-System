# Screen theme preferences

Audit 4.2 D402/W12 and U409 use one root theme store. Dark is the first-visit
default, including devices that prefer Light. Settings exposes native Dark,
Light and System radios; the header button chooses the opposite resolved theme
as an explicit preference. Only chosen System follows OS appearance changes.
The motion control is a local switch; local OR OS reduction remains effective.

## Presentation scope and first paint

`public/theme-bootstrap.v1.js` is a same-origin, parser-blocking head script.
It supplies the parser, resolver, storage key and DOM apply functions used by
runtime through the typed `window.inventoryTheme` API. A version-1 record stores
only `preference`. Invalid JSON, unknown preferences/versions, missing storage
and denied reads default to Dark. Failed writes leave the current tab usable.

Keys include this app, the configured backend origin and the verified actor;
anonymous keys are separate. No last-user key or account inference is used.
Proxy drops any incoming `x-inventory-theme-actor`, then forwards only a canonical
UUID subject from successful `getClaims`. Its final response retains refreshed
request/browser cookie chunks, SDK headers and private/no-store behavior.
The broad Proxy matcher remains unchanged. Only the exact public bootstrap path
skips the claims refresh after untrusted-header/document-route normalization; a protected path ending
in `.js` still runs Proxy. The script contains no credentials or private data.
Existing security response headers are unchanged; no inline script/CSP exception
is added. A future bootstrap storage/API change must version its filename/schema
and runtime declaration together.

This header is presentation context, never membership or request authorization.
Protected `requireMember` and caller-scoped data/RLS checks remain authoritative.
The active server-member boundary establishes the current theme scope on later
actor replacement. Null/different actors, permitted logout and private-scope
unmount reset to the anonymous preference and cancel the old theme snapshot.
Only exact matching local-storage events synchronize a mounted scope; scope
change/disposal retires stale callbacks. Choice/scope/reset commands and queued
OS/storage listeners carry their mounted store token. Disposed commands cannot
write preferences or paint, even after the same store remounts; stale cleanup
cannot dispose the replacement. The provider prepares only the committed
lifecycle before child member layout (no DOM write, notification or grant),
preserving StrictMode scope adoption. Auth failures retain their existing
error behavior. JWT freshness is not evidence of fresh membership.

Privacy revocation synchronously suspends route and theme presentation before
React effects run. The mounted route provider, form drafts and business pending
owners remain intact. Suspension withdraws document eligibility, advances the
presentation epoch, rejects new leases, clears route intent/Back origin and
cancels readiness history plus native snapshots. Theme reset advances its store
generation before cancellation, including repeated anonymous resets, so skipped
native callbacks cannot restore an old choice.

Recovery requires a committed, visible, ready grant with the exact current
privacy revision and assignment epoch for the same mounted actor. Recovery opens
a fresh presentation epoch; old callbacks and leases remain retired. Ordinary
visible rechecking can retain its accepted grant. Hidden/stale grants, another
actor and terminal logout/access retirement cannot reopen it. Theme changes while
suspended apply directly. There are no theme controls on public Auth pages, and
absence of a private provider always fails closed for snapshots. Public System
updates still apply instantly. These rules coordinate presentation only and do not change Auth,
membership, data access or mutation authority.

## Snapshot ownership

The existing route owner also binds a native theme lease and its real transition
handle. A Full-motion control change reveals for 450 ms with `--ease-workspace`,
from the activated control's center to the farthest visual-viewport corner.
OS-driven System changes crossfade for 180 ms. Same appearance, Reduced motion,
unsupported APIs, hidden documents and pending route/server presentation apply
instantly. Accepted navigation, Back, private denial/logout, scope replacement,
resize/scroll and motion reduction retire the lease without invalidating later
ordinary route eligibility.

Root snapshots stay disabled. Temporary named conventional subtrees are disjoint
and contain no canvas/video ancestor. A decorative-only background snapshot uses
an even-odd mask with live-media holes. Each conventional region uses the same
circle origin translated into its own box. Media nodes, scene/camera state, draft
inputs and scanner streams are never replaced for theme motion. Unsupported media
masking or pseudo-element animation falls back instantly. ResizeObserver invalidates
changed region geometry. A single frame check runs only during the active native
lease, retaining media and conventional-region identity and rectangles. A single
650 ms total deadline, measured before native capture begins, bounds even a hung
native handle. Capture readiness and WAAPI play readiness consume that same
budget; the 450 ms reveal leaves their completion margin without extending the
lease. System's 180 ms crossfade is unchanged. Cleanup removes names/background,
cancels the frame/timer and clears captured node references. Discovery visits at
most 2,048 elements, 256 conventional regions and 32 live-media elements before
any name assignment/layout measurement; saturation or unsupported ResizeObserver
applies the theme instantly. Media
insertion, media-only resize and position-only movement retire stale masks even
without a window resize; every cleanup cancels the outstanding frame. No animation
frame is awaited inside the update callback.
All native ready/update/finished rejections are observed. Because skipped native
transitions still run their update callback, lease and store-generation checks
prevent late updates/failures from restoring an older preference.

### November 6, 2026 UTC watchdog regression checkpoint

The exact native-completion assertion from candidate `c5c8e09c` reproduced
locally with the unchanged 500 ms reveal: the 650 ms watchdog skipped the real
transition and rejected all five running/progressed pseudo-element animations.
Passive observations measured roughly 59 ms to native readiness and another
96 ms to animation play readiness. The approved 450 ms nominal reveal stays
within Audit W12's 450–600 ms range and preserves the single total 650 ms lease;
neither completion assertions nor privacy/geometry cancellation are relaxed.

The corrected focused canonical local run passed both actual native circle/System
and real logout-first-cleanup-failure/hard-reload journeys. All five 450 ms circle
effects completed, with native finish at 618.2 ms from deadline registration;
all five 180 ms System effects completed at 296.8 ms. No watchdog skip occurred.
The logout test forwards the real server response/cookies and retains its bytes
before browser delivery, avoiding document-bound response-body eviction.
Eighty-one focused/sibling tests, strict typecheck, scoped lint and formatting
passed. Retained artifacts are under
`.local-tools/pr62-theme-logout-ci-fix/run-17ecf3ab-59ff-4c72-8e0c-3334fcaa96a5`
(unchanged-product RED) and `run-efd06b47-1de9-4ab6-9f59-832f13186cc9` (GREEN).
Both runs restored the exact local Auth container/configuration and retired their
test signing key. These source-bound local results are not new-HEAD Linux CI,
hosted certification, broader room/theme acceptance or resource-capacity proof.

## Palettes and exceptions

Original Dark screen tokens stay in `globals.css`. `theme-palette.css` supplies
Light values for every existing semantic workspace/module/illustration/room token
and the framework hues used by conventional UI. Core roles distinguish opaque
surfaces, navy text, muted text, deep cyan, status/focus/borders and on-accent text.
Light atmosphere has lower aurora, grain, spotlight and ripple intensity.
`theme-controls.css` supplies shared controls and the theme-specific extension
tokens. Scene palette values remain Three-compatible hex/RGB.

The scene provider observes root class/style/data-theme and OS appearance changes,
re-reads the effective CSS palette and requests a demand frame without remounting
the scene or its camera/selection owners. Component regressions prove palette
propagation and retained child state; W15 live WebGL retheme acceptance remains
pending. The existing physical room-data/material identity colors remain
unchanged, including floor/rail/opening/rack/default material colors in `room-scene.tsx`.
They require whole-screen Light review against the rethemed context.

Print ink/paper, label sheet preview, QR/barcode pixels, PDF/export output and
photographs remain independent of screen theme. The sheet's border uses the fixed
`--print-border` token; screen Light aliases never change its white/black paint.

## Evidence and remaining acceptance

The original held source `f6606b70eb728cc6cd2b663103c886c5c96f9a87`
remains preserved. The newer selective source is `6dee997fe96e340429a95ce4c4c7bd583cd0b907`;
the lead confirmed independent Astra review clear in checkpoint2032, with its
historical 359-test/type/lint/format evidence. Those results remain scoped to that
checkpoint. Its eight strengthened E2E journeys retain the f660 first-paint,
native-completion and real WebGL pixel assertions.

The historical `40e3d107bff06ce1d279e87195ab6ae0d3b2bde2` reconciliation used PR54 baseline
`9f170ef4cd27e4b5db12fe716437c012e227a1c8` on
`assist/audit-four-theme-current`. It selectively adds theme modules and manually
integrates current root/protected layouts, Proxy, route/privacy ownership and
print behavior. Current Auth transports, document admission, logout attempts,
restoration and route/pending ownership remain in place. The deferred first-paint
probe now holds the canonical `/api/auth/privacy-read` generation request rather
than the retired Server Action transport. No dependencies or lockfiles change.

The two mounted-scene retheme regressions first failed on stale colors against
that checkpoint's single-read provider. The correction retains PR56's coalesced
microtask, color-diff/no-op, disposal and unsupported-token-retention pattern,
without importing its unrelated spatial subsystem into this PR54 baseline.
That checkpoint required final PR56 scene-authority integration and real
Dark/Light/System WebGL proof before release. Camera/selection component continuity is not GPU evidence.

That historical bounded check batch passed 249 tests across 12 suites with a 512 MiB
Node heap and one worker. The explicit terminal and action-result denial regressions
first exposed eligibility remaining live during native cancellation; those adapters
now withdraw the existing root grant before theme reset. Whole-provider teardown
uses the distinct settled contract: the parent retires the actual lease and store
generation before cancellation, while the child grant may still legitimately exist.
Before/after-native-ready tests prove stale updates and choice/OS/storage callbacks
are inert, captured regions/animations/observers/listeners/frames are cleaned, final
private eligibility is closed, and privacy revision/assignment epoch do not change.
Generic theme unmount must not manufacture Auth revocation. Independent review of this reconciled boundary and
exact-SHA remote/runtime certification remain required. No browser, fixture,
provider or Git write was performed for this checkpoint.

The historical local foundation reconciliation was based on PR57
`c9008e775c73d6741c99ea81003d3b5263691fb4` in
`assist/audit-four-theme-integration`, selectively reusing `40e3d107` only.
The current PR56/PR57 route, command, native task, effective-key readiness and
scene authority code remains authoritative. The guarded/coalesced production
ScenePalette implementation is unchanged; held live-theme regressions exercise
its mounted context and original-session fences. This is not a branch merge and
adds no held surface, Overview/query, list, scan, success or peek feature.

Auxiliary names/leases withdraw before theme cancellation on accepted navigation,
actual denial and reset. Pending reconciliation subscribes before the theme
cancellation listener; global snapshot cancellation withdraws auxiliary owners
before theme/native cancellation. Six joined actual-registry cases cover these
orders. Reversing navigation and pending ordering made two cases fail while a
body name was still captured; restoring the settled order passes. Another joined
case retains the exact accepted command binding and mounted draft through a theme
choice, and prevents its retired ticket from reviving after fresh verification.
The native API fixtures preserve the actual shared observer and assert its
underlying native call rather than replacing observer ownership.

Independent review exposed a retained-command scope-lifetime defect: mounted-owner
identity alone let an old choice or scope/reset callback operate on a later actor
partition. A monotonic scope revision now fences all three public commands and
advances before native cancellation on every real scope change and forced reset.
A→B→A cannot revive an old command; a no-op same-scope adoption preserves current
commands. Nine red cases reproduce all three commands across changed scope,
same-key forced reset and round trip. The 76-test affected batch passes afterward,
including cancellation reentry, fresh commands, current OS/exact-key storage
synchronization, StrictMode member adoption and private/native lifecycle siblings.
This correction changes presentation command liveness only, never membership or
route authority. Independent Astra re-review remains required.

That checkpoint's bounded evidence is 451 distinct tests across 19 suites in overlapping
batches, using a 512 MiB heap and one worker. No dependency, lockfile or installation
change was needed; installed direct dependency versions match the current inputs.
No browser, DB, build, complete typecheck, hosted fixture or Git mutation was run.
New native/first-paint/media/GPU/contrast/print acceptance and independent Astra
review remain pending; historical test/type evidence above is not relabeled as
current certification.

## October 27 current-main integration

The current local integration on `assist/audit-four-theme-foundation` starts at
current-main baseline `7febcf4a074ac5273407af6bbd2abc2aba26e3cf`. It selectively
reuses only the 37-path D402/W12 theme slice from
`60f7f12bc8f3913ca136973ff3171c4ac91c3fb4`; the held source remains preserved.
The validation-document reconciliation retains the target's 45-minute CI budget,
browser scheduling/interruption diagnostics, command fixture guidance and
canonical local ports. All 76 acceptance rows and their dispositions are retained.

Static integration inspection preserves `createApplicationReturn(readiness,
actorId)`, current command/readiness/auxiliary ownership, original-binding privacy
grants and pending-route cancellation. The root/protected layout additions supply
presentation scope only. The production scene palette and one-WebGL-owner budget
are unchanged; no other held feature, dependency, migration or provider setting
is imported. Existing native/store regressions cover scope
revisions, A-to-B-to-A retirement, anonymous reset, cleanup and late callbacks.

The root-native Windows cycle passes fresh normal `npm ci` with its existing
postinstall. Verification confirms all 54 direct dependency versions, all three
postprocessing patched files and the Next route-cache correction. The installed
hidden-lock digest is
`6104d6aeb676bad5fd704ee71ae00623b1e715f438b27983eb95ae6915dd335f`.
The install completes in 71,042 ms with sampled minimum free memory of
8,294,715,392 bytes; the focused batch completes in 72,678 ms with a sampled
minimum of 9,296,355,328 bytes. Both retain all 88 exact inputs and 76 acceptance
rows, observe normal direct-child exit/stream closure and require no recovery.

The three disjoint Vitest groups pass 735 tests in 33 suites: theme/core 144 in
eight, route authority 375 in ten, and native capture/owners 216 in fifteen.
Scoped zero-warning lint passes for 29 JavaScript/TypeScript paths; formatting
passes for all 37 candidate paths. Node children use explicit/inherited 512 MiB
heaps, with one Vitest worker and file parallelism disabled. The unchanged audited
guard admits at 6 GiB and stops below 4 GiB. Normal completion is accepted; these
receipts do not independently prove descendant containment. jsdom's navigation
and requestSubmit limitations remain distinct from native browser behavior.

These results belong to retained local manifest
`b3fcab1b68c737ef8a5989430f1945d75a96a6de971b218ad070aaca57b98d38`.
The later evidence prose update changes only three documents and receives its
own formatting check; the accepted test-input manifest and receipts stay intact.
Earlier test counts below remain bound to their named historical candidates.
The npm install summary reports eight vulnerabilities (two moderate, five high,
one critical); this theme cycle neither triages those advisories nor changes the
retained dependency inputs to address them.

Full types remain required in Linux CI: no small canonical theme-only graph is
demonstrated bounded locally, and the known route/metadata 512 MiB OOM graphs are
not repeated. Build, database, exact-SHA CI and fresh independent review remain
pending. Real both-theme first paint, native circle/System crossfade, rendered
contrast, print/PDF and canvas/media continuity remain mandatory runtime
acceptance. Local passes promote no acceptance row.

## October 21 local reconciliation

That local integration started at PR57
`ffd5165a935e03d463b5deb6ca41748e6920fdba` on
`assist/audit-four-theme-oct21`. It selectively reapplies only the 37-path theme
slice from `dd71647541eae2b54b1080a1318b0bcbc339ac17`, whose parent is
`c9008e775c73d6741c99ea81003d3b5263691fb4`. The held branches and original
`139b43d` source remain preserved. No held surface, Overview/query, list, scan,
success or peek feature is imported.

Current PR54/57 route, command, native-task, effective-key readiness, cleanup and
privacy contracts are retained. In particular, the latest shared-title-only
capture approval and responsive protected header remain in place. The production
PR56 ScenePalette implementation is unchanged. Theme commands retain scope-lifetime
fences; a theme choice preserves the exact accepted command binding and mounted
draft. Auxiliary owners withdraw before theme cancellation, and snapshots require
a fresh visible original-binding privacy grant with no pending route work.

The copied Playwright source retains the canonical generation-read transport and
the strengthened first-paint, native-completion and real WebGL pixel assertions.
Its historical `f6606b70` provenance does not establish execution for this candidate.
Current focused checks pass 631 distinct tests across 27 suites in three disjoint
batches, using `npm.cmd`, an explicit one-worker flag and a 512 MiB Node heap.
An earlier overlapping 144-test run passed but its PowerShell npm wrapper consumed
the worker flag; that run is excluded from the distinct total and is not evidence
of resource compliance. Scoped zero-warning lint passes for all 29 changed
JavaScript/TypeScript paths, and formatting passes for all 37 changed paths.

Strict checks with unchanged compiler settings pass for 27 of the 28 changed
TypeScript roots and their imported graphs, partitioned to fit the same 512 MiB
cap. The combined graph and then the isolated `metadata-settings.tsx` graph
exhausted that cap without a TypeScript diagnostic. Its semantic color-class
change remains unvalidated by a completed strict typecheck; no import shim,
compiler relaxation or heap increase was used. Independent Astra review reported
no actionable finding in the frozen Proxy/private-snapshot boundary and requested
no source changes. Neither that source review nor the focused tests establish
runtime acceptance.

Independent source review also corrected the authored label-preview probe: the
screen `.label-print-root` wrapper is transparent, while `.label-page` and
`.label-card` supply white paper. The probe now checks those actual backgrounds,
black title and printed-identifier ink, the single ready label in both themes,
and queue cleanup in `finally`. No application CSS or private-authority source
changed. The affected browser imported graph, scoped lint/format and discovery
of all eight theme journeys pass at the same resource cap; the reviewer confirmed
the correction has no further finding. Discovery does not execute a browser or
establish print acceptance, and the unaffected 631-test batch was not rerun.

Complete canonical typecheck, build, database, browser, provider, fixture, hosted
and exact-SHA remote certification are omitted from this local-only cycle. No
dependency install, Git commit/push, PR or new preview is part of this checkpoint.
The final local hash manifest records the candidate independently of historical
test evidence. D402/W12 acceptance remains pending.

Authored regressions cover bootstrap parsing, Dark default, account/backend keys,
invalid/future/denied storage, native keyboard radios, OS/local choices, exact
storage events, synchronous private withdrawal, actor/backend drift, latest-wins
native callbacks, media identity/geometry, bounded discovery and timeout cleanup.
Proxy regressions preserve refreshed cookie chunks/options/cache headers while
rejecting spoofed/invalid/error-path actor projections, including public assets
and admitted-handler refresh skips. The authored Playwright probe covers first
paint/reload, native System/Reduced behavior, live room pixels and retained
canvas/camera/selection. It has not run for this candidate.

Acceptance remains pending: first-paint/reload/account journeys; desktop and
390 px captures of every page, working form, disclosure, toast, designer, Labels,
Scan and Spaces in both themes; real circle/System crossfade recordings;
interrupted navigation/Back/auth/geometry; live GPU/video/camera/selection/draft/
queue continuity; rendered AA contrast (including alpha/state/disabled/focus)
and print/PDF exemptions. Numerical opaque-palette tests are not whole-screen
contrast evidence. Physical GPU/phone/camera proof remains separate from
SwiftShader/jsdom evidence. Existing physical room material colors, W15 bloom,
held Overview consumers and W18 sound retain their separate acceptance work.
D402 and W12 remain in progress in the full master ledger.

Primary contracts: [Supabase getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims),
[Supabase SSR cookies/Proxy](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
and [native ViewTransition lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/ViewTransition).

## Hosted theme checkpoint — 2026-11-05

The scoped hosted checks exercised code `7fd08332b230b154c8bb4fcdd29688a5c26fe983`, not the later documentation commit recording them. READY Vercel deployment `dpl_Ri3fTDLr92Xjnm9CvqZEahyRRdXq` served `https://it-inventory-system-qxehkxkiq-phead2002.vercel.app` against isolated Supabase preview `wbnjcvyxosiyfcyffwza`. [PR62 evidence](https://github.com/PHead2001/IT-Inventory-System/pull/62#issuecomment-6672666116) retains the checkpoint. Its cheap pre-push gate passed typecheck, zero-warning lint, formatting and 5,792 tests; fresh Codex review was clean with zero unresolved threads at that checkpoint. These checks are not complete final-candidate CI.

Desktop Full, desktop Reduced, 390 px phone Full and 390 px phone Reduced each passed the signed-in collector. Each independently checked the actual Build Info SHA, backend and authorized room response before theme interaction. It observed Dark first paint, the native Light circle in Full or instant Reduced behavior, System behavior, saved Light/System reload paints, live WebGL palette changes and retained canvas/camera/selection. Mounted control checks from 502 to 320 px also passed. Each case retained six captures, proved normal sign-out and browser/process/profile closure, and recorded zero unexpected writes or foreign navigation. No inventory fixture or configuration write was made.

The inventory was empty. Independent capture review found no actionable visible issue within that scope, but it does not certify populated records/forms, disclosure, toast, designer, Labels, Scan or all Spaces journeys, rendered whole-screen contrast, screen-reader behavior, physical phones or GPU frame performance. Each receipt also recorded five console-error events; the collector retained counts only, so these artifacts cannot establish their source, cause or harmlessness. Bounded console classification remains required before console-error-free runtime acceptance. D303.2, D402 and W12 remain incomplete, and the master ledger retains their wider gates and every other requirement. Earlier pending statements above remain historical for their named candidate; this checkpoint advances only the explicitly observed journeys.

## Populated and independent checkpoint — tested code 7fd08332

Four populated profiles now pass at the same isolated exact-code candidate `7fd08332b230b154c8bb4fcdd29688a5c26fe983`: Desktop Full `5af1beb4`, Desktop Reduced `7afe6ce8`, phone 390px Full `97b12277` and phone 390px Reduced `dbe4bcc3`. Each retained twenty Light/Dark captures across applied search, asset/quantity detail/edit/review/discard, History disclosure, Settings and mixed Labels queue. All measured controls met 44px/wrapping/visible-UUID checks; each verified build/backend/actor authority, zero denied writes/foreign navigation/page errors, unchanged fixture baseline and normal browser/SDK/process/profile closure. The [canonical populated ledger](audit-4-2-acceptance.md#pr62-populated-theme-and-independent-experience-checkpoint--tested-code-7fd08332) records full run identities, hashes, resource evidence and limits. [Two selected current captures](https://github.com/PHead2001/IT-Inventory-System/pull/62#issuecomment-6675163628) are attached to PR62; they do not establish complete before/after evidence.

Desktop navigation indicators settled; phone navigation was closed and explicitly not visible. Labels retained the strict two-action/owned-payload/budget boundary while supporting verified canonical intent consumption. Client-blocked console events and intentionally aborted preview-feedback script counts remain reported; correlation is not exact Request identity or a waiver. Earlier failed receipts remain unchanged.

Independent live run `2c127821` (full receipt/hash in the ledger) exercised desktop Full/Light asset review/edit/cancel/keep/discard and phone Reduced menu, keyboard search, theme/local-motion with OS precedence, owned quantity detail and History disclosure. Readability/clipping were inspected and discard restored focus to Edit details. However, PR66 owns unresolved pre-existing generic task-discard confirmation naming and Edit values review-exit focus defects: the affected record is unnamed, and removal of review controls leaves focus on the body after two natural frames. These are not fixed or waived in PR62. Earlier independent read-policy aborts were harness limits, not established application defects.

Independent filtered Back/scroll restoration, mixed-queue invalid-copy coverage, Full animation timing, complete exact-final-SHA CI and broader page/contrast/Scan/Spaces/physical/assistive-technology proof remain pending. This checkpoint is for tested code 7fd, not the later docs commit, and does not claim merge readiness or complete D303.2/D402/W12 acceptance. The prior empty-screen checkpoint above remains historical for its stated scope.
