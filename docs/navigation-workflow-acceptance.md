# Navigation and workflow milestone acceptance

Source requirement: `IT_Inventory_Goal_Navigation_and_Workflow_Fixes.md` supplied by
the owner. This checklist records incomplete work as incomplete; it is not a
certification report.

Baseline: `b8bc0d2437d0204dd09c79ae1b69334540a2a62e` (released feature baseline,
before this milestone). A separate detached baseline worktree preserves that
revision for production-build comparisons. Candidate branch:
`assist/navigation-workflow-fixes`. No production changes are authorized.

| Requirement                                  | Required proof                                                                                                                                                                                | Current evidence                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1. Add field placement and section selection | Desktop, scrolled/arrival-transform opening, 390px, 200% zoom and short viewport; native focus/Escape/return; staged cancellation, targeting, drag/resize and undo                            | Source and focused checks complete; browser proof pending                                                    |
| 2. Category form navigation                  | Lightweight references and selected-only form read; route/heading/save/recovery agreement; A/B/A, Back/Forward, dirty and pending addition, failed loading, late responses and in-flight save | Source and focused checks complete; browser proof pending                                                    |
| 3. Site archive and restore                  | Discoverable maintainer action, reason and holdings links; independent-connection assignment/archive races; stale/duplicate/permission denial; identity/history retained                      | Source, focused checks, DB gate and independent source review passed; browser proof pending                  |
| 4. Metadata reconciliation                   | Own-save baseline, untouched refresh, disjoint/converged/overlapping edits, dependency groups, second race, uncertain exact replay and explicit clears/legacy values                          | Source, focused checks, DB gate and independent integrity source review passed; browser proof pending        |
| 5. Code-managed location structure           | Name-only audited CAS RPC; old structural RPC denial; privileged fixture path; existing placeholders, hierarchy, balances, QR codes and history retained; live names in room/picker/details   | Source, focused checks, DB gate, generated types and independent source review passed; browser proof pending |
| 6. First-visit navigation                    | Matched baseline/candidate matrix for all routes below; normal visuals, authenticated production builds, empty/populated fixtures, direct/unvisited/repeat paths and raw provenance           | Baseline measured; source and focused checks complete; candidate and hosted comparison pending               |
| 7. Ticket wording and motion preference      | Text values and API/export keys preserved; Settings control for active viewers/staff; persisted preference, OS precedence, camera/ambient/print behavior                                      | Source and focused checks complete; browser proof pending                                                    |

All rows remain pending hosted acceptance and exact-final-SHA certification.

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
29.5.3 responded and reported no running containers. The performance worker owns
the disposable local stack and baseline production build first; candidate database
validation follows that baseline. Runtime availability alone is not a test pass.

Speed Insights dashboard inspected read-only on 2026-10-02 (America/Chicago), with the displayed
last-seven-days window (Sep 26–Oct 3). Production/Desktop showed RES 77 based on
three events, all under `/login`; individual FCP/LCP/INP/CLS/TTFB values were shown
as unavailable. Production/Mobile and Preview/Desktop showed no events. This
field-data sample does not measure the requested authenticated application-route
latencies and cannot establish their cause or improvement. No paid feature was
enabled. Browser/server measurements remain required.

## Implementation checkpoints (not certification)

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

Frozen-baseline navigation evidence is in `docs/performance/navigation/`: empty
and populated datasets each contain 90 measurements, with separate room-handler
samples and redacted fetch traces. The populated room handler made four Auth
checks, four membership reads and two location reads, with a 572 ms median.
Candidate source optimizations passed 28 focused tests; measured candidate and
hosted comparisons remain pending. Local route timings do not reproduce the
reported multi-second hosted delay.

## Review and performance correction checkpoint

Commit `5c6e0b48cfd5d10eed6110d4ac821be483897913` fixes the remote Codex P1
about an uncertain form save losing its original command after authorization
denial. Automatic access loss now masks the editor while retaining the exact
actor/category/environment-scoped request. A freshly authorized original actor
can recover and replay it, including when only page memory is available.
Explicit signout warns before removing unknown-outcome recovery. Independent
Astra source review found no remaining actionable integrity finding in this fix.

The broader application run exposed a new regression test clicking Retry before
React's transition enabled it. Its timeout DOM and button-disable contract support
that timing explanation; the original flake was not directly reproduced. The
test now waits for an enabled control and proves the second request dispatched,
retaining every masking and exact-replay assertion. Two consecutive full Vitest
runs passed 922 tests across 94 files. Typecheck, lint and formatting passed.
The remaining canonical application gates passed on `5c6e0b4`: preview access
(127), staging sync (7), local Storage (4), performance contracts (8), bounded
export memory, real file inspection (27), browser discovery (109 tests/19 files),
and production build. Browser discovery is not browser execution.

The first measured candidate (`51ed5b4`) made navigation feedback faster but
regressed usable-content timing on several routes. Its immutable raw results and
route comparison remain in the performance evidence directory. The broad protected
loading boundary was removed in `5c6e0b4`; its replacement measurements remain
pending. Immediate navigation feedback, intent-based prefetch and ordinary motion
are retained. The room endpoint improved from a 572 ms populated baseline median
to 424 ms in the first candidate, with Auth/membership/location reads reduced from
4/4/2 to 1/1/1. This narrower improvement does not cancel the route regression.

Hosted baseline empty measurements contain 90 observations against a dedicated
preview built from all 417 byte-verified baseline source files. This deployment
has no Git association and uses only PR28's isolated Supabase child. All 17
inventory/site/history/file tables remained empty. Three run-owned temporary
actors passed actual hosted login and Inventory reads; the standing preview
account is untouched. Candidate, populated, functional and cleanup evidence are
still pending. Provider configuration binding is distinguished from compiled-byte
inspection; actual login/read proof supplements the verified branch environment.

For the required browser zoom check, the lead performed a bounded specialist
diagnosis after two unsuccessful preference-based probes. A disposable Chromium
extension using the official Tabs API established native page zoom: `getZoom=2`,
device-pixel ratio 1 to 2, CSS viewport 1418x802 to 709x401, and visual-viewport
scale remaining 1. No user profile or CSS/device-scale substitute was used.
The hosted designer subsequently passed actual dialog geometry, focus and visual
inspection at native 200% zoom on `5c6e0b4`. Playwright's default screenshot path
returned a blank image at that zoom; raw CDP surface capture returned the actual
1418x802 image, with a legible centered dialog and visible fixed header/footer and
actions. Browser zoom remained 2, DPR 2 and visual-viewport scale 1; computed CSS
zoom was 1 and relevant opacity/visibility were normal. The blank screenshot was
not accepted as proof and required no application change. The lead also inspected
hosted dialog screenshots at 1440x900, 390x480 and 1440x330, confirming viewport
bounds, readable controls and accessible actions. Other hosted functional checks
and fixture cleanup remain pending.
References: [Chromium Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom)
and [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).
