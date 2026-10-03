# Navigation and workflow milestone acceptance

Source requirement: `IT_Inventory_Goal_Navigation_and_Workflow_Fixes.md` supplied by
the owner. This checklist records incomplete work as incomplete; it is not a
certification report.

Baseline: `b8bc0d2437d0204dd09c79ae1b69334540a2a62e` (released feature baseline,
before this milestone). A separate detached baseline worktree preserves that
revision for production-build comparisons. The latest committed application
checkpoint is `c97133b3a177209b9a236eaea42f05a43220a964` (source tree
`1c67559b80ba73f9e4df8823f29cf54c197d4a1b`). Candidate branch:
`assist/navigation-workflow-fixes`. No production changes are authorized.

| Requirement                                  | Required proof                                                                                                                                                                                | Current evidence                                                                                                                                                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Add field placement and section selection | Desktop, scrolled/arrival-transform opening, 390px, 200% zoom and short viewport; native focus/Escape/return; staged cancellation, targeting, drag/resize and undo                            | Hosted `886` proof covers actual page arrival and coordinate click during the stretched transform, with nonidentity matrices before/after; modal geometry/focus proof is recorded below. Required functional proof is complete; final preview smoke is pending. |
| 2. Category form navigation                  | Lightweight references and selected-only form read; route/heading/save/recovery agreement; A/B/A, Back/Forward, dirty and pending addition, failed loading, late responses and in-flight save | Hosted `886` checks cover category A/B/A, Back/Forward, invalid pending DST retention, category next-edit, metadata own-save/disjoint/overlap/exact-unknown replay. Required functional proof is complete; final preview smoke is pending.                      |
| 3. Site archive and restore                  | Discoverable maintainer action, reason and holdings links; independent-connection assignment/archive races; stale/duplicate/permission denial; identity/history retained                      | Hosted occupied-site archive denial, normal return, and assignment/archive race (one valid winner, then return/restore) passed; viewer/staff UI and RPC denials passed. Domain fixture cleanup is complete; temporary actors remain.                            |
| 4. Metadata reconciliation                   | Own-save baseline, untouched refresh, disjoint/converged/overlapping edits, dependency groups, second race, uncertain exact replay and explicit clears/legacy values                          | Hosted own-save, category next-edit, disjoint/overlapping edits and exact unknown replay passed. Required functional proof is complete; final preview smoke is pending.                                                                                         |
| 5. Code-managed location structure           | Name-only audited CAS RPC; old structural RPC denial; privileged fixture path; existing placeholders, hierarchy, balances, QR codes and history retained; live names in room/picker/details   | Hosted rename preserved UUID, code, structure and all 30 owned balances; original 1A was restored. Viewer/staff UI and RPC writes were denied; maintainer legacy structural RPC was revoked. Domain fixture cleanup is complete.                                |
| 6. First-visit navigation                    | Matched baseline/candidate matrix for all routes below; normal visuals, authenticated production builds, empty/populated fixtures, direct/unvisited/repeat paths and raw provenance           | Local `c97133b` comparison and hosted `886` matched matrices are complete. Detailed report and raw artifacts are linked below; final preview smoke is pending.                                                                                                  |
| 7. Ticket wording and motion preference      | Text values and API/export keys preserved; Settings control for active viewers/staff; persisted preference, OS precedence, camera/ambient/print behavior                                      | Hosted `886` viewer/staff Motion preference, modal desktop/narrow/short/native-200% behavior, and category selector/history cases are recorded below; remaining preview smoke is pending.                                                                       |

All 25 required hosted functional checks and controlled active-transform proof
passed. Domain fixture cleanup is complete: 30 quantity records are archived at
zero stock, 30 assets are retired, eight sites are archived, original 1A is
restored, history is retained, and active owned inventory/site records are zero.
Three temporary actors remain until final documentation-SHA preview smoke, then
they will be deactivated. Their account cleanup is not yet claimed. The final
documentation commit and its exact-SHA CI, review, preview smoke and actor final
state remain pending; see the final gates below.

## Performance comparison contract

Measure Overview, Inventory, Scan, Labels, Spaces, Locations, Properties/sites,
History, Settings, and category-form switching. Record click-to-feedback and
click-to-usable-content separately, request/TTFB information, transferred JS and
payload bytes, hydration/render work and long tasks. Never sum overlapping stage
medians. Record commit, build mode, backend, fixture density, motion state, browser,
cache conditions, sample count, raw evidence paths and medians/ranges.

Fresh browser context, unvisited route, repeat visit and warm backend are distinct
conditions. Claim a cold function only with actual evidence. Preserve normal
visuals; no scripted warm-up tour, polling, public private-data cache or blanket
up-front loading. Missing Speed Insights field data must be stated separately
from reproducible browser/server evidence.

## Final gates

- Fresh dependency installation and repository canonical full validation.
- Additive migration reset, generated type comparison, RLS/RPC and real
  independent-connection concurrency checks.
- Actual desktop/narrow/zoom browser interactions and inspected visual evidence.
- Matched navigation baseline/candidate results and unresolved bottlenecks.
- Signed-in isolated hosted staff/viewer/maintainer proof; exact preview SHA and
  backend identity checked before fictional fixture writes.
- Fixture cleanup through supported lifecycle paths; preserved accounting history.
- Independent integrity/security review and fresh remote Codex review.
- One unmerged PR targeting main, exact-final-SHA required checks green, zero
  unresolved actionable threads, clean matching local/remote HEAD.

## Environment evidence

Initial candidate `npm ci` passed with Node 24.19.0 and npm 11.11.0. The Windows
Docker API pipe was unavailable and ports 54321/54322 had no listeners. No local
database or real Auth/browser proof has been obtained from that observation.
Do not waive those gates; use the configured disposable Linux validation path or
a subsequently verified local runtime. No administrator prompt is assumed to be
available overnight.

Subsequent runtime diagnosis found Rancher Desktop stopped. Starting it in the
background with modal dialogs disabled succeeded without elevation. Docker
29.5.3 responded and reported no running containers. The disposable local stack
was later used for the database gate recorded below; the early runtime observation
alone was not a test pass.

Speed Insights dashboard inspected read-only on 2026-10-02 (America/Chicago), with the displayed
last-seven-days window (Sep 26–Oct 3). Production/Desktop showed RES 77 based on
three events, all under `/login`; individual FCP/LCP/INP/CLS/TTFB values were shown
as unavailable. Production/Mobile and Preview/Desktop showed no events. This
field-data sample does not measure the requested authenticated application-route
latencies and cannot establish their cause or improvement. No paid feature was
enabled. Browser/server measurements remain required.

## Earlier implementation checkpoints (historical, not certification)

Metadata reconciliation passed 78 focused tests across five suites, the application
typecheck, and focused lint/format checks on the working-tree candidate. The real
independent-connection integration tests and independent integrity source review
subsequently passed. Browser proof and hosted proof remain pending.

Site/location management passed 39 focused component/contract tests and the
application typecheck. A further 25-test focused run covers live space names and
management behavior; these counts overlap and must not be added as unique tests.
The additive migration, actual generated types and concurrency tests subsequently
passed the database gate described below.

Designer navigation, field inputs, motion placement and ticket wording passed
153 focused tests across nine files. Additional uncertain-save recovery work is
implemented and included in the application gate below; browser proof remains
pending, so these source checks are not final certification of the designer slice.

Independent Astra source review found one management-form retry defect: an
authorization failure after an uncertain submission could discard the original
receipt without establishing its outcome. No confirmed metadata reconciliation defect was
reported. The retry defect was fixed, passed 18 focused tests, and was closed by
independent source re-review. This does not replace database execution or remote
Codex review of the final committed revision.

The clean candidate migration reset succeeded and actual database types were
regenerated. The first database gate passed 529 pgTAP assertions across nine files,
foundation integration, 163 inventory RPC assertions, 48 low-stock checks, and the
configuration suite. It then stopped in the new metadata concurrency fixture:
the fixture omitted a required protected asset-tag control. After correcting that
fixture, the focused real metadata suite and complete `npm run validate:db`
passed, including a fresh clean reset, all 529 pgTAP assertions, all integration
suites, custody/site races, file completion (78 checks), real Storage (276
assertions), and the generated-types comparison. Logs remain under ignored
`test-results/navigation-db/`. These are working-tree source results, not yet
exact-final-commit certification.

Fresh `npm ci` passed on the working-tree candidate using Node 24.19.0 and npm
11.11.0: 603 packages installed and 604 audited. npm reported five high-severity
audit findings; no dependency inputs were changed. Complete `npm run validate:app`
passed typecheck, zero-warning lint, formatting, 93 Vitest files with 912 tests,
127 preview-access tests, seven staging-user-sync tests, four local-Storage
tests, bounded export-memory checks, 27 real file-inspection cases, browser test
discovery (109 tests in 19 files), and the production Next build. Compilation
took 5.4 seconds and build TypeScript took 6.9 seconds. The build used the CI
unreachable Supabase placeholders and does not establish runtime browser proof.
Logs are retained under ignored `test-results/navigation-app/`. The acceptance
document required a mechanical formatting correction before the successful gate.
The subsequent harness-only changes are checked separately with the six-test
`test:performance:contract`, targeted lint/format and syntax checks; the unchanged
application tests and build evidence are reused. The canonical application
sequence now includes that contract suite before export-memory checks.

The local Supabase security advisor (`--local --type security --level warn
--fail-on error`) passed with `No issues found`, independently verified by the
lead in `test-results/navigation-db/security-advisors.log`. This local result
does not establish hosted security controls or replace remote Codex review.

Frozen-baseline evidence and the complete matched local matrix are in
`docs/performance/navigation/`. The matrix compares the frozen baseline with
committed `c97133b` across empty and populated fixtures, 180 route observations
overall and six room samples. The fresh manifest records BUILD_ID
`rxD8jPbyfi-TV4L69xpYQ`; raw artifacts and the [comparison](performance/navigation/comparison-c97133b.md)
retain all mixed and slower results. Labels used one search over 18 visits, with
349 ms repeat median versus 354 ms baseline. Room timing changed from 572 to
430 ms. Local timings do not reproduce the reported multi-second hosted delay.

## Latest source, browser and review evidence

The local Supabase gate passed against the unchanged schema: 529 pgTAP assertions,
all integration suites, real Storage (276 checks), generated-type comparison and
the security advisor. `npm run validate:app` passed on `c97133b`: 927 Vitest tests
across 94 files, preview access (127), staging sync (7), local Storage (4),
performance contracts (8), export-memory checks, real file inspection (27),
browser-test discovery (111 tests in 19 files) and production build, exit code 0.

The Labels correction introduced at `8864459` waits for hydrated session filters,
scopes work to the workspace, actor and origin, and cancels obsolete requests. It
passed 49 focused tests across five suites, typecheck, lint and formatting;
independent Astra source review was clean. A separate Designer category accessible-name fix passed 66
component tests. The local unfiltered 111-test E2E run first completed with 103
passes and eight failures tied to obsolete expectations or test locators. Seven
test files were revised. Focused navigation (4) and visual (7) tests passed; an
independent Sol source review closed the audit-event-uniqueness and delayed-
navigation-barrier findings. The final `npm run test:e2e` run passed all 111 tests
across 19 files in 10.1 minutes with exit code 0 and a fresh production build. The
run log is `test-results/navigation-browser/full-e2e-final.log`. Seven frozen E2E
digests and 260 application source/configuration/asset hashes remained unchanged
through the run. It ran against application HEAD
`88644591c2e756a37e3db4ffb1a0a59075e22808` and source tree
`1c67559b80ba73f9e4df8823f29cf54c197d4a1b`. Those exact test contents are now
committed at `c97133b`, but the earlier E2E run is not relabeled as having run on
that commit.

The local modal tests did not establish active-transform opening behavior because
locator stability waits on that transform. Hosted `886` proof subsequently
established actual page arrival at 230 ms, stretched the transform to 30 seconds,
and used a real coordinate click while confirming nonidentity transform matrices
before and after the click. The modal was centered within 1440×900 bounds at
160,16 to 1120,868, with focus, Escape and focus return verified.

The matched local post-loading-boundary-removal matrix at `5c6e0b4` is retained in
[its comparison](performance/navigation/comparison-5c6e0b4.md). The initial
`51ed5b4` candidate remains a rejected tradeoff because it improved feedback while
regressing usable content on several routes. The `5c6e0b4` measurements showed that
the broad-fallback regression was removed; the completed `c97133b` remeasurement
is linked above.

Hosted `5c6e0b4` draft proof includes viewer/staff Motion preference persistence,
keyboard operation and OS precedence; dialog geometry, focus, Escape and focus
return at 1440×900, 390×480, 1440×330 and native 200% zoom; and an eight-option
top selector exercised A/B/A, Back/Forward, and invalid pending daylight-saving
time while retaining Date, Time and zone values. No hosted domain writes were made
before timing. For native zoom, the actual CDP surface image was visually inspected;
the ordinary Playwright screenshot was blank and was not treated as evidence.

The hosted report is complete: [summary](performance/navigation/hosted-8864459.md),
[route metrics](performance/navigation/hosted-8864459-metrics.json), [functional
checks](performance/navigation/hosted-8864459-functional.json), and [cleanup
record](performance/navigation/hosted-8864459-cleanup.json). It records 360 matched
route records and 12 actual selector actions across all nine routes, empty and
populated fixtures, and three first/repeat/deep-link samples. Mixed and slower
results remain visible in the report. All 25 required functional checks passed,
including metadata own-save, category next-edit, disjoint/overlapping edits, exact
unknown replay, site archive/restore and stale settings. Viewer/staff Motion
preference and modal checks passed at desktop, narrow, short and native 200% zoom;
category A/B/A and Back/Forward with invalid pending DST preserved Date/Time/zone
values. The location/custody/permission batch passed: name-only rename preserved
UUID, code, structure and 30 owned balances, with original 1A restored; viewer/staff
UI and RPC writes were denied and the maintainer legacy structural RPC was revoked;
`TKT-0000123` was stored once; occupied-site archive was blocked; normal return
worked; and the assignment/archive race had one valid winner followed by
return/restore. Controlled active-transform proof passed. Browser discovery and the
passing local E2E run remain distinct evidence from the hosted checks.

Hosted empty-route click/usable timings remain valid, but its finished-only request
observer omitted some streaming requests, so request counts are incomplete. The
raw capture is preserved. Populated captures used the corrected observer for
started, finished and outstanding requests.

The remote P1 concerned recovery after authorization denial during an uncertain
Designer save. `5c6e0b4` masks the UI while retaining the exact actor/category/
environment-scoped command; the freshly authorized original actor can recover and
replay it. Independent Astra source review was clean. The root posted the evidence
reply (4172926029) on original thread `PRRT_kwDOUOtXZs6ols47` and resolved it.

Native zoom was verified through a disposable Chromium extension using the official
Tabs API after two unsuccessful worker preference-based probes. `getZoom` was 2;
DPR changed from 1 to 2, CSS viewport from 1418×802 to 709×401, while visual
viewport scale remained 1 and computed CSS zoom remained 1. The actual surface was
captured through CDP and visually inspected; the blank Playwright screenshot was
not accepted. See the [Chromium Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom)
and [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).

Foundation CI run `37117250606` passed on `c97133b`. Fresh Codex review of that SHA
completed clean at 2026-10-03 10:48:25 UTC (comment 5968435201); the evidence reply
and original P1 resolution are recorded above. On documentation SHA
`77b6f17801982fda6dec961048c27870c3be449a`, Codex review was clean (comment
5968729005), the unresolved-thread query returned zero, and strict preview smoke
passed. Its CI failed as described below, so acceptance of the test-repair SHA
remains pending.

The documentation SHA `77b6f17801982fda6dec961048c27870c3be449a` CI run
`37119474308` reported 110 E2E passes and one E2E failure, caused by failed
database job `111192640079`. The timeout was in the initial explicit-focus
identity probe waiting for `requestfinished`: the
Flight response was 200 with the expected actor payload, while stream receipt
remained unfinished after the UI had completed. This does not establish a product
defect. The test-only repair removes response-finish/body barriers and the
browser-level overclaim while retaining failed/delayed transport, dirty-input,
save and database-readback coverage. Metadata component coverage now defers both
fetch and identity completion and checks that stale completion does not navigate
or replace the original dirty, editable category-A form before save. A mutation
removing only the success epoch guard fails the `router.push` assertion; the
application source was restored byte-for-byte. The independently reviewed test
blobs are E2E `eea8a9c7c86750efe8cd755784f2f3e91de1a315` and RTL
`ed1ae217190134f1865698c6b40c9be47d07d66e`. On this test-repair working tree,
focused `CI=true` Preview E2E passed 5/5 with zero retries, metadata components
passed 66/66, full Vitest passed 927 tests across 94 files, and build, typecheck,
lint and format checks passed. Logs are under ignored `test-results/navigation-ci-77b6/`.
These results do not replace final exact-SHA CI.

Foundation CI run `37123054097` on `bf82d6ae9e3c16b944e93139715bc32d765a098f`
passed its application and database jobs. Codex then reported a P2
(`PRRT_kwDOUOtXZs6onmYo`, comment `4173192474`) for date/time draft restoration
when the add-field dialog remounts. Passing the current `datetimeDraft` as
`initialDateTimeDraft` fixes the stale-value path. Three component regressions
fail with the old prop and pass with the fix; reverting the fix makes all three
fail again. The independent Sol review was clean (source blob
`1326f7ac42c2406f4da0a4193e13de3c6cb431e5`, test blob
`04b391520ed7987b97495f2db8f0dcf6b6fd6c09`). On the fix working tree,
`npm run validate:app` passed: 930 tests across 94 files, typecheck, zero-warning
lint, format, auxiliary gates, discovery of 111 E2E tests and production build
(BUILD_ID `1vMGhOyxXjOAsxjrWlo8y`). This app gate does not include a database or
browser E2E rerun for the one-prop fix. Final exact-SHA CI, review, preview and
hosted cleanup remain pending.

The owned stack cleanup completed: `npm run db:stop` and `rdctl` shutdown exited
successfully, Docker has zero containers, and both Rancher WSL distributions are
stopped. Ports 3000, 54321 and 54322 have no listeners. Domain fixture cleanup is
complete; the three hosted actors remain retained pending new-SHA verification
and final cleanup. Runner health could not be verified without administrator
access. Final fix-SHA CI, review, thread status and actor final state will
be recorded in the PR28 final evidence comment, not by recursively committing
post-commit facts to this ledger. This does not claim zero unresolved issues or
final acceptance.
