# Validation

## Browser scheduling and interruption diagnostics

The room spec is named `00-room.spec.ts` to start its unchanged sequential file
journeys early in the existing two-worker parallel phase. Pinned Playwright's
collector sorts files lexically and dispatches those file groups in order. Shared
fixtures retain the exclusive phase; focused runs retain one worker. Discovery
regressions require identical test coverage in both modes and room-first ordering.
This targets the observed late single-worker tail; it does not establish a measured
end-to-end saving or a pass within the existing job deadline.

Failed attempts publish bounded source coordinates immediately, before final
reporting, so process cancellation and unavailable artifact uploads still leave
an assertion-site pointer. Only this known test file's source coordinates are
retained from at most three errors per attempt and twenty attempts. Test titles,
assertion messages, expected/actual values, requests and attachments are excluded.
The final report retains its existing bounded summary and omission count.

The spatial interruption journey controls time only around transient flight/reveal
input windows. It acknowledges the current request before advancing actual browser
animation frames, delivers trusted pointer/toolbar input during the required phase,
and resumes time before settled-label and idle-draw checks. It preserves the
endpoint, cancellation, hover, selection and no-stale-target assertions. The source
repair removes a timing vulnerability; unavailable historical assertion details do
not establish it as the cause of the prior failure. Exact-candidate canonical
browser execution and full certification are required separately.

## Spatial composition source slice

### Occupancy snapshots and flight interruption witnesses

The multi-pose room journey compares each selected label with the authoritative
response whose successful generation the selected committed render adopted.
The hook publishes only that accepted generation; loading, failed, disabled and
retired-key states publish none. The viewer's read-only status/generation witness
shares the render that publishes the selected code and scene counts. A bounded
128-response map lets the test match that exact generation, including when
focus/pageshow/visibility refreshes issue unrelated same-space requests. Its oracle
checks request origin, path, space and accepted generation against the response
identity and selected code, retaining exact product/unit/asset triples. It cannot reuse the
first pose's snapshot while parallel owned fixtures change aggregate stock at a
shared physical location. Helper regressions reject reused or mismatched request
generations, unadopted valid request/response pairs, scopes, origins, absent codes
and invalid counts. Hook/workspace regressions prove that an old accepted
generation cannot remain visible across a selection-key transition.

The Fit interruption case installs the browser clock before navigation, delivers
the actual toolbar command while the acknowledged drawer request is explicitly
100 ms into its 750 ms flight, and requires cancellation before advancing another
1,300 ms. Camera stability, no opened target and permanent cancellation remain
required; real time resumes for the remaining Reduced/Full, hover and pointer
checks. CameraRig coverage exercises both Fit and Recenter past the old deadline.
These changes repair stale-oracle and elapsed-input race vulnerabilities in the
tests; unavailable failure telemetry does not establish a product defect. Actual
browser execution and exact-final-SHA certification remain separate evidence.

### Review repairs: reveal contract and waiting maps

Node-schema regressions reject both zero and nonzero group reveal metadata at
standalone and nested depths, while retaining ordinary recursive groups and
canonical drawer, container and shelf box metadata. Existing visual-reveal and
ray-selection regressions cover resting bindings, presentation bounds, legacy
v1 data without metadata and moved-body selection. Graphics regressions require
queued maps to remain busy without Resume, retain admission order across
rerenders and allocate once automatically only after prior teardown completes.
Existing preemption and privacy-withholding regressions retain explicit fresh
Resume for withdrawn allocations and automatic fresh admission for withheld
unallocated requests. Focused jsdom execution proves these source assertions;
it does not certify native WebGL disposal, visual copy at desktop/390 px or
exact-HEAD PR acceptance.

### Draw and temporal evidence harness

The W14 journey now uses an independently witnessed surface and a trusted mouse
click. Under the controlled browser clock it checks resting geometry at 744 ms,
observes the first reveal publication between 750 and 776 ms, and checks reveal
completion between 384 and 416 ms after that publication. The attachment records
the request/phase timestamps and actual native draw-bearing frame buckets. These
are authored assertions until the browser journey executes; phase telemetry is a
passive publication, not an internal controller clock.

`tests/e2e/room-draw-observation.ts` wraps native WebGL draw methods only in the
test page, preserving their receiver, arguments, return and exceptions. It groups
successful room-canvas draw submissions by animation-frame boundary, caps the
buffer at 4096 frames/200,000 draws per frame/180 seconds, reports overflow, and
restores only its own method descriptors on cleanup. Idle rAF callbacks create no
draw-frame entries. Its own rAF observer adds measurement overhead but never
invalidates the scene or renders it. Reported native submission durations are CPU
measurements; draw-bearing frame intervals are not GPU execution durations.

The opt-in `room-effects-performance.spec.ts` uses real time and five identical
warmed trusted-pointer drag samples, separate selection/contact-capture samples,
and a two-second settled draw-free window. It attaches bounded raw observations,
median/p95 summaries, capture CPU cost, quality/fallback state, graphics readiness,
resource counts, viewport/DPR, renderer strings and harness-file hashes. A software
renderer is explicitly classified in the report. No frame-rate acceptance threshold
or hardware pass is invented by the harness.

Run it after the ordinary local prerequisites, on the reference browser/hardware:

```powershell
$env:SPATIAL_PERF = '1'
$env:SPATIAL_PERF_KIND = 'candidate'
$env:SPATIAL_PERF_SHA = '<exact candidate HEAD>'
$env:SPATIAL_PERF_QUALITY = 'standard'
npm run test:e2e -- tests/e2e/room-effects-performance.spec.ts
```

The approved baseline is `05cd02c4942047dccbeb9c8c4e87b302ad2569e0`; it has no
SceneEffects owner, bloom or contact-shadow integration. Run the identical harness
against that baseline production build with `SPATIAL_PERF_KIND=baseline` and its
exact SHA. The comparison owner supplies the same three test files
(`room-effects-performance.spec.ts`, `room-draw-observation.ts`,
`room-visibility-witness.ts`) as a documented harness overlay, preserving baseline
application/dependency inputs; matching harness hashes are required. Use the same
browser/GPU, build mode, populated database, viewport and DPR, and retain both JSON
attachments outside Playwright's cleaned output directory before the next run.
Candidate `low` and `off` runs use the real Settings preference and isolate contact
and bloom costs; they are ablations, not historical-baseline substitutes. Compare
active median/p95 draw intervals and CPU submission costs, separate contact spikes,
and settled idle draws. Software rendering leaves reference-GPU acceptance open.
These runs do not certify physical-phone performance, visual theme quality or GPU
execution time. The temporal journey's fake clock must not be used for performance.

`tests/e2e/spatial-composition.spec.ts` adds the following authored browser
journeys using the existing loopback-only owned fixtures and audited cleanup.
The spec is exclusive under the existing scheduling policy. Its observation
helper reads the installed Fiber scenes and existing WebGL contexts; it never
sets camera/mesh state or replaces the application path. Screenshots are emitted
for visual review when the journeys actually execute.

| Scope | Authored real-browser evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A302  | Actual modal/label staging; Cancel preserves destination, quantity and reason; Use location does not submit; explicit map and conventional Receive confirmations persist the same destination UUID; graphics preemption, detached prior canvas and resumed detail map; committed-context samples include detached contexts awaiting teardown. Actual browser context loss keeps the keyboard picker usable; an owned unmodeled destination preserves the draft and recorded location. |
| A303  | Asset, quantity and location record readiness precedes optional graphics. Small initial viewport tests the near-region lazy boundary; phone-height captures follow. Multiple positive quantity holdings require explicit choice and changing it updates the actual compact scene. An owned unmodeled closet child keeps recorded context and Spaces links on all three surfaces without canvas/count reads.                                                                           |
| W13   | Full and Reduced journeys inspect actual rendered drawer/container/shelf reveal-group transforms, visible selected count text against the uncached occupancy response with the optional overlay off, screenshots, and reversal to resting transforms after Clear selection.                                                                                                                                                                                                           |
| W14   | Actual installed renderer and controlled browser clock prove Full flight before reveal, newer selection retirement, toolbar input cancellation and Reduced complete endpoints. The existing trusted-pointer interruption journey in `00-room.spec.ts` retains its interaction assertions and now waits through the complete 750/400 ms sequence.                                                                                                                                      |

Native Chromium click coordinates floor client positions and round local offsets
independently
([client coordinates](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/events/mouse_event.h),
[local offsets](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/events/mouse_event.cc)).
The reveal journey therefore retains its fractional physical-visibility oracle,
then certifies each integer client click against both the client ray and the
rounded-offset R3F ray, requiring the current canvas rectangle and event
dimensions to match the captured frame. Both rays must retain
the intended physical and independent selection owner and remain DOM-uncovered.
Both must also miss the canonical resting volume before counting an outside-rest
pick. Unsupported transformed, zoomed, bordered or padded canvases fail
explicitly; an exposed code without a certified click fails rather than being
skipped. Original hover, selection, new spatial request and pose-coverage
assertions remain. Focused helper checks establish this coordinate contract;
full-suite and all-pose browser acceptance remain separate requirements.

These journeys are authored, not executed browser acceptance. Typechecking,
scoped lint/format and Playwright discovery establish source validity only.
Committed-renderer observations do not certify overlap during renderer
initialization before its first Fiber commit, GPU performance or visual quality.
Run the real backend/WebGL journeys, inspect their captures, and complete the
final-candidate gates before marking these matrix scopes accepted. W15/W16
have source integration and focused lifetime coverage below; browser/GPU
acceptance remains outstanding.
Authentication revocation, stale occupancy retirement and ineligible destination
choices retain their focused unit/component coverage; the nine new browser
journeys do not establish those additional browser boundaries. The picker-only
POST counter observes server-action transport, and the unchanged persisted
record version independently checks that no inventory write occurred.

W13/W14/A302/A303 focused coverage includes immutable focus precedence and
interruption, 750/400 ms completion ordering, Reduced endpoints, measured-rest
binding preservation, selected exact counts with the optional overlay off, map
and tree UUID parity/no submission/draft preservation, current eligibility and
pending-parent checks, modal revocation masking, lazy multi-balance detail choice,
independently bounded embedded occupancy, one-scene preemption/resume and late
initialization rejection.
Canvas, map-dialog and embedded-count regressions also cover committed
actor/backend/generation A/B/A retirement without global invalidation, ordinary
same-owner readiness recovery and pending initialization that finishes after
retirement. `fiber-teardown.test.ts` executes the installed public
Fiber 9.8.1 root/configure/unmount contract in jsdom. Four regressions cover
factory rejection before renderer acquisition, acquired-renderer configuration
failure with deferred disposal, pending-factory rejection and a pending factory
returning its renderer after teardown begins. The next lease is granted only
after Fiber completion; acquired renderers additionally require disposal to settle
and a context-loss request before completion. The adapter uses public unmount
without rendering a rejected root or mutating its store. These tests do not create
WebGL or prove graphics appearance or GPU release. Throwing disposal APIs and
allocations hidden inside a rejecting factory remain unproven resource-release
boundaries. Successful-configure errors use ordinary teardown and never enter the
failed-configure adapter.
Additional authored regressions cover actual modal opening after initial
verification, permanent cancel retirement, an unmodeled child within IT Closet,
captured camera publication and actual RoomScene selections through the original
picker owner. These source assertions require fresh execution on this candidate.
The review repair batch adds a real protected-controller focus recheck around the
mounted destination dialog, retaining its native open state, staged candidate and
camera while denying fresh selection/confirmation and stale focus restoration.
Allocated preemption coverage holds teardown completion across privacy refresh
and slot release, requiring explicit fresh Resume before a new allocation.
Detail capability parity covers every canonical room binding, unmodeled children
and ancestry mismatch. Server-rendered pending/unmodeled footprints and an AST
walk of every eager client boundary (including server-supplied link descendants)
guard optional geometry loading. Source graph assertions establish import
separation; they do not substitute for production chunk/network observations or
real native modal focus/WebGL acceptance.

Use the canonical `npm run test -- --maxWorkers=1` with the affected room,
location-picker and PageArrival test files, then `npm run typecheck`, scoped
zero-warning lint and formatting. This local source slice has no migration or
database mutation. Browser acceptance still requires populated Spaces and all
three detail surfaces, storage workflows, Full/Reduced motion, desktop/390 px,
keyboard fallback, manual focus interruption, live mesh/hover/overflow gating,
Back/camera restoration, context loss and actual disposal/resource overlap.
Independent architecture review and full exact-HEAD PR certification remain
separate gates; focused jsdom passes do not fulfill audited visual acceptance.

## Room label transition correctness

Captured selected-label transition regressions use a deterministic injected clock
and a 150,000-operation cap to verify complete coverage, collision-free placement,
pointer containment, the full selected footprint and stable settled pins. These
are geometry and bounded-work assertions, not host timing benchmarks. Separate
injected-deadline regressions verify cooperative expiry and safe retained pins;
the runtime's 16 ms deadline is unchanged. Browser placement and performance
acceptance require the populated room E2E checks and are not established by these
unit tests.

## C403 live-search timing coverage

`tests/e2e/inventory-search.spec.ts` uses applied URL, input, row count,
filter chips and idle status for live-search readiness, including Clear filters.
Its immediate request-negative checks verify browser wiring; they no longer
claim that a real debounce deadline elapsed. The held real response, rapid edits,
composition commit, Back/Forward, competing chip/pagination/Clear navigation,
page-99 reconciliation and actual full-filter CSV download remain in that feature spec.

The original elapsed-time exclusions are retained deterministically in
`src/features/inventory/components/search-form.test.tsx`:

- **waits for composition, preserves later typing across an earlier response, and
  restores history** advances 500 ms during composition without navigation,
  then 250 ms after composition ends; it also retains newer typing when an
  earlier response arrives.
- **cancels unsent typing when a chip, pagination or Clear filters commits another
  search** separately advances 300 ms after each real link click and verifies
  that cancelled typing does not navigate.
- **debounces rapid A/B/A typing and clear, but submits immediately without a
  duplicate request** proves the 249+1 ms boundary and immediate submission
  without a later duplicate replacement.

The three Audit 3 milestone specs are consolidated into feature owners. The
original failure checks map below; splitting mixed tests changes fixture allocation,
not their assertions. The only removed standalone test duplicated route visits and
title assertions now retained in the populated feature tests. This is source-level
coverage ownership, not a measured runtime improvement or browser acceptance.

| Original spec and test (pre-consolidation line)                  | Retained feature coverage                                                                    | Preserved failure checks                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit-three-acceptance` Restore / ambiguous Receive (11)        | `custody.spec.ts` Restore; `inventory.spec.ts` ambiguous Receive                             | Eligible last-storage default; explicit reason and destination; inactive/storage-ineligible and site-held locations do not default; real independent balance change rejects stale confirmation; refresh retains destination/quantity and clears confirmation.                                      |
| `audit-three-acceptance` local mapped storage rename (167)       | `locations-reference.spec.ts` local mapped storage rename                                    | Keyboard focus before/after save; case/trim sibling collision and retained input; unchanged UUID/code/parent; renamed location/room label; treeitem/link keyboard semantics and grouped Location actions; selected-code and camera framing; exact original name/code/parent restored in `finally`. |
| `audit-three-acceptance` custody Done / revisit (368)            | `custody.spec.ts` custody Done / revisit                                                     | Done enables second operation; revisit/reload cannot resurrect receipts; final version 3 and storage/site state; exactly two issued/returned events.                                                                                                                                               |
| `audit-three-discovery` live inventory typing (185)              | `inventory-search.spec.ts` live inventory typing                                             | Held real RSC; applied rows/chips/CSV during pending response; rapid edits/composition/history; chip/page/Clear cancellation; page 99 reconciliation; 26 owned names in actual downloaded CSV.                                                                                                     |
| `audit-three-discovery` Settings hierarchy / search picker (374) | `custody.spec.ts` Settings hierarchy; `inventory.spec.ts` search location picker             | Collapse/expand, rendered first-child/parent navigation, Home/End, hierarchy-preserving Settings search and treeitem detail activation; picker active descendant, arrow navigation/search/select/Escape focus return; viewport containment and no overflow.                                        |
| `audit-three-interface` local fonts on location label (136)      | `labels-stock.spec.ts` local UI and code fonts                                               | Exact mapped label code; UI/mono computed families and loaded faces; at least two same-origin local WOFF2 resources.                                                                                                                                                                               |
| `audit-three-interface` populated phone flows (197)              | `labels-stock.spec.ts` fonts / scan / labels; `metadata-designer.spec.ts` populated designer | Owned quantity code and fonts; 375/390 px labels, enabled size selector, manual same-origin scan Open and exact destination; populated designer/panels; exact quantity/category titles; viewport fit and screenshots.                                                                              |
| `audit-three-interface` designer dialog focus (309)              | `metadata-designer.spec.ts` designer dialog focus                                            | New field selected; desktop field focus / phone inspector focus; Cancel returns to trigger; existing standard Name selected and properties visible at desktop/phone.                                                                                                                               |
| `audit-three-interface` history timezone disclosure (397)        | `scope-accessibility.spec.ts` relative history                                               | Keyboard disclosure, visible UTC/GMT timezone, exact displayed instant, original timestamp precision/`datetime`, clipboard detail and screenshot.                                                                                                                                                  |
| `audit-three-interface` synthetic missing RSC (429)              | `navigation-workflow.spec.ts` synthetic RSC missing response                                 | Real owned NextLink; scoped non-prefetch request rewrite, RSC response content type/status attachment, unavailable boundary; private IDs/name absent; zero document fallback; ordinary NextLink recovery and title.                                                                                |
| `audit-three-interface` direct missing resources (526)           | `inventory.spec.ts` direct missing resources; `foundation.spec.ts` anonymous missing asset   | Public/quantity/asset document HTTP 404, one main, unavailable headings, title excludes path identity, screenshots/client recovery; anonymous login redirect/title and no resource disclosure; scan/labels/history route titles and valid image icon.                                              |
| `audit-three-interface` generic owned route titles (589)         | Merged into populated phone quantity / designer tests above                                  | D304 now requires exact caller-authorized quantity/category-name titles; both exclude owned quantity/category UUIDs and unrelated record/category names. Missing-resource privacy checks remain separate and unchanged.                                                                            |

`inventory-discovery-fixtures.ts` retains its loopback-only API/port guard,
26 uniquely prefixed owned rows, archive cleanup and local fixture sign-out.
`interface-fixtures.ts` retains test-scoped unique categories/items, loopback-only
browser/API guards, record/category cleanup and local sign-out. Each consumer gets
its own fixture; sharing the helper does not share records between tests.
The mapped `ITC-RED` rename remains outside the existing parallel allowlist in
`locations-reference.spec.ts`: it must finish and restore the canonical reference
before parallel reference readers run. The live-search fixture also remains exclusive in `inventory-search.spec.ts` because
parallel designer specs may publish required fields on shared categories. Custody,
metadata-designer and foundation retain their existing exclusive ownership. No CI, project gate, runner, concurrency,
security, race or accounting coverage is relaxed.

D304 keeps all eight server metadata exports generic and read-free. Successful
caller-scoped page reads register named titles through the mounted Auth privacy
controller, with explicit server route paths and opaque registration ownership.
Revocation, failed verification and route/binding drift synchronously restore
`IT Inventory`; retained forms and unknown-outcome commands stay mounted. Focused
privacy regressions cover benign checks, same-owner recovery, stale registrations,
denied owners and delayed safe head updates. Verified ordinary routes restore only
a repository-authored static title for their current navigation; recognized private
route shapes have non-sensitive generic fallbacks. Unknown/malformed paths remain
`IT Inventory`, and no title is learned from previous document metadata or query
values. Controller and Auth integration regressions cover metadata present before
mount, navigation masking/reverification and private-to-ordinary transitions.
Server metadata regressions verify
that failures and missing records cannot stream private names into the head.

## U407 phone record header

U407's phone record regressions include a populated asset tag or quantity SKU,
and the asset's complete storage breadcrumb and Show in room link. The Tasks
heading's bottom is measured from the document top at 375 × 812 after fonts
are ready, including the retired asset's Last recorded custody state, so retained
browser scroll cannot conceal a partially or fully off-screen heading. An odd final
header fact spans both phone columns, keeping custody and identifier content
readable without narrowing the three-line name or removing its keyboard
disclosure. Phone hero padding and header/fact gaps are reduced without changing
text sizes or 44 px controls. Browser geometry acceptance still requires running the real E2E
suite against the final candidate.

## U403 choice identity proof

The forward choice-identity migration keeps the public RPC signatures and pinned
normalization unchanged. Focused option-label, picker, editor, paste and authoring
tests cover field-wide collisions, separate trusted published baselines, readable
ordinals, literal suffix reservation, inactive choices and paging/search/reload.
`supabase/tests/metadata-choice-publication.test.sql` covers modern review/final
publication, permissive legacy draft-save followed by review/publish, raw-spelling
provenance changes, removal/reintroduction, stale versions/review tokens and
atomic failure without identity, event, receipt or answer changes. Historical
revision JSON, compiled options and event snapshots are compared byte-for-byte.
The existing form-save integration invokes `metadata-choice-display.ts` to compare
actual SQL paths with TypeScript over complete revisions, selected subsets and
reordering followed by historical reads. The 1,000-choice pgTAP suite retains
its one-normalization-per-option and output/resource-limit assertions.

`tests/e2e/metadata-choice-identity.spec.ts` uses a loopback-only coherent legacy
fixture for populated Inventory and Labels at desktop and 390 px in Full and
Reduced motion, unchanged-legacy editing and blocked spelling changes. The
existing nested authoring browser case now distinguishes fresh cross-parent
collision rejection from unchanged published compatibility. These database and
browser tests require the canonical disposable local stack or CI; source/unit
passes do not certify SQL execution, hosted summaries or actual populated UI.
Full database/type generation, browser captures, exact-SHA remote checks and
fresh independent review remain acceptance gates. Generated database types need
no API signature update for this private-function replacement.
Command palette regressions live beside the registry/provider, authenticated
POST route and TaskWorkspace. Real-provider tests distinguish same-binding
privacy pause/resume from revocation or binding drift, accepted-navigation serial
supersession, native history/terminal/unmount retirement, authoritative primary
focus and the explicit consumed-task handoff. Focus/readiness observers must not
settle another owner's pending work. The launcher keeps an authored 18 px glyph
slot while access is checking; its polite checking status stays outside header
flow. Component coverage verifies that slot and the asset/quantity sequence of
two accepted task consumptions followed by native same-record task re-entry.
This does not certify real Next/browser ordering or zero layout shift.
Real PrivacyController integration now exercises the first changed-key pending
attestation, held success with no early task, exact consumption cleanup and later
deliberate reentry. Negative cases retain initial raw-URL denial, generic refresh,
failure/recovery, binding/server/configuration changes, root/content/anchor changes,
hidden roots, business work, navigation, cleanup/revocation/assignment retirement,
A/B/A supersession with late success and malformed or semantic query changes.
These focused controller tests do not replace native Next ordering, browser
geometry or independent review of the changed preservation boundary.
The explicit server-route gate regressions cover asset and quantity tasks with
mounted query consumers. They hold first-render verification, require committed
consumption authority, exercise consumption/cleanup/reentry, and keep ordinary
content admission and new restoration bootstrap blocked. Revocation, replacement
owners, generic rechecks and superseded late replies cannot consume the held
receipt. Separate receipt tests reject minting from consumption-only authority.
The exact retained task-bearing server gate also covers two ordinary application
consumptions followed by native entry for both record types. Ordinary transfer
tests cover live callback revocation during readiness notification, busy work,
changed pending epochs, unsuccessful consumption, forged/mismatched controller
tokens and retired binding refusal, including admission of a genuinely new
navigation binding. The pre-consumption controller capture remains inert until
the successful handoff and its live post-call checks complete.
A held-cleanup regression proves that premature native query supersession stays
rejected even after the old verification succeeds. The browser's deliberate native
entry observes exact task-to-clean browser navigation and holds a subsequently
observed genuine privacy-generation response before requiring the visible Search
and commands launcher to be disabled. Only delivery of that unchanged response
and the launcher's subsequent enabled state permit native entry. URL removal or
an already-enabled stale DOM alone cannot establish fresh authority. Because the
app sends no-referrer, the helper uses observed navigation/request order and
fails closed if that order is unavailable; it never selects by Referer. Existing
failure geometry retains the launcher's disabled state without exposing
controller internals.
These working-tree checks still require native browser rerun and independent
review before exact-SHA acceptance.
The native re-entry, first inventory-row viewport and cold-title browser checks
emit bounded failure-only geometry; cold-title failures also report at most
eight layout-shift entries with four fixed-identity sources each. All shifts
still contribute to the unchanged zero-CLS assertions. Diagnostics omit DOM
text, raw URLs, arbitrary attributes and history/auth state, and rethrow the
original assertion. CI run `39328708840` at `608c0e4b` failed seven browser cases;
artifact upload hit the storage quota. The header status is a source-confirmed
layout contributor, not a proven explanation of those CLS failures. Native
timing, access-denial snapshot readiness, actual Next task re-entry and viewport
placement remain browser acceptance gaps until rerun on the integrated candidate.
The PR56 dependency integration retains its authored auxiliary registry, capture
completion collector and shared document clock. After an explicitly consumed
task, auxiliary source metadata uses the same effective full key as the accepted
primary and content identity; the immutable server anchor remains in the native
task guard. Rebinding cleans the old metadata registration. Asset and quantity
regressions cover repeated task consumption, exact clean-key lookup, stale
task-key rejection, live revocation and unmount cleanup. Registry metadata grants
no route or privacy authority. The joined shell retains both the room scene
budget and command providers under the existing protected scope, with both room
effects and shortcut preferences available in Settings.
The additive database search requires the
full canonical database gate, including pgTAP authorization/lifecycle/ranking
fixtures and canonical type regeneration. Under the default planner and caller
RLS, all nine exact deployed full-projection fuzzy arms cover selective, absent,
sparse 1/20/21-result and common 6,000-row workloads. Each of these 54 cases must
finish in <=500 ms, use <=16,384 root shared hit+read buffers, avoid temporary
spill, emit at most 21 IDs and preserve the independent reference's distance/UUID
order. A PL/pgSQL portal observer records actual emitted order without sorting;
a deliberately reversed-order regression guards that observer. Separate
index-eligibility plans change only the inner FETCH FIRST 21 ROWS WITH TIES count
to 1 and require the expected GiST index with Order By for all nine fields. These
eligibility probes do not establish deployed-query performance. Six whole
RPC workloads must finish in <5 seconds. Compact diagnostics retain plan costs,
estimates, actuals, buffers, field/relation statistics and planner settings;
planner flags, cost constants and operator leakproof flags remain unchanged.
These assertions define the required oracle; integrating them is not runtime
proof. Certification requires their execution through the canonical database
gate on the exact candidate revision.
The local palette integration gate also starts fresh PostgreSQL connections as
the nonsuperuser authenticated role. It reproduces the unregistered trigram
parameter failure, executes the actual breadcrumb migration prefix and function
header in a temporary schema with rollback, and checks threshold restoration.
A separate fresh caller proves nonmember denial and authorized search before
the extension library has been loaded in that backend.
The mandatory real Data API deadline integration must witness database
cancellation code 57014 before the client deadline and forced lock release.
Desktop/390px Full/Reduced staff/viewer browser/preview checks remain separate
acceptance requirements; a declared SQL timeout or component mock is not deadline
proof. See
[Search and commands](command-palette.md).

Checkpoint scope/accessibility regression coverage includes normalized location status/export links, caller-scoped record identity and unavailable history recovery, page-local versus full-row counts, empty inventory/destination states, page recovery, monitoring coverage, intact location codes and hidden/unmodeled/failed map guidance. Focused Vitest tests prove these contracts and stale-response handling; `scope-accessibility.spec.ts` exercises ordinary controls, real authorized reads and downloaded CSV across page boundaries. Required-input and category-focus interaction coverage lives in `scope-accessibility-forms.spec.ts`. Mocked reads are not integrated runtime or complete assistive-technology proof; use the existing disposable-local and isolated-preview gates for final acceptance.

Dedicated first-use acceptance runs on the disposable local backend: run `npm run db:reset`, then `npm run test:e2e -- --config tests/acceptance/checkpoint2.config.ts` before other data-creating tests. Authenticated precondition reads require zero quantity definitions, serialized assets and sites; a nonempty catalog or failed read fails the test rather than skipping it. The ordinary CI and full-validation gates remain unchanged.

The metadata database gate includes `supabase/tests/metadata.test.sql` and `tests/integration/metadata.ts`. It proves publication validation, direct-write denial, value evolution, draft UUID/version/published-pointer ABA rejection, and independent-connection item creation/update versus publication plus category removal/reassignment versus publication in both serial orders. It also checks that two export reads in one SQL statement retain the same inventory and category snapshot when another connection commits between them, while the next statement sees the commit. Export limits also require a real authenticated Data API download and hosted PostgREST timeout evidence before release; unit tests alone do not establish those bounds.

`npm run test:export:memory` runs without a database in an isolated Node process. It streams a 1,924,608-byte UTF-8 snapshot in 32 KiB chunks through the raw response reader, JSON parser and CSV encoder, and checks the 2 MiB raw and 3 MiB CSV limits, including the exact raw boundary and an oversized response. It samples heap plus external memory and RSS at reader and encoder checkpoints, adding the retained source fixture bytes to the incremental estimate. On the 2026-09-24 local run, the accepted 2,115,801-byte CSV used 31.7 MiB sampled incremental heap plus external memory and took 55.5 ms; a separate CSV expansion case threw before response at 38.7 MiB sampled incremental memory. These are observed checkpoint maxima in an isolated process, not a continuous transient peak or hosted Vercel measurement. The script enforces a 64 MiB sampled incremental bound and ten-second local processing bound; hosted end-to-end memory and timeout proof remains a separate gate.

For isolated hosted export proof, set the **server-only** `EXPORT_DIAGNOSTICS_ENABLED=true` on a Vercel preview deployment (`VERCEL_ENV=preview`) and redeploy that preview. No diagnostic log or response header is emitted in production or without both conditions. With an authenticated preview member, download a narrowly filtered CSV, a near-limit custom-field CSV, and a deliberately over-limit export through `/api/exports/inventory`. Record the HTTP status, `X-Inventory-Export-Error` on failures, complete file byte length on success, and `X-Inventory-Export-Diagnostic-Id`; match that random ID to the single structured server log. The log contains only raw response bytes, CSV bytes, elapsed stage times and sampled heap-plus-external/RSS deltas. Memory is sampled after each bounded response chunk and CSV row; the fixed stage keys retain only their latest elapsed time and the maximum sampled deltas, never a per-row log or value. Do not place inventory values, filters, user identifiers or tokens in proof notes. Turn the opt-in off after the preview check. A hosted 413/503 must have no CSV attachment header or partial file. Sampling at code checkpoints does not prove a continuous memory peak or isolate other requests sharing the process; use a platform per-invocation peak metric or external profiler before claiming a strict hosted 64 MiB peak.

package.json is the canonical command source. Iterate cheaply; certify the final candidate completely.

Route motion regression coverage lives in `route-motion.test.tsx`,
`shared-title-motion.test.ts` and `page-arrival.test.tsx`. Stable React/React DOM
and their types are aligned at 19.3.0; Fiber 9.8.1 supports that runtime and
Activity/Canvas lifecycle compatibility. Drei/Three remain unchanged. The jsdom
environment lacks native snapshots/layout, so Vitest supplies a children-preserving
adapter while focused tests inspect boundary intent and captured geometry.
This proves permission/identity/cancellation and transform-only replacement
contracts, not native animation. `route-motion.spec.ts` observes actual native
old/new capture and WAAPI replacement under the production Next runtime, including
duplicate holdings and animated app Back, instant unanchored/anchored native Back
and Forward with filter/row/scroll restoration, desktop/390 px/long/scrolled
titles, live-search query updates, canvas/ancestor exclusion, immediate reduced
and unsupported paths. It attaches before/after captures and native proof; actual
recordings/visual inspection must also rule out clipping and end snaps. Full build,
authenticated real-browser journeys, dirty/error/focus sibling workflows and
independent review remain required before accepting the route subset of D303.2.
Two authored supplemental E2E cases remain runtime PENDING: `location-browser-boundaries.spec.ts` requires actual 25+1 pagination and status/child/recovery links to preserve the validated location-browser return; `route-motion.spec.ts` checks that the real held Flight route falls back to an earlier observer for unclaimed prefetch probes before and after claiming navigation. They reuse canonical local fixtures/transport helpers and require the canonical authenticated production-build E2E gate. Authorship, discovery and scoped static checks do not establish browser acceptance or promote any of the 76 audit requirements.
The focused command is `npm run test:e2e -- tests/e2e/location-browser-boundaries.spec.ts tests/e2e/route-motion.spec.ts --grep "actual location status, pagination, child and recovery|held real Flight preserves earlier observers"`. It retains the canonical build and loopback-only owned-fixture lifecycle; a previous CI run cannot cover these newly authored tests. The existing location-boundary case separately exercises the real 33rd-expansion notice, duplicate-name breadcrumb labels and child Details return. Missing read-only hosted pagination/topology is not a pass for those surfaces.

For the PR54 route subset, exact bd467 canonical browser CI run `39498913854` passed its required/browser step for logout, same-actor/deferred denial, active system/local reduction, unavailable-start navigation, committed 33rd-expansion/duplicate-breadcrumb/child-return coverage and fallback unit tests. A separate 1280 px Full unsupported-identity run passed with `activeViewTransition` explicitly simulated absent before app interaction; it verified zero-stage Forward/App Back and preserved filters against a positive Full baseline in the same Chrome 151 engine. Its receipt is `.local-tools/pr54-hosted-bd467506/unsupported-identity-1280-full-v8-summary-20261021.report.json` (SHA-256 `3B5DB082938F24A05F1B91314B0FB59DB8BF1298D5C384B68C66391CCD12AE16`). This is scoped fixture evidence only: it does not establish natural browser support/absence or a physical-browser unsupported case. Retained bd467 hosted record/cold passes and scoped 390 px Full pixel review are documented in the [acceptance checkpoint](audit-4-2-acceptance.md). The four-configuration hosted Locations matrix completed all seven functional journeys per configuration; its aggregate report remains PARTIAL only for second-page pagination/33rd-expansion gaps (SHA-256 `3CBEA022828789CABCF421D3B6B9DFBD1839FB8142C843D66E0F794989FE4420`). Phone inline Full also has a functional pass, while its earlier residual remains unreproduced and not proved fixed. The newly authored pagination and held-Flight observer E2E cases and broader visual boundaries retain their own pending proof requirements.
Panels/receipts/disclosures remain pending U406 integration. W09 source and
journeys are implemented, with final readiness/overlap acceptance still pending.

Inventory title pairing uses the server's canonical row-return scope separately
from the full raw query key used by readiness and privacy admission. Default
type/status, trimmed search text, recovery flags and normalized page numbers do
not disable pairing for those rendered results. A row gesture records both the
canonical scope and that exact raw primary key. App Back reuses only the approved
origin with the existing record, holding and anchor checks. Native Back/Forward
restores the actual history scope without pairing or approving a different query. Focused RouteReady, inventory
page, pairing-component and motion-state regressions cover these contracts and
reject unrecorded aliases. They do not replace real browser/native capture proof.

The explicit detail-region follow-up covers actual asset, quantity and location
page composition with one canonical RouteReady marker. Cold compact slots and
warm canvas sentinels have no active capture ancestor; actual task launchers,
MutationForm/CustodyChangeForm and LocationPicker paths split around their lazy
map surface. The fixed region inventory bounds participant names before capture.
Coordinator regressions retain both original commit-order/raw-query proofs and
add concurrent shared/unmatched regions, batch sealing, duplicate/late callbacks,
final-participant completion and supersession/privacy fences. Both commit orders
also consume the outer arrival before sealing, then require reliable seal
publication, withdrawn title/region names and a newly mounted local region with
no capture name or source handoff. Lifetime regressions
prove every region receives an exact source lease, only final native cleanup
retires it, and cancellation makes all old callbacks/cleanups inert. Installed
React 19.3 dispatches queued native callbacks synchronously and attaches each
returned cleanup to the same transition.finished promise; the receipt seals only
after that batch. These component/source checks do not prove WebGL, native capture
geometry, phone layout or W13/A303/D303.2 acceptance. Independent Astra integrity
review, real browser/WebGL and exact-candidate certification remain required.

The running local-reduction case uses a second signed-in Settings page in the
same browser context. Its real motion switch is focused before the first page's
History transition; Space changes the stored preference at native readiness and
the browser delivers the cross-tab storage event. The first page must remain
visible, cancel while the snapshot is active, and keep later routes instant.
The helper page closes in cleanup. This exercises an actual cross-tab preference,
without injecting animation state or extending the native animation.

The W08 route-loading tests in `src/app/(protected)/loading.test.tsx`
mount actual Suspense fallbacks for Inventory/records, History/events, Labels, new
inventory records and category-form routes. They prove one loading status alongside delayed top
progress, actual reveal/readiness, retained Back waits, overlapping fallback
owners, retirement and unrelated pending work. `loading-skeleton.test.tsx` covers
local/system reduction, hidden-page shimmer/reveal cancellation and retained
content/focus without delayed errors. The duplicate announcement regression first
failed against the existing plain route fallback (two status regions), then
passed after opaque owner election. jsdom readiness geometry is supplied explicitly;
these tests do not prove streamed Next loading boundaries, native title pairing,
layout stability or populated visual quality. The existing delayed RSC/browser
journeys remain separate runtime acceptance. Retained route evidence is a
137-test batch across nine suites followed by a separate 56-test query/regression
batch; those results are not one combined run.

The audited inline W08 waits are now implemented in `spaces-workspace.tsx`,
`room-workspace.tsx`, `metadata-form.tsx`, `files-panel.tsx`, `label-designer.tsx`
and `assign-workspace.tsx`, with their paired component tests and the shared
`loading-skeleton.tsx`/test: 14 source/test files in the held local candidate.
Coverage includes renderer chunks, category fields, files, selected contents,
label search and compact queued-record details, occupancy and inspection.
Nonvisual loading announcements sit outside busy ancestors; errors, cancellation,
usable prior content, drafts, focus and mounted controls retain their existing
contracts. Quick fades follow real waits, including populated and empty file
successes; selected contents retain the existing 170 ms reduced-aware arrival.
The reveal controller reads only the canonical HTML motion mode and the OS
preference, never Storage. Unknown/missing modes remain static; withdrawal,
Reduced and hidden-page changes cancel motion without remounting private content.

Accepted local component evidence comprises 422 tests across reused scoped
batches, followed by the 76-test Files suite including two new deferred-empty
cases. This is not a single full-suite run or exact-SHA certification. Focused
regressions cover announcements outside busy regions, real readiness/error
settlement, deferred queue details, initial and empty file reads, inspection
cancellation/focus, unchanged privacy-admission storage assertions, stable
reveal DOM/focus, no fake initial-ready fade, and live motion cancellation.
Final ordinary consumer and independent Astra helper source reviews have no
actionable findings. Typecheck, scoped zero-warning lint, formatting and diff
checks passed during iteration. Native Full/Reduced populated/empty layout and
fade inspection, screen-reader announcements, streamed Next Flight/browser
journeys, integrated staging and the final canonical/exact-SHA gates remain
pending. Neither all of W08 nor D303.2 is accepted by these local checks.

`paired-route-loading.test.tsx` uses actual React Suspense/StrictMode to prove the
same outgoing node/draft survives a legitimate held pair, plus real primary reveal,
app Back, native Back cancellation, supersede, errors, reduction, provider retirement,
fresh-grant fencing and same-page draft/focus preservation. Its pathname/query
adapter updates inside React's route transition; a global pathname mutation would
incorrectly force an urgent keyed remount and is not a supported router simulation.
An accepted route exit may unmount its outgoing owner after revocation while its
replacement remains hidden; a baseline ordinary loading fallback demonstrates that
same owner relinquishment. Existing canonical privacy tests retain strict same-page
business/retry ownership and prove deferred revocation/recovery. Interrupted
paired navigation explicitly falls back to ordinary loading/crossfade: the real
privacy-controller regression proves the second destination can reveal or be
canceled, and late first/second primaries cannot replay over the current route.
The installed Next `RedirectBoundary` is exercised through an isolated router
context adapter for an untracked replacement and a query-only Back redirect;
the latter preserves an unrelated real pending registration. The route-key
effect cancels a mismatched presentation gate without manufacturing readiness.
These are React/isolated-boundary checks, not a complete Next LayoutRouter or
streamed Flight test. None of these jsdom tests establishes native snapshot pairing.

The precommit privacy regressions model a stable opaque router slot whose incoming
server primary finishes before privacy verification, plus native Back/Forward
restoration through the canonical post-commit privacy check. Controller/ticket tests cover exact repeated raw query
values, unrelated targets, original-binding verification, stale actor/backend/
role/configuration/server-generation/revision/epoch rejection, hidden-page and
provider retirement, supersede/cancel/redirect settlement, denied/unavailable
identity and distinct recovery after changed logout evidence. The first changed-
revision render must reject a completed ticket before private bootstrap effects
mount. These logical React fixtures do not establish real native snapshots or
production LayoutRouter timing; browser CI remains required.

Native browser Back/Forward is intentionally instant under the installed eager
Next/React restore. The removed Navigation API preparation no longer claims a
native shared-title animation. Native provider regressions in
`native-route-traverse-provider.test.tsx` verify
no precommit preparation/interception/history writes, cancellation of departing
snapshots and paired work, real actor/route readiness, Reduced/unsupported behavior,
revocation/retirement fencing and animated app Back after native Forward.
The paired-route-loading suite retains real privacy-controller and cached Activity
restoration with both router-listener orders and explicit verification delays.
App Link forward/Back still requires positive shared-title capture and transform
replacement in the browser suite; native Back/Forward requires zero captures and
correct filters, source row/anchor, scroll and authorized primary restoration.
Component fixtures do not establish actual browser history, scroll or hosted Auth.

`native-scroll-restoration.test.ts` covers the bounded provider-local history-entry
checkpoints used when a privacy recheck collapses the destination and clamps scroll.
It checks exact query/hash and entry identity, repeated URLs with different offsets,
both admission and popstate-listener orders, already-authorized entries without a
new readiness effect, plain router filters, exact internal replacement, user
interruption, rapid traversal, authority invalidation, stale callbacks, the 50-entry
cap, finite/nonnegative offsets, shorter-page one-shot clamping and unsupported or
failed observers. Pointer/scrollbar and middle-mouse interruption coverage also
proves that inactive input leaves normal checkpoint capture intact. Aborted
dirty-leave attempts resume capture at the unchanged authorized source, preserving
the user's later offset; one owned AbortSignal listener is retired on supersede,
commit, authority change, detach and disposal. Delayed aborts cannot cancel newer
pending restoration or reauthorize retired callbacks, and temporary privacy checks
still wait for a fresh grant and real primary. These paths do not prevent browser
input, intercept navigation or rely on a global navigation-error event. Explicit
same-document fixtures retain those freeze/abort regressions. Cross-document
same-origin and external destinations instead leave authorized current-source
capture active: choosing Stay with neither signal abort nor entry change must
preserve a newer offset for a later real native traversal. Missing sameDocument
proof cannot start a departure freeze; superseded same-document abort callbacks
cannot interfere with a subsequent traversal. These are coordinator regressions,
not proof of a real browser's beforeunload dialog or hosted document lifecycle.
`native-scroll-restoration.integration.test.tsx` mounts the real
route provider and canonical readiness owner to exercise hidden same-authority
privacy collapse, both admission orders and real revocation notifications. Three
additional provider regressions reproduced premature restoration when a new
primary registered in the same commit as a changed privacy generation, a new
actor with a retained old-actor primary, or ready=false with visible=true. Publishing
committed privacy/actor references in an insertion effect before child layout
notifications makes those regressions pass; the same-authority pending checkpoint
still survives the temporary check and restores once after a later fresh grant.
`route-readiness.test.ts` also proves that read-only primary observation neither
acknowledges commits nor settles another owner's pending registration. Focused
helper/provider/readiness and route-motion sibling checks use one worker and a
768 MiB heap; canonical typechecking uses 1536 MiB with scoped zero-warning
lint/format checks. These are local jsdom
contracts with supplied geometry and scroll behavior. They do not prove actual
browser document-height collapse, final-candidate native restoration, hosted Auth
or native animation; authenticated browser proof and independent review remain
required. Native history must stay instant while application Back remains animated
under the existing Full-motion requirements.

The native route-motion browser case now authors a real server-primary delay after
early Flight fallback bytes, rather than holding a complete HTTP response. The
`route-primary-delay.ts` fixture refuses hosted/nondefault endpoints and scheduling
overrides before SQL. Only canonical loopback API 54321/database 54322 and the
single-worker exclusive route-motion phase are accepted. A transaction acquires
`quantity_items` ACCESS EXCLUSIVE only after the owned source screen is rendered;
an independent local connection observes blocked primary reads. Acquisition,
statement and idle-transaction timeouts are session/transaction scoped; finally
rolls back and closes both connections. This changes no data or schema. A separate
authenticated bounded Flight reader observes fallback bytes while the actual browser
request streams normally; neither headers nor body are attached. The held source
must remain the same visible node, with live progress and no fallback/native capture,
before release and the exact forward/app Back title assertions, followed by
functional instant native-history assertions. Fixture/scheduling
guards have unit coverage. System and browser-local Reduced cases at 1280/390 px
also hold real primary reads through fallback, restore native history URL/filter/
scroll state, deliver an interrupted real Flight response after native Back, and
activate anchored application Back by keyboard. They assert no native transition,
title replacement or lingering pseudo-element animation, ordinary Reduced record
skeletons, and normal focus after the departing link is removed. These authored
cases have not been executed in this
bounded integration cycle. They require the canonical disposable stack/production
Next build and cannot run against a hosted preview. Hosted proof uses ordinary slow
routes and native observation without this local lock fixture.
The shared held-response helper rejects its delivery promise when genuine fetch
or fulfillment fails; cleanup completion remains separate. Unit regressions force
late fulfillment rejection after arrival, prove delivery waits for successful
fulfillment, and retain cleanup after fetch/abort failure. Cached content therefore
cannot substitute for the journey's awaited late-response fulfillment.
Inventory destination-prefetch regressions cover the shared route-link policy,
navigation hover/focus overrides, URL-object/query/hash handling, creation and
external-route exclusions, ordinary navigation guards/modifiers, and the raw
asset-tag advisory exception. The production-browser Full case now includes a
real custom-answer Full details sibling with the exact paired row href, discards
the prior router cache through hard source navigation, and cancels any genuinely
attempted inventory partial prefetch. It requires zero such requests after real
sibling hover/focus, cold primary-held title pairing, native history, app Back
and navigation-link intent. The canceling probe exercises the old null-prefetch
failure path if a caller reintroduces speculative requests; it never manufactures
Flight, resolves a private cache promise, or bypasses the actual primary lock.
Unit checks cannot establish native cold pairing; the actual production-browser
case and exact-candidate hosted acceptance remain required. Disabling speculative
inventory fetches may increase cold-click latency; no framework patch or provider
upgrade is included.
The decisive actual-React regression first reproduced async-action entanglement:
a replacement caller rendered Ready while native pending remained behind a
departed caller's unresolved action. It now passes with per-invocation promise
tracking outside React async transitions and synchronous-only route transitions.
Focused checks cover simultaneous task owners, late completion/rejection, owned
abort, actual suspended route reveal, exact synchronous router errors, Activity
readiness and quiet provider retirement. The latest bounded cycle passed 305 tests
in ten affected suites, canonical typecheck and scoped zero-warning lint. A
post-typecheck null-guard correction also passed all 31 route-motion tests.
Final formatting and full certification remain pending. Independent review found holding-identity and
local-busy lifetime gaps. The source correction carries stable storage/site UUIDs
or explicit unplaced identity through Back pairing and separates invocation busy
from global presentation epochs. New replacement/deletion/reordering, hash Back
with a held Settings request, same-owner overlap and retained-closure regressions
passed in that cycle.
Residual-origin corrections additionally cover prior-origin ambiguous capture,
ordinary same-record full-details links and canceled capture followed by a plain
same-href gesture. Their one-event approval and independent-task preservation
regressions also passed. Lint repairs preserve provider incarnation guards and
derive local busy from committed snapshots of actual task-map events; the latest
305-test run includes those repairs. These results do not establish native capture
or streamed browser readiness.
Real WebGL mount/unmount, native Back, camera preservation and canvas-ancestor
exclusion after Fiber upgrade remain mandatory browser criteria. The room journey
checks a nonempty visible canvas-to-root ancestor chain for excluded transition
names at remount and Back, plus any names observed during actual native captures.
The whole-page boundary explicitly excludes room source/destination snapshots;
ordinary privacy verification can reveal its separate header synchronously, so
this journey does not require a positive snapshot count. Eligible paired-title
journeys retain their positive native-capture assertions. It also requires an
exact camera roundtrip and zero document navigation fallback; it does not claim
Next's Activity cache was used. These corrections still require browser reruns.
The camera journey now covers Full and Reduced motion at both widths, including
Free Orbit, Pan right, Close controls, Search inventory and native Back before
Hide/Show recreates the renderer. It compares the live canvas pose with the saved
workspace pose. CameraRig regressions cover replacement camera/controls resources,
withheld restoration grants, outgoing-resource cleanup, explicit selection focus
and consumed-command preservation in both motion modes. Passing these local
resource regressions does not establish that the hosted reduced-motion failure
used that resource replacement path; the exact hosted journey remains required.
The Effects integration also proves controls attachment/replacement preserves the
reveal controller, confirmed-render readiness still precedes explicit focus, and
an outgoing frame cannot cancel or complete the replacement flight. A retired
original renderer session leaves a previously withheld camera untouched.
Repository runner image inputs were regenerated;
Bundle coherence/version requires root-owned integration with the current runner
baseline before final certification.

Additional authored native journeys at 1280/390 px use actual mobile Menu
navigation, ordinary logout/preference controls and genuine read-only action
denials for disposable loopback actors. They observe cancellation during a
running snapshot without pausing or extending animations. The deferred-denial
journey across logout/login proves real response transport, zero observed
in-flight cancellations and preserved replacement navigation. `route.fulfill`
is not a client observer-completion barrier: this browser journey does not
positively observe the private retired-scope continuation. The completed-callback
and generation-isolation unit regressions remain authoritative for that rule;
isolated browser continuation proof remains limited. These additional browser
journeys are authored, not runtime-accepted, until the real loopback suite runs.

The canonical database integration gate runs
`tests/integration/audit-four-edit-integrity.ts` after the existing Audit three
contracts. It directly calls every supported legacy/v2/v3 metadata update API,
checks authorization before receipt replay, stale intent, receipt mismatch,
omitted/cleared metadata, lifecycle, exact no-op timestamps/events/provenance,
integer version exhaustion, historical datetime equivalence and rejected
malformed/overprecision values. Independent PostgreSQL connections overlap a
real edit and a no-op in both serial orders. Current assignment origin checks
cover more than 25 transfers/corrections, a new assignment episode and site
opening without a storage origin. These tests require the existing clean local
database gate; static inspection is not a pass.

The same suite distinguishes explicit false, zero and empty-string answers from
absence: an identical set retains the historical envelope, unset changes once,
repeated unset is a no-op, and restoring a falsy answer is a real edit. A separate
rollback-isolated case extracts exactly the previous and candidate
`quantity_update(uuid,jsonb)` definitions from repository migrations. The old
implementation actually generates its receipt/event; the candidate then replays
that exact response and refuses replay for an inactive member. Complete inventory,
history, receipt and function definition/ACL snapshots are restored afterward.
This proves replay of a receipt produced by the previous implementation in one
transaction. It does not prove committed receipt durability across a literal
full migration upgrade. That requires a disposable prepare/apply/verify run,
following the existing `tests/integration/custody-upgrade.ts` pattern; the ordinary
fully migrated `test:db:compatibility` suite has no pre-migration preparation phase.

`edit-integrity.spec.ts` and the focused additions in `inventory.spec.ts` exercise
unchanged asset/quantity editors, real case-only asset tag edits, Receive defaults,
Move/Issue source counts and current-episode Return defaults with manual/cleared
destinations and stale-form review. Unit/component tests cover malformed and
ineligible origins, transport errors, unchanged grandfathered answers and exact
microsecond comparison. Custody form regressions also reject resubmission after
a definitive stale-version response before new props arrive, retain the draft
through failed read refreshes, and require explicit latest-holdings adoption and
renewed review before using a new version/request. Uncertain outcomes retain the
original command for exact retry. Final UI acceptance also requires real populated screens
at desktop and 390 px in Full/Reduced motion, with captures on the validated
candidate. Local code/test additions do not establish that browser acceptance.

| Command                       | Responsibility                                                            |
| ----------------------------- | ------------------------------------------------------------------------- |
| npm run typecheck             | Strict application/test TypeScript                                        |
| npm run lint                  | ESLint, zero warnings                                                     |
| npm run format:check          | Formatting verification                                                   |
| npm run test / test:watch     | Unit, room, auth and component tests                                      |
| npm run test:export:memory    | Isolated sampled export reader/CSV memory and byte-bound checks           |
| npm run db:start / db:stop    | Local Supabase lifecycle                                                  |
| npm run db:reset              | Explicit local reset and migrations                                       |
| npm run db:types              | Generate committed database types                                         |
| npm run db:types:check        | Fail on drift without rewriting tracked files                             |
| npm run test:db               | pgTAP and local-Supabase integration contracts                            |
| npm run validate:db           | Clean reset → DB tests → type comparison                                  |
| npm run build                 | Production build without a live database                                  |
| npm run test:e2e:list         | Discover browser tests without a running backend                          |
| npm run test:e2e              | Local fictional users, backend-specific production build, Playwright      |
| npm run validate:app          | Static checks, unit/components, E2E discovery, production build           |
| npm run validate              | App gate, clean DB gate and critical E2E                                  |
| npm run db:deliver:production | Main CI only: forward migration delivery and version-history verification |

Start Supabase before database/full validation. Final certification runs fresh `npm ci` then `npm run validate`. E2E rebuilds with local public backend values because they are build inputs.

The database gate uses the repository `db:start` bootstrap to install the local-only Storage `v1.77.9` override, then verifies the actual running image before reset and integration tests. `npm run test:local-storage` covers fresh-checkout creation, cache drift, linked-cache preservation and wrong-image rejection without Docker; CI's required job additionally exercises the real clean-checkout start. This override never enters the production migration-delivery command.

The disposable-local Auth prerequisite also verifies the configured invitation and
recovery template bodies after startup, database reset, and the E2E password-policy
container replacement. It validates the local Docker endpoint and exact project,
containers, network and template URLs before requesting only the two static Kong
template paths. It allows up to 30 seconds of template readiness, bounds each
command and response, rejects HTTP redirects, and compares the responses with the
actual canonical files selected by `supabase/config.toml`. Before start/reset,
both files are validated and read before either permission change; Unix prepares
only these public files with mode `0644`, while Windows validates without POSIX
chmod. Permission reports contain only fixed template kinds and numeric file
modes, UID/GID and the unchanged process umask. Service reports contain only a
phase and fixed match/failure categories (plus validated failure HTTP status);
neither includes paths, email links, tokens, environment values, response bodies
or raw daemon errors. A failed prerequisite still restores
the original Auth container through the existing fixture cleanup.

`npm run test:auth:policy:contract` covers these diagnostics with mocked services,
including transient readiness, missing listeners, wrong content/configuration,
redirect rejection, redaction and cleanup after a template failure. Real proof uses
the existing `npm run db:start`, `npm run db:reset`, then
`npm run test:e2e -- tests/e2e/foundation.spec.ts`; the full CI workflow runs the
same boundaries. PR44's earlier API-origin email failures indicate default-template
fallback, but the underlying runtime cause remains unproven until those disposable
checks execute. These probes do not replace the browser assertions for application
origins, GET nonconsumption, explicit confirmation and CSRF protection, and they do
not inspect or change hosted Auth configuration.

## Proof by layer

`privacy-read-sdk.test.ts` exercises the installed Supabase SSR, Auth and
PostgREST SDKs with intercepted outbound fetches and cookies seeded by the SDK.
Expired and near-expiry sessions issue no outbound refresh request or cookie
write and return unavailable, including the SDK's still-valid bearer fallback.
Explicit-JWT user verification plus an Authorization-bearing membership request
also exercises PostgREST's session refresh path. Matching, revoked and changed
bindings, a held read after caller logout, and ordinary writable refresh followed
by privacy retry have permanent coverage. The fetch guard separately rejects
non-GET, other tables, credentials, other origins and redirects. These tests use
synthetic provider responses; they do not certify hosted Auth configuration.
The query-only Scan and retained private-title browser fixtures defer or reject
the canonical `read-generation` POST to `/api/auth/privacy-read`, with exact
operation selection; identity verification and business actions pass through.
They continue to assert withheld storage bootstrap, hidden private presentation,
cleared document titles and preservation of the original draft owner.

The logout privacy regression also mounts a populated label queue with an already
acknowledged generation, fails authoritative logout cleanup, then retries under
the same cookie generation. It verifies that cleared entries disappear from the
workspace and are never persisted again from the old hydrated instance. A sibling
test delivers successful first-attempt SIGNED_OUT through the mounted Auth observer,
then rechecks the matching generation after its cleanup marker is gone. Shared
cleanup revision tests distinguish successful authoritative wipes from ordinary checks
and failed removal attempts.
The label persistence regression resolves a delayed old-instance refresh after
verified cleanup but before the readiness reset commits; the cleared queue key
must remain absent until the new empty workspace persists its own state.

Audit 4.2 P02 scan-batch regressions cover bounded UTF-8/schema/CAS storage, compact immutable operation snapshots, request/event deduplication, exact uncertain replay, legacy recovery and terminal cleanup reconciliation, restored historical reviews and nonmutating current availability reads, inactive destinations and evacuation-source preferences, safe Finish/End, capacity and privacy generation invalidation. Component checks include immediate inspection status/busy state, deliberate Cancel focus, chooser/review/error focus, deferred responses after ticket/source/destination/account changes, terminal storage failures and logout success/error/transport paths away from Scan. Auth tests preserve the caller-scoped local signout contract and sanitized acknowledgements. These tests do not replace actual browser/database proof.

`tests/e2e/scan-assign.spec.ts` uses real local Auth/custody actions and ordinary controls for record visit + actual Back, reload + automatic availability refresh, immutable checklist/event links, deliberate repeat assignments, Finish/End, cancellation, independent writer stale stock, blocked command persistence, an actual server-action fetch with a lost browser response, exact replay with one event, terminal cleanup failure + clear-only reload, and successful signout from another route. Run through the canonical `npm run test:e2e` disposable loopback environment; do not point fixtures at a hosted backend. A Docker-unavailable host may run focused unit/component checks and typecheck, but must record real E2E and the complete DB/application gate as pending CI. Full/Reduced desktop and 390 px hands-on candidate acceptance, real devices and P10 Light-mode acceptance are separately required.

Held restoration checks correlate the response to the exact intercepted request,
require HTTP success, then assert the decoded business result, busy state, focus,
stationary Cancel target and absence of writes. A Next action result can be usable
before its enclosing Flight stream ends; stream EOF is not restoration completion.
The focused transport regression preserves this distinction and rejects an
interleaved response with identical business arguments from a different request.

Shared live-validation regressions cover every form-hook caller, including category create/rename and site/location management. Native validity changes followed by blur must clear associated errors without another submit; ordinary controlled typing retains its existing revalidation. Move completion regressions inject browser get/remove failures after commit and cover standalone Done, workspace Done/Close/switch and Move more after a fresh snapshot. Warnings remain visible after the task unmounts, unrelated/newer/different-item/malformed references remain untouched, and pending/uncertain commands still block closure and switching. These component checks do not replace database or real-browser certification.

Checkpoint 3 operational composition is exercised through ordinary controls in `tests/e2e/operational-composition.spec.ts`, including creation review visibility, one mounted detail task, explicit next transactions, lifecycle review and compact history. Focused creation-summary and task-state/component regressions cover normalized intent, cleared/default/absent answers, dirty Stay/discard, pending and uncertain switching barriers, exact retries across refreshed versions and eligibility, retained receipts and actor/record isolation. These presentation and client-state changes introduce no new persistence semantics; existing RPC authorization, version and retry contracts remain authoritative. Mocked file cards and loopback-only local Storage fixtures prove their stated UI/local paths, not hosted private download, upload validation or cleanup behavior. Hosted file proof still requires authenticated isolated-preview checks against actual authorized states, as described in [inventory files](inventory-files.md).

Creation recovery regressions in `creation-recovery.test.ts` and `metadata-form.test.tsx` exercise exact-instance remount, canonical explicit recovery, URL-normalization barriers and same-instance retry after interrupted navigation, actor/backend/origin/kind/site isolation, raw false/zero/empty/missing and touched clears, incomplete datetime/timezone, site-opening inputs, explicit schema reconciliation, submitted replay, pageshow locking, discard/saved tombstones, late-request refusal and quota failure before dispatch or after acknowledgement. A representative 100-field definition plus retained prior schema, near-256 KiB custom answers and duplicated command payload checks the envelope ceiling; instance exhaustion never evicts pending or terminal data. Shared datetime authoring tests retain the existing mount-report behavior and check the additional synchronous edit reporting.

Real-browser acceptance remains necessary for Back/Forward and internal navigation, same-tab reload, native refresh/tab-close prompts, keyboard/focus and narrow layouts. Component pageshow dispatch proves the state contract but does not establish actual browser BFCache eligibility or restoration. The creation recovery E2E suite uses isolated fictional fixtures and an actual server-action route fetch followed by an aborted browser response, then reloads the durable command and retries its original request UUID. Authorized reads verify exactly one asset and creation event, followed by audited retirement. Mocked component actions do not prove database idempotency or hosted Auth. Closed tabs and cleared browser storage are explicit recovery limits.

Quantity action-state regressions cover source overdraw before review, whole-unit/overflow input, field-associated errors and focus, invalidated review snapshots, acknowledged completion through data refresh and per-tab receipt recovery, exact unknown-response retries, double submission, genuine stale conflicts, and deliberate fresh Move more. Receipt action tests cover exact event/entity filtering, conserved immutable lines, current member/actor checks, and postcommit history/cache failures. These mocked tests establish UI/action behavior; real accounting, independent authenticated writer races and hosted browser acceptance still require the canonical database/E2E gates.

The record-page reload regressions follow U406: explicit Move stock selection opens fresh input after exact authorized receipt and current snapshot verification, with the prior receipt collapsed in timestamped Last move details. The older browser assertions requiring Previous move receipt and Move more after this explicit selection are superseded. Component coverage defers each read independently, preserves the pointer and immutable historical balances despite later stock changes, and confirms the next submission uses a new request identity and the fresh version. Both quantity browser journeys retain exact saved event identity/time, historical balances, unchanged current stock/version and one movement event before the next write. Active completion still exercises Refresh balances and stationary Move more; standalone completion restoration, unknown-response guards, actor/backend isolation and withdrawal coverage remain. Component checks and browser test discovery do not replace execution of the canonical E2E gate.

Location-catalog regressions exercise fresh snapshot adoption through Move more, balance refresh and invalid-reference recovery, and catalog-only prop changes that invalidate confirmation. Deferred label lookups exercise the actual individual pending Remove controls, including failed lookup and partial cancellation without late resurrection. The label browser suite delays an authorized response and removes one unresolved quantity while preserving an unrelated location addition and normalized URL through reload.

Unit/component tests cover strict room parsing, measured/default classifications, coordinate mapping, capability predicates, auth validation, explicit confirmation, and cookie refresh behavior.

pgTAP proves counts/categories, immutable identity, hierarchy integrity, role-based reads, direct-write denial and immediate deactivation. A separate real database integration test checks the exact 35-location fixture, room bindings/parents/capabilities, and concurrent hierarchy writers.

Playwright uses real local Supabase and the production Next server for login/logout, membership denial/deactivation, phone layout, captured invitation/recovery emails (including a deployment origin different from Site URL), password updates and token replay rejection. Do not substitute mocked Auth for this proof.

## Efficient iteration

Run affected tests first and reuse dependencies until dependency inputs change. No Supabase reset for isolated visuals. Schema, seed, RLS, function or persisted-contract changes require the clean DB gate. Preserve regressions; do not skip tests to achieve green checks.

Foundation CI retains the stable `required` check. Every PR runs the complete application, database, types and browser gates on `self-hosted, it-inventory-heavy`, with one fresh dependency install. Main first runs a read-only `reuse_evidence` job on `it-inventory-light`. Only verified evidence selects a light `required` job; ordinary evidence misses select the complete heavy gate. Its application step builds with unreachable placeholder Supabase configuration; E2E then rebuilds with the actual disposable local backend. The placeholders are scoped to the application step. A final full completion check rejects every missing, skipped, cancelled or failed mandatory step, including database cleanup. The final decision check also rejects failed evidence jobs and incomplete reuse verification. Production database delivery and trusted preview discover/provision remain separate fresh `it-inventory-light` VMs. The separate diagnostic `Local runner pilot` remains restricted to the exact reviewed SHA using `it-inventory-pilot-<headSha>`. Repository labels express routing intent; they do not prove live host activation or runtime certification. The [local runner runbook](development/local-runner.md) defines host provisioning and disposal. Linux Bash/Git, the pinned Node/npm toolchain, Docker, writable installation directories, outbound dependency/image access and Chromium system libraries must be available. `playwright install --with-deps` requires compatible Linux package management and permission to install its system dependencies. Separate VMs/daemons prevent collisions between fixed Supabase names/ports and isolate production credentials from test code.

Main reuse requires a uniquely associated merged same-repository PR into `main`, whose merge SHA is exactly the pushed target and whose head has the identical whole Git tree. This covers application code, tests, workflows, scripts, configuration and dependency inputs. GitHub's canonical workflow ID/path, PR event, repository/head identity, latest matching run and latest attempt must agree. The completed successful run must have started within seven days; its attempt-specific `required` job must show every uniquely named full gate, workflow-source check, cleanup and terminal checks as completed successfully. Missing, skipped, duplicate or partial evidence is a miss. The API may return an empty run `pull_requests` array after merge; the authoritative commit-to-merged-PR-to-head association remains required, and any populated run association must agree. The inspector never trusts run names, artifacts, or an older green run behind a newer failed/running run. Read-only requests have a shared 45-second deadline, 45-request ceiling, two-MiB response bound and five-page ceiling; unavailable, incomplete or ambiguous API evidence falls back to full validation.

An optional full-run workflow-source inspection compares the executed workflow source at `github.workflow_sha` with the checked-out workflow bytes. Only a successful inspection with an explicit verified output runs the uniquely named source marker; reuse requires that marker to succeed and independently compares the workflow bytes with the tested head. Inspection errors or source mismatch leave the marker skipped and make the run ineligible for future reuse, while preserving the full test gate during API outages. This prevents accidental synthetic-PR workflow drift from becoming reusable evidence. It trusts reviewed same-repository workflow code under the existing protected-main policy: the step name is workflow-controlled, not a signed provider attestation or independent proof against malicious authorized workflow edits. Existing workflow review and branch protection remain necessary.

The light `required` job repeats the complete evidence lookup, including fresh latest-run and attempt readback, and requires identical provenance before succeeding. A late rerun, new run, evidence deletion, expiry or API outage fails that light job and blocks production delivery; it never starts database/E2E work on a light VM. Rerun main CI to obtain a fresh decision and the heavy fallback when evidence is unavailable. The job summary links the exact main target, source head, whole-tree SHA, PR, source run/attempt, job/workflow identities and completion timestamps. This is reused validation of identical content, not a claim that the source PR run tested the distinct main commit SHA. Older runs missing this new named-gate/source contract fall back safely.

The full `npm run test:e2e` runs exclusive files first with one worker, then the reviewed independent files with at most two workers. Tests within each file retain their order (`fullyParallel: false`). `scripts/e2e-scheduling.ts` is the explicit parallel allowlist; every unlisted or future spec defaults to the exclusive phase. Shared membership/session changes, singleton label defaults, signing-key expiry, Storage quotas and the custody fixtures used by visual inspection stay exclusive. `experience-visual.spec.ts` also stays exclusive: it selects the first global inventory, category and site records, which another test could archive, retire, rename or remove between navigation and inspection. A reader of mutable records owned by another spec needs exclusive scheduling or stable spec-owned fixtures before entering the parallel allowlist. Parallel mutable workflows target unique inventory/category/site identities and use separate browser contexts; they do not publish shared default-category forms. Stable seeded categories/locations may be read while all parallel writers leave those references unchanged. The default full gate retains one backend-specific build, server, user seed and signing-key lifecycle. No test results or backend builds are cached.

Focused commands such as `npm run test:e2e -- tests/e2e/00-room.spec.ts` use the original single `chromium` project without dependency expansion. Any explicit Playwright arguments select this ordinary mode, including a full serial comparison with `npm run test:e2e -- --workers=1`. For discovery alone, `E2E_FULL_SUITE=1 npm run test:e2e:list` lists the scheduled partition; omit that environment flag for ordinary discovery. The scheduling regression checks compare the actual full discovered test identities in both modes, reject duplicates, verify project placement and preserve focused room selection. They run in `npm run test`.

Separately authenticated SDK fixture clients in parallel specs must end only their
own session with `auth.signOut({ scope: 'local' })`. The installed Auth client
defaults to global sign-out, which can invalidate the same staff account's browser
session and another worker's session. The scheduling regression checks direct SDK
cleanup calls in the reviewed parallel specs for explicit local scope. It does not
change production sign-out or make new files eligible for parallel execution.
Unchanged metadata edits expose Close and Nothing to save; browser readiness waits
target enabled editable fields, then retain Review/Confirm assertions after actual
changes. Real parallel CI remains the verification of fixture-session isolation.

Ordinary CI captures traces and videos on the first retry; ordinary local runs retain failure traces and disable video. Both retain failure screenshots. Set `E2E_CAPTURE_EVIDENCE=1` explicitly to capture traces and videos on every attempt, including successful tests, through the same `npm run test:e2e` backend-specific build. The flag changes diagnostic capture only: test selection, assertions, ordering and retry counts remain intact. Both `experience-recordings.spec.ts` journeys always run; explicit evidence mode additionally requires their recorders and saves `navigation-designer-gesture-save.webm` and `room-camera-label-print-preview.webm` under ignored `.local-tools/experience-visual/recordings`. Normal runs still close their pages but do not save named recordings. The dedicated Checkpoint 2 acceptance config retains its explicit trace capture. Unit policy checks and actual Playwright discovery compare both capture modes in ordinary and scheduled selection.

For a focused evidence run in PowerShell, set `$env:E2E_CAPTURE_EVIDENCE='1'`, run `npm run test:e2e -- tests/e2e/experience-recordings.spec.ts`, then remove the flag with `Remove-Item Env:E2E_CAPTURE_EVIDENCE`. Inspect both newly written WebM outputs before reporting visual evidence. Capture comparisons must use the same candidate, hardware and test selection and report browser duration separately from build time; a Windows comparison does not establish Linux capacity or whole-suite speed.

The E2E reporter writes sanitized `test-results/e2e-performance.json` and a compact log summary: checkout SHA, browser-suite elapsed time, discovered/executed/passed/skipped/flaky counts, configured workers and observed peak concurrent tests. Linux samples report actual guest memory, minimum available memory, peak swap use, sampled CPU utilization and kernel OOM-kill delta; missing or non-Linux metrics are explicit. The reporter observes the browser phase and does not measure build time, guarantee that brief memory peaks were sampled, or alter test outcomes. Acceptance requires a complete real Linux 6 GiB/static guest run of every gate/test, a meaningful duration reduction against the recorded main baseline (120 tests; the candidate adds Checkpoint 2 coverage), and inspection of CPU/memory/OOM metrics. A same-candidate serial/parallel comparison with a clean database provides stronger isolation/performance evidence. Configuration, discovery and Windows passes alone do not establish Linux capacity or speed.

Offline PowerShell contracts cover profile capacity boundaries, strict label classification, queue skipping, exact-profile VM/JIT propagation/readback, capacity loss and legacy recovery. `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/local-runner/Contract.Tests.ps1` also exercises profile-specific cloud-config/readiness, current-metadata archive reuse, hash/ACL/reparse refusal, atomic publication and bounded retention, plus immediate successful-job pickup and retained idle/error backoff. Light/mid workflows use Bash/Node and remote Supabase CLI operations; Docker readiness remains required for heavy/legacy/pilot guests. Install the reviewed runtime before exercising its changed routing; source contracts do not establish installed cutover, measured startup improvement or real job results.

The heavy profile is a fixed 6 GiB/static-memory candidate with 1 GiB unallocated host reserve (7 GiB admission). Light/mid keep their previous sizes/reserves; legacy ephemeral and exact-SHA pilot remain 8+2 GiB. `Contract.Tests.ps1` includes capacity-observation and unattended-recovery regressions: actual queue/loop wait and resume, complete per-profile Status, guarded active-only recovery, explicit Stop/journal/provenance/credential/VM refusal, cleanup-before-restart and fail-fast exclusion by a separate real fixture process. Scheduler/VM operations remain mocked; these tests do not establish installed task startup, host process-loss recovery or real reboot. The runbook describes owner-installed verification. Before accepting the smaller heavy profile, record a complete real database/Playwright job with no skipped checks, its exact workload SHA, installed bundle version/hash and verified live guest memory/dynamic flag. A pass does not establish measured OOM absence or continuous 24/7 availability.

The diagnostic `Local runner pilot` uses its exact workflow/head SHA and must record Linux and Docker versions plus a real disposable container execution and verified removal. Static YAML/shell checks do not prove the VM, runner registration, Docker lifecycle, app/database/E2E gates or trusted secret-bearing jobs. Before enabling active pickup on the live host, complete host security checks and independent review. After normal routing is enabled on the live host, certify the full workload in the first normal PR CI run and certify the four validation/preview jobs through their appropriate PR/main/preview contexts; preserve the `required` check, trusted-main preview execution and protected environment restrictions. Record activation and runtime certification as installation-specific PR evidence, including installed bundle identity, pilot/recovery receipts, owner acceptance of the residual detection window, and exact-SHA normal job results. Activation and a passing diagnostic pilot do not establish normal-workload or production certification; keep unexercised contexts and real reboot recovery explicit. No GitHub-hosted runner fallback or npm Actions cache is configured.

Failure reports retain seven-day GitHub artifact storage. Uploads are best-effort and warn when quota or availability prevents them; failed tests still fail the `required` job. An absent upload is a diagnostics limitation, never evidence that tests passed. Disposal must also occur after failed or cancelled jobs.

Before artifact upload, the existing Playwright performance reporter prints and appends bounded Browser failure metadata to the job summary: up to twenty failed/interrupted/timed-out attempts, repository E2E source file/line, status, retry, worker index, error count and whether Playwright attached a trace. It reports omitted attempts explicitly. Titles, assertion messages/stacks, test output, attachment paths/contents, environment values and HTTP bodies are excluded. The existing list reporter remains the source for assertion details in the Validate browser workflows log. If artifact upload fails, the workflow also records the limitation in the summary: there is no downloadable trace from that upload. Cancellation or process termination before reporter completion can leave this metadata absent too. This fallback improves diagnosis and does not repair provider storage quota, preserve host traces or change test outcomes.

`Contract.Tests.ps1` includes `Queue.Fairness.Tests.ps1`: newest-first queued
previews versus older in-progress continuations, UTC/numeric ordering, duplicate
status snapshots, undated compatibility, strict profile/capacity skipping and
100-run/job overflow refusal with no pagination. The focused command is
`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File scripts/local-runner/Queue.Fairness.Tests.ps1`.
Pilot binding and pickup-suspension suites also preserve exact-SHA eligibility
and Stop checks around all read-only requests. These mocked checks prove demand
selection; real GitHub job assignment and live installed queue draining need
separate host evidence.

## Certification and provenance

PR jobs check out and assert the exact head SHA. Main jobs report the actual post-merge SHA. The `required` check succeeds only when every mandatory stage succeeds. After it succeeds on main, the separate `Production database ready` job fails closed unless explicitly enabled and fully configured, then checks the pinned project and migration history before and after forward delivery. It is a production Vercel Deployment Check, not a PR branch-protection check. Failure artifacts include reports, traces, resource summaries and regenerated types, never credentials/environment dumps.

Ready means: complete gates, exact-SHA green CI, clean worktree, local/remote HEAD agreement, latest fresh clean Codex review, and zero unresolved actionable threads. Verify a matching preview when configured. Code changes require new affected validation and fresh review.

Infrastructure failures are not passes. Report missing runtime/hosted prerequisites separately.

## Private inventory files proof

The [file contract](inventory-files.md) is checked through real Supabase Storage as well as PostgreSQL. `npm run validate:db` applies the file migration on a clean local stack, runs pgTAP and `tests/integration/files.ts`, and checks authenticated upload/download/delete policies, direct-write denial, versioned attestation, collection revisions, replacement/rename/history, quotas, physical-byte accounting, receipt replay, concurrency and cleanup. Keep the deliberate upload/cancel race and near-20 MiB false-size cases; a SQL-only pass cannot establish the Storage boundary. `npm run test:e2e` provisions a loopback-only per-run HMAC key and exercises the staff file panel with the production Next build. The runner disables the key and shreds its secret on completion; an inert database key-ID tombstone is expected.

Hosted acceptance needs an explicitly authorized, verified isolated preview with its own server-only key and applied bucket/policies, then a real authenticated browser → Storage → validation → publication/download/cleanup check using fictional records. Capture the preview branch and migration revision, authorization denials and any timeout or resource failure. Production key installation and release remain owner prerequisites. Local tests, a passing build or a preview without a working private bucket do not establish hosted file acceptance.

## Inventory Core proof

Focused Vitest suites cover mutation input normalization and stable error mapping, Server Action authorization, read contracts, structured history, partial/Move All confirmation, duplicate serial warnings, preserved retry identity and stale form baselines. Viewer route tests prove mutation controls are absent; PostgreSQL separately enforces authorization.

Inventory pgTAP tests cover RLS, direct-write grants, hardened RPC privileges, ordinary constraints and append-only history. Local integration tests exercise the complete quantity/asset transitions, event deltas, no-change observations, rollback, normalized idempotent replay/conflicts, authorization revocation, duplicate concurrent requests and competing stock moves. Read RPC tests verify literal search, stable location contracts, historical filters and bounded deterministic pagination.

Playwright proves the conventional staff workflows against real local persistence, including multi-location stock, partial/Move All moves, count correction, archive/restore, serialized transitions, duplicate warning, search/location/history, reload persistence, viewer restrictions and stale editing. Keep the existing real Auth workflows. A component mock is not a substitute for database or browser proof.

The opt-in archive-and-clear workflow also needs one-snapshot review, inactive-location balances, explicit confirmation, stale-version rejection, decimal-string totals, one archived event with per-location negative lines, duplicate-request replay, concurrent receive/archive serialization, rollback on line failure, and zero-stock restore/threshold preservation. Keep a positive-stock rejection test for the legacy archive RPC.

## Room proof

See [room navigation](room-navigation.md#validation) for graphics-specific contracts. `npm run test:e2e -- tests/e2e/00-room.spec.ts` forwards focused Playwright arguments while retaining the local backend build. The default `npm run validate` still runs every test. Real WebGL rendering/raycast interaction and forced graphics failure supplement pure and component tests; visual inspection is required for proportions and label readability.

PR5 picker proof includes component search, ordering, eligibility, unavailable
values, keyboard behavior and form baselines, followed by browser create,
move, filter and room workflows. Location-tree coverage includes expand/collapse,
automatic expansion to the selected node, aggregate browse selection, navigation-only
ineligible form ancestors, flat search results with full breadcrumbs, quiet stable codes,
accessible controls and narrow-screen use. Room browser proof exercises pointer/button
orbit horizontally and vertically above and below the room, Guided clamping of both
angles, tilt controls, pole stability and no roll; it also covers mode transitions,
hover-only labels and Show all labels, focus/recenter/fit, selection and history,
context recovery, resize and narrow viewport usability. Capture rendered picker
states and room views from all four sides and above/below at desktop and narrow widths;
inspect clipping, focus, labels and browser console output. Responsive browser
inspection does not establish physical-phone performance.

## Labels, scan, low-stock and CSV proof

Use the PR6 acceptance suite in addition to the general certification above. Database coverage verifies threshold null/zero/boundary and invalid values, all-location totals including inactive-location balances, archive/restore, old callers that omit the field, explicit clearing, concurrency/retry behavior and staff-only writes. Quantity detail validation also checks that authoritative `stockSummary` is separate from metadata/version baselines during refresh and pending threshold edits. Read tests establish that `inventory_search_v2`, `low_stock_dashboard`, and `inventory_export_snapshot` agree on item-wide stock status and preserve caller authorization.

Application and browser checks cover label stability after rename/move, aggregate destinations, invalid/ambiguous identifiers, external and cross-environment payload rejection, safe login return, logged-out navigation, viewer restrictions, manual lookup, and continued relative/prefixed/bare lookup when production origin configuration is absent while absolute URLs and label generation fail closed. Decode generated QR and Code 128 images through an exercised scanner input path; resolver-only tests do not prove decoding. Exercise permission denial/unavailable camera, duplicate frames, stop/unmount cleanup, and manual entry. Inspect desktop and narrow layouts, rendered print output, physical dimensions, quiet zones, long labels, and multi-label page breaks.

`tests/integration/item-code.ts` is part of `npm run validate:db`. It exercises DB Unicode trimming and control/length rejection, case-insensitive uniqueness across archived items, omission versus explicit clear, old-shape receipt replay for legacy/v2/site opening, concurrent creates and duplicate request IDs, and caller-scoped scanner/search/label/export reads. The scan component tests distinguish explicit Item code mode for reserved-looking codes from camera and ordinary same-origin URL parsing; a mocked resolver is not a hosted browser proof.

For the mixed label queue, pgTAP checks record-level quantity deduplication before count/page, zero-stock and historical visibility, searchable identifiers, exact-ID mixed resolution, invoker RLS and anonymous denial. Vitest checks copy/distinct/total limits, session member/environment isolation and logout clearing, quantity QR fallback, preflight refresh, acknowledgement, missing-record blocking, and stale async responses. Browser acceptance should build a mixed quantity/asset/location job, navigate away and back, print a multi-page PDF at the chosen physical size, decode a rendered quantity QR, and verify that changed or unavailable records cannot print. The database and browser gates must run after the new migration is applied locally; static/unit checks alone do not certify those boundaries.

Export tests cover filtered and subtree completeness beyond the visible page, low-stock one-row-per-definition shape with all current holdings and locations even when filters match one holding, zero-stock unlocated rows, literal search characters, empty headers, escaping, formula-like text with leading whitespace/control characters, timestamped filenames, the UTC snapshot timestamp and Environment column, `preview-` filename prefix, the 10,000-row explicit overflow boundary, and viewer download/staff-only write access. A downloaded file should be checked through the real authenticated application path.

Report synthetic-frame or mocked camera evidence separately from real-phone camera use and physical printer output. Automated browser print inspection does not prove actual paper measurements, printer clipping, phone performance, or camera behavior on physical devices; list any such acceptance checks not performed. Preserve the production database readiness gate: local validation and an isolated preview do not prove that production migration automation is active.

## Private Speed Insights proof

Focused tests check the Vercel-only explicit opt-in, exact route and URL allowlist, whole-event rejection for auth/token query or fragment parameters, ordinary search redaction, queued-event rejection after login/token navigation, mismatched/dynamic/auth/scan/download rejection, provider script failure isolation, and location picker DOM ID/keyboard relationships. An official Vercel browser script fixture is executed locally with captured intake bodies to verify the _emitted_ URL and route, including the runtime behavior that retains the original route. The fixture source and SHA-256 are recorded in the test. This proves local payload shaping; it does not prove hosted project activation, Vercel ingestion, paid-tier state, or production traffic. Hosted acceptance requires a verified signed-in preview and the owner-approved Vercel setting, without sending test identifiers from real inventory.

## Configuration acceptance

The print media migration was assigned version `20261011060256` because the original version had not been applied to production or staging, while both hosted histories already contained later migrations. The SQL bytes were preserved exactly.

A307 adds the shared `tests/fixtures/print-media.json` boundary corpus. Vitest validates it; `tests/integration/print-media-configuration.ts`, invoked by the existing configuration integration suite, compares each case against the SQL validator using a real local database. It also checks historical four-field receipts after later custom updates, omitted-versus-null retry conflicts, omitted-layout preservation, no-op/version/event behavior, concurrent duplicate requests, an independent singleton-lock race and membership revocation before replay. `supabase/tests/print_media.test.sql` checks scalar/null/huge-input failure, RLS view and direct-write denial. These database tests require the complete clean local Supabase gate; static review is not a database pass. Generated types must be regenerated and checked against the applied migration before certification.

Focused components cover valid/old/invalid cached media, raw draft retention, explicit recovery, no extra inventory fetch for geometry edits and cancellation of an outstanding final print read. `node --import tsx tests/integration/print-media-pdf.ts` is a bounded standalone Chromium proof using the real LabelSheet and repository Tailwind compilation, with both standard sizes/papers, custom asymmetric margins/gaps, exact single-label pages, row order, complete QR pixel decoding and PDF page counts/dimensions. It does not run Next routing, authenticated authorization, a database or the real printer. Its output lives under ignored `test-results/print-media`. Existing authenticated label E2E and full database gates remain mandatory; actual paper at 100% needs a separate ruler and printed QR/Code 128 decoding check. Future hardware acceptance waits for the owner's real printer/media selection.

`npm run validate:db` now runs `tests/integration/configuration.ts` after pgTAP and the existing integration suites. The configuration suite uses real authenticated Data API clients and independent PostgreSQL connections to test maintainer-only writes, member reads, direct-write denial and no self-escalation; normalized receipts and decimal-string versions; current category labels in exports; archived/retired reassignment; historical-only inventory references requiring a replacement and retained tombstone; hard deletion of truly unused categories, including the last active category; exact impact staleness after a new reference or version change; no partial update after a later-row failure; shared/exclusive catalog races; and fresh isolation rejection with completed replay. It checks that category reassignment adds metadata events without stock lines. Browser acceptance covers phone-width Settings forms, impact review/cancel/confirm, empty-catalog guidance, viewer controls and shared defaults on Print labels. A delayed Data API call must establish that PostgREST hoists the five-second RPC timeout before execution; checking only `pg_proc.proconfig` is insufficient.

## Audit 2 implementation checkpoint

The local `assist/audit-two-operations` implementation checkpoint is `c9eb7a8`. Focused worker-reported regressions passed for navigation (123 tests / 8 suites), custody and scan (167 tests / 22 files), metadata (90 tests plus a 1,547-case Unicode option corpus), authoring (161 tests / 5 suites), labels (78 tests), operational UI (50 tests / 10 files), and files (65 tests); owned lint passed. These are focused local results, not integrated acceptance. Canonical typecheck evidence predates the latest operational UI/files edits. The full typecheck, build, Supabase DB gate, Playwright E2E, final exact-SHA CI and review, and hosted feature flows remain pending. Independent review found three P2 issues in site-terminal compare-and-set, site actor masking and SQL path complexity; those are fixed and bounded rereview is clean. File-confirmation review remains pending. The metadata migration `supabase/migrations/20261007163407_metadata_choice_integrity_presentation.sql` has focused SQL coverage in `supabase/tests/metadata-choice-integrity.test.sql`, `metadata-option-corpus.test.sql`, and `metadata-choice-scale.test.sql`; three targeted SQL tests passed, while the full DB gate has not yet completed. Browser-contract suites for navigation and authoring are not yet executed, and their filenames are intentionally omitted until verified. The initial authenticated preview shell/backend identity check is a baseline only, not feature-flow proof.

## Navigation management proof

`supabase/tests/navigation_management.test.sql` verifies maintainer-only name edits,
legacy structural RPC privilege denial, strict narrow payloads, stale/no-op/replay
semantics, unchanged structural fields/stock/history, rollback on audit failure,
reasoned site lifecycle, legacy metadata compatibility and authorization before old
receipt replay. The canonical custody integration suite adds independent PostgreSQL
connections for duplicate rename serialization and both orderings of site archive
versus quantity issue and serialized transfer. These tests require the real local
Supabase stack; source and component checks alone do not establish the DB boundary.
The custody browser suite uses loopback-only trusted storage fixtures and checks
name-only controls, stable QR/location identity, blocked archive, and discoverable
empty-site archive/restore. Generated database types must be regenerated from the
applied migration and checked through the existing database gate.

## Inventory display and bounded read proof

The authoritative database coverage for these contracts lives in
`supabase/tests/audit_three_contracts.test.sql` and
`tests/integration/audit-three-contracts.ts`. The SQL suite checks public
signatures, execution privileges, continued denial of application structure
mutations, the generated tag key and collision-free canonical reference data.
The integration suite exercises real PostgreSQL calls with member credentials
and independent connections. It observes an actual lock wait before committing
the winning transaction for differently cased tag creation and active sibling
rename races.

Tag coverage includes trimmed display round trips, case-only version/history
changes, exact uncertain retries, changed-intent rejection, retired uniqueness,
authorization before replay and transaction rollback when history insertion
fails. Legacy create/site-open receipts keep their normalized identity; an old
create receipt also replays its original result after a later v3 display
correction. Search, label resolution and export retain display spelling and
permanent asset UUID identity. Exact lookup covers database-normalized Unicode
and literal percent, underscore and backslash characters. Scanner component
coverage retains ordinary QR, location-prefix, asset-tag-prefix and ambiguous
bare-identifier behavior; resolver tests alone do not prove camera decoding or
rendered print output.

Preview coverage verifies active-member authorization, unique bounded request
keys, human field types, recorded choice paths, literal user UUID preservation,
answer limits, UTF-8 and JSON-escape truncation, and continued provenance in the
legacy description API. Entry-count coverage distinguishes positive quantity
holdings from stock units, excludes site/retired inventory, returns known zero
and omits unknown or aggregate codes. Server tests preserve decimal-string
precision, keep missing/error counts unknown and reject mismatched response
identities. Location coverage includes same-parent race rejection, root scope,
different-parent reuse, inactive duplicates and corrective activation.

Run the canonical database gate in its defined order: clean local reset, pgTAP,
then fixture-producing integration suites, followed by generated type comparison.
`scripts/db.mjs` registers the display/read integration suite with the existing
database suites. The older pgTAP assertions depend on pristine reference data;
running them after integration fixtures have published forms or created records
is not an equivalent gate. For a focused rerun requiring that baseline, reset
the disposable local database and run pgTAP before creating fixtures. Preserve
the repository's local-target and Storage-version checks.

The integration suite executes the location migration's actual lock and
preflight SQL, extracted from the checked-in migration with explicit statement
boundaries. It proves ordinary collision-free success, then temporarily removes
the sibling guard and index inside a rollback-isolated trusted local transaction
to arrange an existing active sibling collision. Preflight must refuse with
`P1012` and the colliding codes, leaving names, codes, versions and history
unchanged. A final rollback restores the original rows, history, index definition
and enabled trigger. No deliberately colliding data or guard removal is committed.

This bounded prerequisite regression does not replay the complete forward
migration. Claiming preservation across a full upgrade requires separate
disposable evidence: prepare existing lowercase assets, events and receipts,
apply the migrations and compare retained identities, spellings, history and
receipts. If that fixture includes an active sibling collision, correct it with
an explicit authorized rename before retrying. This must not use hosted
destructive setup. Browser acceptance still needs populated result
summaries, selected-location count reconciliation and actual label/print/export
flows through the authorized application.

## Private-safe titles and missing-resource proof

F307's missing-resource checks require branded fallback titles without private
record names or UUIDs. Authorized successful D304 routes have named titles as
described above; their missing-resource branches retain these privacy checks.
Keep real direct missing-resource document requests (including their HTTP 404
status), anonymous access checks, and client navigation evidence distinct.
Fallback unit regressions hold the membership guard and separately reject login
and inactive-member access before returning protected/inventory bodies or
inventory-specific metadata. The inventory browser journey retains the full
anonymous redirect-body assertion for image-like quantity and asset paths with
a forged document selector. Those actual responses must exclude inventory
fallback identity; mocked guard tests alone do not establish Next serialization.
Proxy matcher regressions also cover formerly excluded public image and internal
asset paths: URL-derived selectors replace forged headers without Auth/cookie
reads or asset cache-policy changes. Protected image-like record paths retain
their claims refresh and private/no-store response. The inventory browser journey
checks anonymous and authenticated generic missing JPEG/SVG responses with forged
inventory headers: HTTP 404, generic fallback identity and no requested UUID.
The scoped compiled fixture reproduced the forged-selector redirect/private
fallback on generic JPEG/SVG URLs before broad normalization, then returned
generic 404s for anonymous and authorized requests afterward. Its real public
SVG retained `public, max-age=0`; its Next chunk retained public immutable caching.
The updated focused boundary batch passed 107 tests in eight files. This fixture
uses simulated membership; final application CI remains the actual Auth/browser
proof.
The scoped installed-Next production fixture reproduced fallback identity in
both login and inactive-member 307 response bodies before the guard, then excluded
body and metadata markers after it. Both builds used one build worker; guarded
browser probes retained public/authenticated 404, one main, zero-document client
recovery, query navigation, native Back/Forward, a formerly missing record becoming
valid and Flight delivery before the delayed read completed. The focused fallback,
layout, admission, session and proxy batch passed 93 tests in eight files; canonical
typechecking and scoped lint/format checks passed. These working-tree checks do
not certify actual application Supabase/browser responses or replace final-SHA
application CI and independent review.
The two retained pristine-site and mapped-location journeys include failure-only
input handoff diagnostics. A 128-entry buffer records allowlisted field identity,
focus/input delivery, value lengths/match booleans, native transition milestones
and matching site-draft write sequences. Raw values, identifiers and action bodies
are excluded. The observer preserves native transition/storage results and errors;
four focused tests cover its bounds, privacy, scoping and restoration. It logs once
on journey failure without extra waits, input retries or altered assertions. This
is diagnostic coverage for the unresolved input-loss flakes, not a proven fix.
The navigation-workflow E2E uses a clearly synthetic navigation-boundary fixture: a real
owned inventory NextLink receives the server's real missing-record RSC response
through a scoped non-prefetch request rewrite. It requires unavailable content,
private-safe metadata, no document fallback, and recovery through an ordinary
NextLink; it records the RSC status and observed title separately. This is not
proof that an existing record was deleted or became inaccessible.

With installed Next.js 16.3.6, that client arrival can retain the successful
static quantity layout title, `Quantity item · IT Inventory`, while page-data
`notFound()` renders the unavailable boundary. Metadata fallback collection
uses an error convention when metadata resolution itself fails; a static
`not-found.tsx` metadata export does not promise its custom title for every
client boundary arrival. Preserve generic private-safe route titles and the
separate document/RSC transport assertions rather than adding duplicate data
queries or client title overrides solely for this distinction.

## Served build identity

Focused tests in `src/features/build-info` cover metadata classification, conflicting
production labels, malformed/missing commits, development fallback and the allowlist.
The Settings route tests retain ordinary member access without configuration privilege;
existing session tests exercise anonymous, inactive, viewer and staff membership.
`tests/e2e/build-info.spec.ts` compares the actual production-build manifest with the
signed-in viewer Settings disclosure, checks anonymous denial, exact time across reload,
keyboard access and 375 px horizontal overflow. Run it through the canonical
`npm run test:e2e -- tests/e2e/build-info.spec.ts` with exclusive local backend ownership.
A unit pass or local build does not prove Vercel metadata, staging synchronization,
production release or hosted visual acceptance. Retain the `.next/required-server-files.json`
allowlisted snapshot plus compiled Settings artifact identity as local build evidence;
never publish the entire environment or manifest containing unrelated configuration.

The dedicated compiled-provenance test in `tests/e2e/build-info.spec.ts` automatically
runs `node --test tests/build-provenance-compiled.test.mjs` against the existing
backend-specific build during canonical `npm run test:e2e` and focused build-info runs.
It uses the current Node executable, a bounded subprocess deadline/output limit and
sanitized status/TAP assertions; nonzero exit or missing regression execution fails
the browser suite. No additional build, package script or workflow is introduced.
Failure diagnostics expose only allowlisted stage/reason tokens, carried over the
existing private child IPC and extracted from bounded TAP output. Arbitrary child
fields, error messages, HTML/Flight bodies, cookies and credentials never enter the
browser assertion label. This distinguishes input/Auth setup, listener setup,
response validation, literal-tree checks and cleanup without dumping private data.
The probe requires the canonical disposable loopback backend and fictional viewer.
It authenticates once with caller credentials, passes the session only over private
IPC, and serves the existing production build on an ephemeral loopback port in two
sequential processes (512 MiB heap and 30 seconds each). Each process checks two real
authorized Settings Flight responses against the saved allowlisted snapshot, with forged
runtime environment before startup and again between requests. Requests to any
other backend are rejected before transport. Both servers close before reporting;
the parent revokes only its own viewer session in cleanup. No second build or
public probe route is introduced. The request uses `RSC: 1` and
`Accept: text/x-component`; the pinned installed Next router helper computes the
matching `_rsc` query parameter from those actual request headers before transport.
Installed Next 16.3.6 validates this parameter even when its expected hash is empty:
omitting `_rsc` supplies null and triggers a 307 before rendering. The focused
regression first reproduced that mismatch, then passed with the canonical request.
Redirects remain refused. This source and regression evidence establishes the
request correction; attribution of the observed CI redirect and confirmation of
the corrected compiled probe still require an actual compiled browser CI rerun.
Status/content type and a 512 KiB raw-stream cap are
checked before parsing only bounded JSON data records. A narrow recognizer finds
the exact static BuildInfo host section and checks its rendered children
and time property. It follows only bounded JSON data and lazy host references,
including own-property paths, within that section; import/debug rows and unrelated
provenance props never supply proof. Missing, cyclic, unsupported or prototype
reference paths fail closed. The recognizer allows at most 1,024 JSON records,
64 traversal/reference-path levels and 20,000 nodes per traversal, rather than
implementing a general Flight decoder. Unsupported length-framed text/binary/typed-array records
fail closed before any line scanning, so their raw payload cannot manufacture
apparent JSON data records. Privacy withholding on SSR HTML remains intact. This
proves compiled server-rendered Flight values; the separate signed-in Settings
browser test remains the hydrated DOM/visual proof. Focused helper tests reject stale fields and
hosted transports; source tests retain the frozen-object contract. The real compiled
HTTP check remains part of canonical browser CI, not a database-free unit claim.
Boundary tests separately exercise delayed worker reload, strict bridge rejection,
typegen/import fallback and fresh build lifetimes.

PR51's integration with main `48b3ca79208d6813bc6dc43c5483194796af28bf`
keeps the Settings build card inside the protected page content gate alongside
the existing motion controls and navigation. The Settings route regression
withholds all three during initial privacy verification, admits one copy of each
after readiness, and masks accepted content after revocation. Earlier branch
test/build results remain historical; this source integration requires fresh
focused checks and complete final-candidate certification. Hosted build identity,
desktop/phone layout and Full/Reduced motion acceptance remain pending.

## Audit 4.2 working controls

U409/U410/N05–N07 focused regressions cover local/system motion precedence, cross-tab and unavailable-storage behavior, a single location action navigation with matching filter/export query, exact-current-location row suppression with child/site disambiguation, compact informative counts, collapsed settings hierarchy and selected/search ancestor reveal, keyboard tree focus, separate linked validation entries and local-only browse/drop selection. Motion helpers assert saved switch state explicitly. `navigation-workflow.spec.ts` prepares 1280, 375 and 390 px Full/Reduced journeys with screenshots, keyboard switch/tree/validation interactions and location action/export query checks; `files.spec.ts` retains actual file selection/upload journeys and checks the selection promise.

The resource-constrained local pass uses fresh `npm ci`, focused tests with `--maxWorkers=1`, strict typecheck, owned lint/format, E2E discovery and complete base diff whitespace checks. Discovery is not browser execution. Build, complete application/database gates, authenticated hosted upload/clipboard/download behavior, actual desktop/phone appearance, focus styling/contrast, and before/after captures remain required at candidate certification. No Docker, reset or hosted writes are performed for this presentation slice.

PR48 review regressions also cover structurally owned branch disclosures in ordinary and searched settings rows, truthful `aria-selected` after return, and an exact-location-only two-column desktop modifier with unchanged child/site and narrow-container layouts. Settings tree regressions assert that the focused roving treeitem itself carries hierarchy, expansion and selection semantics, Enter activates its native anchor once, and descendant Enter does not also activate the row. Prepared browser checks exercise semantic treeitem focus, search disclosure collapse/reopen, pointer/middle/modifier link navigation, modified Enter, selected return and the storage rename journey, alongside populated two-column desktop/one-column 375 px rows. The hosted candidate and real browser proof remain pending; component tests and discovery do not certify those conditions.

The PR48 CI follow-up preserves the hierarchy keyboard contract: after search, Tab enters the ancestor tree row and arrow keys reach the matching location before Enter opens its native link. Component motion hydration coverage checks both saved choices: the standalone server-rendered control is a disabled ordinary button with loading help and no switch role or checked state until the browser state is known. Hydration exposes the same control as an enabled switch with the saved boolean choice, then the first activation flips that choice. Protected Settings instead withholds the control entirely until privacy restoration can complete. Its component regression preserves both saved choices through that gate and verifies the first Space activation. The delayed-script browser regression verifies visible privacy cleanup with no Settings control before scripts are released, then checks the saved choice before first keyboard activation and reload persistence. The shared browser helper waits for an enabled switch before reading its state. Component hydration passes do not substitute for actual browser execution.

Native Ctrl-click, middle-click and modified Enter checks listen for the browser context's new-page event, which also covers browser-managed tabs without an opener. They use the actual link actions and require exactly one added tab, the exact same-origin location destination, an unchanged original page URL and the original page count after closing the new tab. These assertions do not depend on a page-level popup event or use synthetic window creation. The original failed run's opener metadata was unavailable; the corrected event contract still requires fresh CI browser proof.

## P05 vocabulary and support detail checks

Focused receipt/history, category, task, status and export tests cover immutable
snapshots, safe uncertain retries, capitalized status, action-specific success,
record-type help and precision-preserving clipboard details. Browser coverage in
`tests/e2e/audit-four-vocabulary.spec.ts` is ready for populated authorized UI at
desktop and 390 px, including task headings, scan status, history and clipboard.
Local resource limits exclude builds, Docker resets and full browser execution;
E2E discovery alone is not visual or hosted acceptance.

The P05 review batch includes low-stock readable CSV labels with machine-column
compatibility tests for both export branches and custom-field modes. Shared browser
custody controls assert the specific committed operation, including transfer and
quantity write-off, and category browser helpers check the actual category name.
These focused/static checks do not replace the pending database/browser runtime gate.

## Audit 4.2 room interaction evidence

Focused occupancy tests cover exact decimal counts above the JS safe-integer limit, signed-bigint bounds, actor/origin/public-backend/request identity, off/on and A→B→A deferred responses, cleanup cancellation, and five/eight-second application deadlines. The additive pgTAP suite covers leaf zero/unknown semantics, products/units/assets, site/retirement exclusions, caller membership/grants, bounded requests and compatibility with the legacy entry read. SQL timeout configuration is not elapsed-time REST proof.

Room tests cover opaque occlusion and exposed transformed face samples, shared placement and mandatory 44px markers, selected long text, passive/active wheel ownership, pointer cancellation, Escape focus and pristine initial framing. Pure dimensions and mocked DOM rectangles are supplementary capacity evidence only. The real room feature spec creates one journaled owned quantity definition across all 28 existing modeled holding leaves through canonical loopback-only RPCs and clears it through normal audited archive cleanup. It compares authoritative triples and exercises the 375px populated map with More open, without changing existing labels or seeds. Do not run its writes against a hosted backend.

The test-only visibility witness captures the actual committed R3F scene once per settled scenario and independently checks transformed triangles, material sides, opaque blockers and DOM overlay masks. Actual BoxGeometry capture regressions distinguish a single material across all groups from indexed material arrays. Transparent mapped coverage is supported only for verified unsigned-byte RGBA DataTexture resources, with exact dimensions/data length and a cumulative 262,144-texel/1 MiB byte bound. Uniformly nonopaque alpha excludes the actual contact footprint; uniformly opaque alpha retains furniture. Mixed alpha, custom mipmaps, alpha maps/tests or unsupported resources fail explicitly rather than hiding an uncertain blocker. This is bounded representative visibility evidence, not exhaustive pixel or physical-phone proof. Mounted camera regressions defer commands through zero/nonfinite canvas measurement and execute the newest command once; registry regressions retain pending state through centered full/compact CSS remeasurement, preserve focused neighbors and fail explicitly after four unstable synchronous passes.

Acceptance still requires real WebGL at 375px with the actual canvas, loaded fonts, selected long text and open More; independent exposed-object coverage, no overlapping/shrunk actions, accurate authorized triples, actual camera/input/focus response, resize and settled demand-idle evidence. Long-label component/DOM stress cannot replace current-geometry browser proof. Run the clean database gate and authentic type regeneration, then the complete exact-candidate gates and independent reviews described above; unavailable Docker/browser execution is an explicit limitation, never a pass.

Room projection and the independent witness exclude known `LineSegments2` decorative strokes: their raw positions are shader extrusion templates, not opaque world triangles. A regression uses the installed line geometry with disabled edge picking to demonstrate false occlusion and preserves ordinary opaque mesh occlusion.

Opt-in room diagnostics emit `ROOM_GEOMETRY_REPLAY` only after a failed target assertion. The complete supported opaque scene includes camera matrices, canvas/masks, canonical location codes and numeric source-mesh identities/topology, never inventory text. Replay records contain ordered 12-KiB base64 chunks of gzip JSON and a SHA-256 of the uncompressed JSON; join parts, decode, decompress and verify the hash before replay. The existing 25,000-triangle/5,000-object/8-MiB capture bounds remain; replay transport is capped at 96 KiB and shares a 128-KiB failure-report budget. Missing, invalid or oversized captures explicitly report incomplete/truncated evidence rather than exporting a partial scene. Capture occurs after failure, so it does not prove atomic identity with the original event.

## Logout-generation privacy barrier

Focused Auth tests cover retained HttpOnly generation creation only after confirmed
local sign-out, read-only exact-generation comparison, stale login/confirmation
submission, first storage read failure before tombstone creation followed by module
reload, independent tab acknowledgement, newer-generation restarts, invalid/absent
markers, acknowledgement write/readback failures, cleanup-only retries, stable
password action ownership through refreshed session props, protected restoration
withholding and reactivation without losing unchanged editable state.
Deferred-read regressions additionally cover query-only navigation, changed known
server generation/action revision, newly mounted bootstrap under an internally
updating retained route slot, and unchanged field node/value/focus/selection
preservation during harmless checks. Revocation coverage includes failed cleanup
masking before erasure, late old verification, original-binding server checks,
other-actor denial, explicit retry and separate fresh-owner admission. A bounded
failed-cleanup regression checks that callback invalidation caused by the check
itself does not create an automatic retry loop. These are authored contracts;
report the actual focused test outcome separately from their presence in source.
Assignment, label and scope-guard fixtures verify that pending readiness defers
storage restoration and actor rebinding while the Auth logout observer remains
subscribed; unchanged reactivation never restarts hydrated workspaces.
`tests/e2e/logout-privacy.spec.ts` authors real Next logout/reload and two-tab
same-actor protected-entry checks using synthetic per-tab recovery, plus ordinary
logout, login through its resulting form and a second logout in the same tab
without navigation, reload, cookie replacement or forced input. The existing
foundation password test exercises cookie-driven password Flight completion.
These tests require the approved local E2E environment and must be reported as
unrun until executed; unit fixtures do not prove delivered browser headers,
cross-tab Auth broadcast timing or actual Next Flight behavior.

Scan component regressions exercise attempted logout during a deferred mutation:
the exact command survives, the old result is ignored even after original-binding
readmission, and only explicit retry dispatches the same command. A different actor
cannot retry that retained owner. Designer identity-request interception matches
the business action's actor payload rather than every server-action POST; DOM
erasure assertions wait for the designer's terminal access denial. Browser/database
execution remains required for actual request serialization, receipt atomicity,
fresh same-tab authentication and native focus across canonical query binding.

Run the focused skip-link browser regression without a backend or Next build:
`node node_modules/@playwright/test/cli.js test --config tests/browser/skip-link.config.ts`.
It requires installed Chromium and compiles the actual application stylesheet
through PostCSS/Tailwind. A representative retained cleanup panel precedes the
positioned protected shell; desktop and phone cases verify ordinary Retry clicks,
unfocused link hit testing, and native Tab/Enter access to main. The same tests
remain included in the normal E2E suite. This source-CSS geometry fixture does not
mount the Auth controller or prove cross-tab authorization/readmission; the full
`navigation-workflow.spec.ts` recovery scenario and approved local Auth E2E gate
remain required.

## Protected page content gates

The held D303.2/W09 route foundation now nests readiness markers inside each
resolved page content gate. The populated room page deliberately relies on the
workspace marker after its selected-location contents resolve, rather than
acknowledging its outer server shell. `room/page.test.tsx` preserves that exception.
The layout route slot stays rendered through the provider while privacy checks run.

`route-privacy-integration.test.tsx` mounts the real protected privacy controller,
route provider and content gates with deferred action responses. It checks initial
closure, original-binding grant/recheck/recovery, unchanged field node/value/focus/
selection and business busy ownership, synchronous revocation before native
cancellation, stale callbacks and actor drift, terminal action denial/logout/Auth
closure, sibling insertion races and old-provider retirement. Existing route tests
retain hash Back, overlapping request, refresh and Activity readiness coverage.
These are local component contracts; native snapshot timing, real Flight/HTTP
status, browser Back/WebGL, actual logout broadcast and visual motion acceptance
still require the canonical runtime gates on the final committed candidate.

Protected server pages resolve existing authorization/read/validation decisions
before returning gated private content. The shared controller and all layout
providers must keep the opaque route slot rendered, without an ancestor Suspense
or accepted-content gate. No resource preflight, duplicate query or extra logout
generation read is needed. Keep every success, empty and access-denied return
gated when adding or changing a page.

`auth-privacy.test.tsx` exercises the actual retained route-slot/content-gate
pattern with deferred initial checks, query changes, known generation/action
changes, focus reactivation, newly mounted consumers and retained field nodes.
`privacy-content.test.tsx` proves that pending server rendering never mounts a
private bootstrap consumer. `tests/unit/protected-page-gates.test.ts` additionally
checks every JSX return branch of every protected server page, including future
pages. This structural guard supplements runtime proof; it does not establish
HTTP status, database authorization, delivered Flight or visual acceptance.

Direct record documents additionally await membership and the existing
request-cached caller read before the shell. Their shared protected layout
resolves to `DocumentAdmission`, which throws a generic missing result only
during document SSR, above every shell/Suspense boundary. Throwing from the
shared server layout instead caches a rejected layout node: a recovery Link can
commit its URL, title and successful Flight while the old root 404 body remains.
Browser rendering always delegates missing/auth decisions to the destination
page; the initial document flag cannot suppress later valid records or reset
retained shell state. Invalid site opening kinds use the same document flag;
authorization redirects and read failures still propagate normally.

The DB-free installed-Next production fixture reproduced that stale body, then
verified document 404 (including encoded identifiers/trailing slash), hydrated
missing UI, query-only missing navigation, visible Link recovery with zero
documents, native Back/Forward, and a formerly missing record becoming valid
after another page-owned 404. A denied fixture read redirected before shell
rendering, and Flight headers arrived before the delayed page read completed.
These framework checks do not establish real Supabase authorization or hosted
application acceptance. The inventory E2E requires a visible Inventory heading
and search control inside its matching primary, one main, and removal of the
missing heading in addition to URL/title/404 and inventory zero-document checks.
The fixture also observed that `router.refresh()` at the same missing URL does
not reset Next's root HTTP fallback; this change does not fix that separate
framework behavior, and the missing UI offers destination recovery links.

The scoped production fixture used installed Next.js 16.3.6/React 19.2.8, a
delayed async `notFound()`, the actual privacy components and PageArrival, and
private shell/body probes that throw if mounted before readiness. The old
route-omitting boundary returned HTTP 200 even without Suspense. The structural
page-gate pattern returned HTTP 404 for the missing page and HTTP 200 for the
successful page without mounting those private probes. This is DB-free local
transport evidence, not full-application or hosted browser acceptance. Preserve
the real direct missing-resource document assertions in the inventory/navigation-workflow E2E, and
run the complete application/browser gates for the final change. Inspect desktop
and phone-width layout after the gates release; unit visibility checks alone do
not establish that new wrappers preserve the rendered layout.

Current mapping below is relative to `src/app/(protected)/`. “Missing” identifies
pages with existing `notFound()` decisions; other routes retain their original
redirect, empty and access-denied branches.

| Server page                            | Content-gated return branches | Missing |
| -------------------------------------- | ----------------------------: | ------- |
| `dashboard/page.tsx`                   |                             1 |         |
| `history/page.tsx`                     |                             3 | Yes     |
| `history/events/[kind]/[id]/page.tsx`  |                             1 | Yes     |
| `inventory/page.tsx`                   |                             1 |         |
| `inventory/assets/new/page.tsx`        |                             3 |         |
| `inventory/assets/[id]/page.tsx`       |                             1 | Yes     |
| `inventory/quantity/new/page.tsx`      |                             3 |         |
| `inventory/quantity/[id]/page.tsx`     |                             1 | Yes     |
| `labels/page.tsx`                      |                             2 |         |
| `locations/page.tsx`                   |                             1 |         |
| `locations/[code]/page.tsx`            |                             1 | Yes     |
| `room/page.tsx`                        |                             2 |         |
| `scan/page.tsx`                        |                             1 |         |
| `settings/page.tsx`                    |                             1 |         |
| `settings/categories/page.tsx`         |                             1 |         |
| `settings/forms/page.tsx`              |                             1 |         |
| `settings/forms/[categoryId]/page.tsx` |                             1 | Yes     |
| `settings/labels/page.tsx`             |                             1 |         |
| `settings/locations/page.tsx`          |                             1 |         |
| `settings/locations/[code]/page.tsx`   |                             1 | Yes     |
| `settings/sites/page.tsx`              |                             1 |         |
| `settings/sites/[code]/page.tsx`       |                             1 | Yes     |
| `sites/page.tsx`                       |                             1 |         |
| `sites/[code]/page.tsx`                |                             1 | Yes     |
| `sites/[code]/open/[kind]/page.tsx`    |                             3 | Yes     |

## PR44 / PR47 local Auth diagnostic consolidation

The merged fixture invokes `scripts/local-auth-templates.mjs` once after the
replacement Auth container is healthy, through the existing `verifyTemplates`
injection contract. Its canonical verifier validates local Auth/Kong ownership,
loopback bindings, database identity/port, exact invite/recovery URLs and checked-in
file bytes, then fetches bounded HTTP bodies from inside Auth under one shared
readiness deadline. Redirects are rejected. The duplicate PR47 Docker-exec template
codec/probe is superseded; no application Auth flow or provider setting changes.

The retained failure-to-coverage mapping is in
`tests/local-auth-password-policy.test.mjs`:

| Previous PR47 check                                                 | Canonical retained check                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact invite/recovery bytes, network and non-TTY bounded retrieval  | Actual canonical files/all phases; owned service validation; fixed HTTP requests pinned to local Docker with buffer/time limits and no redirect following.                                                                                                                                          |
| Missing, duplicate or wrong template URLs                           | Owned service configuration rejects missing, duplicate and wrong URLs before any fetch; loopback/database/project/network guards remain.                                                                                                                                                            |
| Framing/body bounds and malformed output                            | Canonical HTTP parser rejects malformed status/header, truncated length, encoded and oversized responses; CLI buffers/timeouts replace the unused multiplexed exec codec.                                                                                                                           |
| Wrong bytes, unverified completion and secret redaction             | Bounded content mismatch/transport/probe-client categories; success requires validated complete HTTP 200, exact body length and exact checked-in bytes.                                                                                                                                             |
| Final HTTP status and forged header values                          | Canonical status parser preserves only validated status; dedicated forged-header regression; redirects are rejected rather than followed.                                                                                                                                                           |
| Temporary readiness, attempt/shared deadline                        | Transient listener readiness; exact deadline prevents another fetch; shrinking/subsecond command budgets and late-success rejection cover both templates under the canonical 30-second maximum. The superseded probe's implementation-specific three-attempt/20-second rules are not a second gate. |
| Absolute Docker timeout, byte limit and sanitized response failures | Original real-socket lifecycle transport regression retains trickle timeout, output overflow, HTTP error and invalid JSON redaction.                                                                                                                                                                |
| Failed preflight prevents email test/run and restores container     | Existing injected template-failure restoration plus an actual canonical content-mismatch regression prove one preflight invocation, no run, owned replacement removal and exact original container restoration. Existing original-error aggregation cases remain.                                   |

Earlier checks at PR47 head `23dcd8c2022ec61908912cfe4f44e8b37be5f8e5`
and PR44/main `43351451aff5c3d4441ff211060ae680574a3f77` remain historical.
This mapping documents source retention; it does not establish a new combined-tree
pass or actual Docker/email/browser acceptance. Report fresh focused checks separately.

A304 retirement component regressions exercise each editable preset in storage and
site retirement, manual text/optional-note preservation across refresh, exact
review/payload parity, note edits invalidating review, blank or overlong combined
reason rejection and identical unknown-outcome replay. A309 checks visible launcher
help and accessible descriptions before selecting quantity storage/site and asset
location/site corrections. These checks do not replace browser or persisted-history
acceptance on the final candidate.

### PR52 combined print-media local verification

The combined source retains existing privacy cleanup and private document-title ownership. New Copies drafts and media state reset with the established authoritative queue cleanup; final-read/readiness epochs are cancelled on cleanup and unmount. The focused print batch passes 187 tests in seven files; six affected privacy/assignment/configuration/rendering siblings pass another 80 tests. Both batches use one worker and a 768 MiB heap. Scoped zero-warning lint and formatting pass. The actual Next browser regression in `logout-privacy.spec.ts` is authored but unexecuted here: it exercises real privacy-action failure, cross-tab server logout, same-owner recovery and unchanged mounted edit draft/record version. Its late safe-head mutation is synthetic and does not certify Next streaming-head timing. Generated-type additions remain provisional. No local database, PDF browser, full E2E, build or complete certification gate was executed for this integration.

The owned label-defaults fixture forwards only known privacy-read argument shapes before validating mutation intent. A later capture error still settles an earlier validated Save with its original request identity and restores its exact owned version through CAS before reporting the error; an invalid initial command never writes, and concurrent state changes block restoration. Custody and CP3 lifecycle journeys explicitly choose job-local 90 × 50 mm, Letter, QR media. Shared-default inheritance, measured overflow, Code 128 fallback acknowledgement and final print-readiness coverage remain separate and retained. The focused fixture/label batch passes 217 tests in seven suites with one worker and a 768 MiB heap; affected E2E files pass discovery only.

Hosted inspection of preview HEAD `979f174e2ba1e7680dd2e6966753d7cb0d0d7863` found an owned representative asset ready to print at 90 × 50 mm/QR, actual text overflow at 70 × 35 mm, and a ready 90 × 50 mm/Code 128 label whose QR fallback still required acknowledgement. These observations qualify the media diagnosis; they do not prove the amended E2E journeys or establish the exact cause of historical CI failures. Full CI and final-candidate browser/database certification remain pending.

## PR48 integration with PR47 main

The local merge of `e84cbff7` keeps the main feature-spec consolidation. PR48's
mapped-storage rename treeitem focus/native-link and grouped Location actions
assertions move to `locations-reference.spec.ts`. Its hierarchy-search level,
treeitem selection and non-tabbable nested-link assertions move to `custody.spec.ts`;
`inventory.spec.ts` retains the independent search picker journey. The two legacy
Audit 3 files remain removed. `navigation-workflow.spec.ts` retains both PR48's
motion hydration/viewport journeys and main's synthetic private-safe RSC boundary
journey. Focused tests and discovery are iteration evidence; browser, database,
complete committed-SHA gates and fresh remote review remain separate acceptance.

### PR52 integration of merged PR48

The combined candidate retains PR48's location action toolbar, selected-ancestor
settings tree and motion/designer controls together with PR52's generic server
metadata, caller-scoped cached page reads and mounted private-title ownership.
Conflict resolution preserves the full 76-row acceptance matrix, named D304
browser-title assertions, both PRs' feature-spec consolidation and the retirement
and print-media regression mapping. Focused location/tree, inventory presentation,
metadata/title/privacy and working-control checks provide local integration
evidence only. Earlier PR48 CI/review remains bound to `d2c6222`; the new combined
commit requires its own canonical CI, fresh review and hosted acceptance.

### Independent logout transport local verification

Ordinary logout and cleanup-generation comparison use the dedicated same-origin
POST transport so a held navigation cannot queue either acknowledgement. The
initial auth/proxy batch passed 202 tests in eight files; affected auth, password,
layout, scan, designer and label component siblings pass another 370 tests in
nine files. Both use one worker and a 768 MiB heap. Scoped zero-warning lint and
formatting pass. Route regressions cover mandatory exact request-origin admission,
missing/null/multiple/path/forged origins, fetch metadata, strict JSON shapes,
actual chunked UTF-8 byte limits, non-POST denial, retained caller-cookie receipts,
sanitized failure/uncertainty and read-only cookie comparison. Proxy tests prove
that these exact endpoints perform no pre-admission claims refresh/cookie writes,
while neighboring routes retain refresh. Client and recovery tests cover bounded
timeout/response validation, UNKNOWN recovery retention, verified designer cleanup
after the original owner is gone, blocked erasure/readback and cleanup-only retry.
The subsequent loopback-origin and receipt-ordering batch passes 265 tests in
seven files with one worker and a 768 MiB heap. Real installed NextRequest tests
prove loopback normalization, exact supported direct-Host restoration and rejection
of malformed, alternate, cross-host, cross-scheme and cross-port authorities.
A component regression proves that a privacy alert can precede the logout receipt
without authorizing cleanup; the reload browser test now awaits the actual receipt
and matching cookie before its retained recovery assertions.

The held-History logout browser regression now requires both independent HTTP
acknowledgements, with the same verified generation, to complete before History
Flight is released; its late delivery must leave login in place. This authored
browser assertion has separate candidate-specific evidence. Actual loopback
invitation/recovery completion and the amended first-read-failure/reload journey
remain pending browser verification on the new candidate. These focused working-tree results
do not certify real browser cookie delivery, local/hosted request-origin routing,
database behavior, the full production build/E2E gate, or final committed-SHA
remote checks and fresh review. Root integration owns those remaining boundaries.

## Native capture interactivity and focus

The focused native fixture in `transition-capture.spec.ts` bundles the installed
Next React runtime and real capture boundary without a database. It reproduces
dropped controlled input without the guard, checks guarded input/selection,
domain-disabled controls, destination layout-effect focus and outside focus/pointer
cancellation, and distinguishes
capture release from animation completion. The fixture imports the compiler
provided transitively by the existing locked toolchain; no dependency was added.
Default Playwright discovery must retain this spec. This isolated fixture does
not certify actual application routes, production-server navigation, authorized
data, real form drafts or the complete local Supabase/browser gate.

Consumer regressions hold the public capture observer through pending DOM updates
and prove deferred focus, superseding task/picker state, unmount and account-change
cancellation. Guard regressions prove native-call/error identity and release of
later subscribers after an earlier callback throws, with sanitized reporting.
Boundary tests distinguish native capture blur from outside focus followed by blur,
outside nonfocusable pointer input and history cancellation. jsdom's disabled-input
blur is explicitly modeled; actual application native-browser focus remains a separate gate.
The broad consumer map covers Scan and assignment, task return/discard focus,
pickers, settings rename, file dialogs, inventory completion, metadata review and
designer entry/placement, and the room toolbar. Immediate pointer/keyboard handlers
retain their existing semantics because capture interactivity blocks their targets.

On the 2026-10-13 working tree, the focused consumer/sibling batch passed 673 tests
in 17 suites, and the room/navigation/camera batch passed 122 tests in eight suites.
Both used one Vitest worker and a 768 MiB heap. Canonical typechecking passed at
1536 MiB, and scoped zero-warning lint and formatting passed. The five isolated
Chromium capture tests passed using ignored
`.local-tools/pr54-capture.playwright.config.ts` with one worker and no application
web server, database or build; canonical default discovery retained all five.
These results precede the final integration commit and do not certify the complete
application/database/browser gate or exact committed-SHA remote checks.

## Locations retained drafts and native-ready regressions

Locations browser regressions distinguish retained local drafts from fresh URL
write admission. An original mounted owner with a previously fresh privacy grant
may edit its visible draft during a same-authority recheck; one coalesced unsent
revision survives older server replies and writes only after fresh admission.
Actual withdrawal, grant/provider drift, unmount or accepted departure discards
queued writes. Accepted departure stays latched until real mount/Activity
reactivation; native cancellation only discards queued work and preserves current
controls. Hook/controller tests cover these boundaries without granting readiness.
The native-ready E2E helper registers one binding per page and validates each real
running snapshot animation independently, including repeated arming and closure.
Its bounded Chromium smoke proves two actual transitions on one page; full
application journeys and exact-SHA hosted acceptance remain separate gates.

## Room Back camera retention with the configured router

Cache Components is not enabled in this app. Installed Next 16.3.6 defaults it
to false; its layout router adds Activity retention only under that flag and
otherwise keeps one active entry. A stable ancestor alone therefore cannot
preserve a page-local camera map across Room → Inventory → Back.

The actual workspace unmount/remount regression first failed with null initial
view instead of the saved pose. The protected-layout camera provider uses a
bounded, per-key external store with independent actor/backend/privacy-grant
ownership. Store/provider/workspace tests prove exact restoration input,
cloning/bounds, stale callback retirement, ordinary visible rechecks and scoped
publication without rerendering unrelated consumers. They use a mocked renderer,
so actual native Back camera equality, explicit focus precedence and canvas
ancestor exclusion still require the retained real WebGL/browser gate. No
application-wide Cache Components switch or global camera cache is introduced.

The working-tree sibling batch passed 81 tests across ten files with one worker
and a 768 MiB heap, including the actual CameraRig initial-frame policy, legacy
room workspace, protected room page/layout and privacy content. Canonical
typechecking passed with a 1536 MiB heap; scoped zero-warning lint, formatting
and diff whitespace checks passed. Independent architecture review found no
actionable source issue. These are local working-tree results based on
`43874f64`, not committed-SHA CI or native browser acceptance.

## Pinned room-effects lifetime validation

Fresh `npm ci` must execute `scripts/patch-postprocessing.mjs` and verify the
exact pinned `@react-three/postprocessing` 3.1.3 upstream-to-patched hashes in
`patches/react-three-postprocessing-3.1.3/manifest.json`. Do not substitute a
local ignored wrapper or disable postinstall to pass certification. Reapplying
already-patched bytes is a verification operation; unknown versions, bytes,
payloads or output hashes must fail before changing any other target.

Canonical Vitest discovery includes `tests/unit/patch-postprocessing.test.mjs`
and `src/features/room/scene/patched-postprocessing.test.tsx`. The installer
regressions cover upstream installation, idempotence and refusal of unknown
versions/bytes/payloads. The actual installed-package suite instruments lower
GPU constructors while running the shipped patched exports and actual app
SceneBloom/SceneEffectsProvider, including StrictMode/Activity fresh-store
reconnect, retirement before passive allocation, retained frames before resize,
setup rollback and bounded idle invalidation. These are lifecycle proofs, not
real GPU or shader-performance evidence. Existing bloom/contact runtime tests
remain responsible for raw-render color/state restoration, FBO/shader failures,
contact cache invalidation and partial overlay/capture rollback.

Effects layout cleanup irreversibly disposes its captured store. Descendant
caster layout registration and light callback refs must reconnect against one
fresh context generation after StrictMode/Activity setup, without remounting the
provider or reviving old callbacks. Appearance preference tests include external
storage changes while every subscriber is unmounted and retention of a genuine
failed-write fallback. Successful writes must not leave a volatile override that
masks later persisted changes.

Prepared-image `npm ci --ignore-scripts` populates verified npm tarballs only;
actual repository CI runs fresh `npm ci` with this postinstall. Refresh only the
approved derived package/lock/input/bundle artifacts through Write-Bundle after
package input changes. This patch requires no runner code, permission, installed
bundle or VM change. Real WebGL, both-theme/phone/Full/Reduced visual acceptance,
reference-hardware frame costs and the final exact-SHA remote gates remain required.

## A306/A310 serial identification integration

The following records PR55 iteration coverage and local limitations before final
acceptance. Its pending-gate statements are historical; the accepted final-candidate
CI and hosted evidence are recorded in the [PR55 acceptance checkpoint](audit-4-2-acceptance.md#pr55-a306a310-acceptance-checkpoint).

Serial-mode regressions cover literal colon/prefix/URL serials, caller denial,
Unicode bounds, contextual duplicates/overflow and unchanged automatic URL guards.
Both entry points cover deliberate camera/manual serial lookup, old camera frame
retirement and assignment mode preservation after a failed durable reset. The
browser identifier-guidance journey adds a persisted `SN:` serial at desktop/phone
widths in Full/Reduced motion; report its execution separately from unit coverage.

Focused resolver/parser/chooser/assignment and tag-advisory regressions cover exact spelling, Unicode lengths, legal duplicates, cross-namespace collisions, typed-prefix isolation, unknowns, errors, overflow and retained cancellation/privacy guards. `supabase/tests/serial_scan.test.sql` adds transactional fixtures for stable invoker/empty-search-path grants, active viewer/staff reads, nonmember/inactive/anonymous denial, exact case/whitespace lookup, 200 supplementary Unicode characters, deterministic first21 results, truthful site/retired context and nonmutating reads. The migration and provisional generated-type addition require canonical clean-database execution and `db:types:check`; they have not been validated against local PostgreSQL here because its Docker daemon is unavailable.

`tests/e2e/audit-four-identifier-guidance.spec.ts` retains owned new fixtures for duplicate serials, serial/tag/SKU collisions, tag blur guidance and a synthetic camera QR frame. Scan and tag-blur cases are defined at 1280/390 px with Full/Reduced motion. A separate 390 px Reduced-motion Scan-and-assign journey enters a duplicate serial through the real input, requires a named/contextual chooser, deliberately selects the intended asset, checks the review's immutable record link and storage source, then cancels with **Skip inspection / review**. Caller-scoped reads compare both assets, their versions and their inventory/assignment events before choice, after inspection and after cancellation to prove that no assignment was made. These are durable test definitions; browser/hosted execution and physical-camera testing remain pending. SQL timeout configuration likewise requires effective REST hoisting and elapsed-time proof before it establishes any request-time bound. This is iteration evidence, not final PR certification.

## Visible regional captures and CI repair coverage

The regional native fixture now imports the actual RouteMotionProvider,
PageArrival, RouteReady and InventoryCaptureRegion/Slot path with the production
presentation lifetime and CSS registry. It explicitly arms a controlled fixture
transition; only external Next routing hooks and Auth subscription use adapters.
It proves native capture traversal, not full Link/RSC/Auth navigation. The prior
unmatched React header remains a negative witness of the renderer limitation.
All five header enter/exit cases and actual authored body paired, incoming-only
and outgoing-only viewport cases passed in Chromium, together with that negative
witness (nine tests, one worker, 512 MiB heap, no application server/database).

The actual CI 390 by 480 Back capture had a header ending below y606 and its
first body starting at y626. The source body was offscreen; the visible incoming
list body lacked a snapshot name. The body now uses the same authored capture
registration as other regions. Browser acceptance checks each visible authored
root's exact name, old/new opacity endpoints and overlap with the shared title;
a regression rejects title/header-only evidence when the incoming body is visible.
Desktop captures with visible bodies on both sides still require the paired body
crossfade, and the 200 ms effects/250 ms presentation bound is unchanged.

Controller/shared-clock tests cover single-sided fades sharing the title/body
clock, ownership expiry and unsupported-clock withdrawal. Picker regressions
cover graphics failure followed by keyboard selection of an unmodeled logical
candidate and explicit confirmation. Page-order regressions keep Tasks before
supporting metadata while retaining all metadata and preview content. The full
application Back/anchor journey, phone geometry, actual context loss with the
retained quantity draft, complete validation and exact-SHA CI remain integration
gates; the focused native fixture does not certify them.
