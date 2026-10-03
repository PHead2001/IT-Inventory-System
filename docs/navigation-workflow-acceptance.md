# Navigation and workflow milestone acceptance

Source requirement: `IT_Inventory_Goal_Navigation_and_Workflow_Fixes.md` supplied by
the owner. This checklist records incomplete work as incomplete; it is not a
certification report.

Baseline: `b8bc0d2437d0204dd09c79ae1b69334540a2a62e` (released feature baseline,
before this milestone). A separate detached baseline worktree preserves that
revision for production-build comparisons. The latest committed application
checkpoint is `88644591c2e756a37e3db4ffb1a0a59075e22808` (source tree
`1c67559b80ba73f9e4df8823f29cf54c197d4a1b`). Candidate branch:
`assist/navigation-workflow-fixes`. No production changes are authorized.

| Requirement                                  | Required proof                                                                                                                                                                                | Current evidence                                                                                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Add field placement and section selection | Desktop, scrolled/arrival-transform opening, 390px, 200% zoom and short viewport; native focus/Escape/return; staged cancellation, targeting, drag/resize and undo                            | Hosted `5c6e0b4` draft proof covers dialog geometry, focus/Escape/return at 1440×900, 390×480, 1440×330 and native 200% zoom. Active-transform opening, remaining designer interactions and final-SHA browser proof are pending. |
| 2. Category form navigation                  | Lightweight references and selected-only form read; route/heading/save/recovery agreement; A/B/A, Back/Forward, dirty and pending addition, failed loading, late responses and in-flight save | Source/focused checks and selected hosted selector/history cases are recorded below; full navigation-state matrix and final-SHA browser proof remain pending.                                                                    |
| 3. Site archive and restore                  | Discoverable maintainer action, reason and holdings links; independent-connection assignment/archive races; stale/duplicate/permission denial; identity/history retained                      | Source, focused checks, DB gate and independent source review passed; hosted persisted workflow and cleanup proof remain pending.                                                                                                |
| 4. Metadata reconciliation                   | Own-save baseline, untouched refresh, disjoint/converged/overlapping edits, dependency groups, second race, uncertain exact replay and explicit clears/legacy values                          | Source, focused checks, DB gate and independent integrity source review passed; hosted persisted workflow and cleanup proof remain pending.                                                                                      |
| 5. Code-managed location structure           | Name-only audited CAS RPC; old structural RPC denial; privileged fixture path; existing placeholders, hierarchy, balances, QR codes and history retained; live names in room/picker/details   | Source, focused checks, DB gate, generated types and independent source review passed; hosted persisted workflow and cleanup proof remain pending.                                                                               |
| 6. First-visit navigation                    | Matched baseline/candidate matrix for all routes below; normal visuals, authenticated production builds, empty/populated fixtures, direct/unvisited/repeat paths and raw provenance           | Matched local `5c6e0b4` matrix and hosted `886` empty-route observations are recorded below; hosted populated matrix and final Labels remeasurement remain pending.                                                              |
| 7. Ticket wording and motion preference      | Text values and API/export keys preserved; Settings control for active viewers/staff; persisted preference, OS precedence, camera/ambient/print behavior                                      | Source/focused checks and hosted viewer/staff preference, persistence, keyboard and OS-precedence proof on `5c6e0b4` are recorded below; final-SHA and remaining behavior proof are pending.                                     |

These are partial evidence records, not acceptance. Hosted functional matrices,
fixture cleanup and exact-final-SHA certification remain pending; see the row
details and final gates below.

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
committed `5c6e0b4` across empty and populated fixtures, 90 route observations per
dataset, with separate room-handler samples and redacted fetch traces. The latest
Labels hydration/scope fix is committed at `8864459`; its final remeasurement is
pending. Local timings do not reproduce the reported multi-second hosted delay.

## Latest source, browser and review evidence

The local Supabase gate passed against the unchanged schema: 529 pgTAP assertions,
all integration suites, real Storage (276 checks), generated-type comparison and
the security advisor. The full application gate passed on `5c6e0b4`: two Vitest
runs (922 tests each), preview access (127), staging sync (7), local Storage (4),
performance contracts (8), export-memory checks, real file inspection (27),
browser-test discovery (109 tests in 19 files) and production build. These results
are source-revision-specific and do not certify `8864459` or the final working
tree.

The `8864459` Labels correction waits for hydrated session filters, scopes work to
the workspace, actor and origin, and cancels obsolete requests. It passed 49 focused
tests across five suites, typecheck, lint and formatting; independent Astra source
review was clean. A separate Designer category accessible-name fix passed 66
component tests. The local unfiltered 111-test E2E run first completed with 103
passes and eight failures tied to obsolete expectations or test locators. Seven
test files were revised. Focused navigation (4) and visual (7) tests passed; an
independent Sol source review closed the audit-event-uniqueness and delayed-
navigation-barrier findings. The final `npm run test:e2e` run passed all 111 tests
across 19 files in 10.1 minutes with exit code 0 and a fresh production build. The
run log is `test-results/navigation-browser/full-e2e-final.log`. Seven frozen E2E
digests and 260 application source/configuration/asset hashes remained unchanged
through the run. Evidence is for application HEAD
`88644591c2e756a37e3db4ffb1a0a59075e22808` and source tree
`1c67559b80ba73f9e4df8823f29cf54c197d4a1b`; test changes remain in the working
tree until the root commits them.

The local modal tests do not establish active-transform opening behavior: locator
stability waits on that transform. Separate hosted proof of active-transform
opening remains required.

The matched local post-loading-boundary-removal matrix is complete at `5c6e0b4`;
results are in [the comparison](performance/navigation/comparison-5c6e0b4.md).
It records both datasets, all route conditions, room-content requests and remaining
Labels repeat/deep-link slowdown. The initial `51ed5b4` candidate remains a rejected
tradeoff because it improved feedback while regressing usable content on several
routes. The `5c6e0b4` measurements show that broad-fallback regression was removed.
The subsequent `8864459` Labels correction still needs its own committed-revision
remeasurement.

Hosted `5c6e0b4` draft proof includes viewer/staff Motion preference persistence,
keyboard operation and OS precedence; dialog geometry, focus, Escape and focus
return at 1440×900, 390×480, 1440×330 and native 200% zoom; and an eight-option
top selector exercised A/B/A, Back/Forward, and invalid pending daylight-saving
time while retaining Date, Time and zone values. No hosted domain writes were made
before timing. For native zoom, the actual CDP surface image was visually inspected;
the ordinary Playwright screenshot was blank and was not treated as evidence.

Hosted `8864459` empty-route observations are complete (90 observations) and
include the actual selector exercised three times A/B/A across six records. Hosted
populated matrices, persisted functional workflows and fixture cleanup remain
pending. These are draft preview observations, not final-SHA acceptance. Browser
discovery and the passing local E2E run do not substitute for the remaining hosted
proof.

The hosted empty-route click/usable timings remain valid, but its finished-only
request observer omitted some streaming requests, so request counts are incomplete.
The raw capture is preserved. Populated captures used the corrected observer for
started, finished and outstanding requests.

The remote P1 concerns recovery after authorization denial during an uncertain
Designer save. `5c6e0b4` masks the UI while retaining the exact actor/category/
environment-scoped command; the freshly authorized original actor can recover and
replay it. Independent Astra source review was clean. The remote thread remains
unresolved pending exact-CI evidence and an evidence reply.

Native zoom was verified through a disposable Chromium extension using the official
Tabs API after two unsuccessful worker preference-based probes. `getZoom` was 2;
DPR changed from 1 to 2, CSS viewport from 1418×802 to 709×401, while visual
viewport scale remained 1 and computed CSS zoom remained 1. The actual surface was
captured through CDP and visually inspected; the blank Playwright screenshot was
not accepted. See the [Chromium Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom)
and [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).

Fresh Codex review completed at 2026-10-03 10:10 UTC with no new findings. The older
CI is pending, the worktree contains test changes, and the final SHA is not yet
known. The exact-final-SHA, clean-worktree and zero-unresolved-thread gates remain
open; this ledger does not report the code ready.
