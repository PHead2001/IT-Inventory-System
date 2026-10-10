# Validation

Checkpoint scope/accessibility regression coverage includes normalized location status/export links, caller-scoped record identity and unavailable history recovery, page-local versus full-row counts, empty inventory/destination states, page recovery, monitoring coverage, intact location codes and hidden/unmodeled/failed map guidance. Focused Vitest tests prove these contracts and stale-response handling; `scope-accessibility.spec.ts` exercises ordinary controls, real authorized reads and downloaded CSV across page boundaries. Required-input and category-focus interaction coverage lives in `scope-accessibility-forms.spec.ts`. Mocked reads are not integrated runtime or complete assistive-technology proof; use the existing disposable-local and isolated-preview gates for final acceptance.

Dedicated first-use acceptance runs on the disposable local backend: run `npm run db:reset`, then `npm run test:e2e -- --config tests/acceptance/checkpoint2.config.ts` before other data-creating tests. Authenticated precondition reads require zero quantity definitions, serialized assets and sites; a nonempty catalog or failed read fails the test rather than skipping it. The ordinary CI and full-validation gates remain unchanged.

The metadata database gate includes `supabase/tests/metadata.test.sql` and `tests/integration/metadata.ts`. It proves publication validation, direct-write denial, value evolution, draft UUID/version/published-pointer ABA rejection, and independent-connection item creation/update versus publication plus category removal/reassignment versus publication in both serial orders. It also checks that two export reads in one SQL statement retain the same inventory and category snapshot when another connection commits between them, while the next statement sees the commit. Export limits also require a real authenticated Data API download and hosted PostgREST timeout evidence before release; unit tests alone do not establish those bounds.

`npm run test:export:memory` runs without a database in an isolated Node process. It streams a 1,924,608-byte UTF-8 snapshot in 32 KiB chunks through the raw response reader, JSON parser and CSV encoder, and checks the 2 MiB raw and 3 MiB CSV limits, including the exact raw boundary and an oversized response. It samples heap plus external memory and RSS at reader and encoder checkpoints, adding the retained source fixture bytes to the incremental estimate. On the 2026-09-24 local run, the accepted 2,115,801-byte CSV used 31.7 MiB sampled incremental heap plus external memory and took 55.5 ms; a separate CSV expansion case threw before response at 38.7 MiB sampled incremental memory. These are observed checkpoint maxima in an isolated process, not a continuous transient peak or hosted Vercel measurement. The script enforces a 64 MiB sampled incremental bound and ten-second local processing bound; hosted end-to-end memory and timeout proof remains a separate gate.

For isolated hosted export proof, set the **server-only** `EXPORT_DIAGNOSTICS_ENABLED=true` on a Vercel preview deployment (`VERCEL_ENV=preview`) and redeploy that preview. No diagnostic log or response header is emitted in production or without both conditions. With an authenticated preview member, download a narrowly filtered CSV, a near-limit custom-field CSV, and a deliberately over-limit export through `/api/exports/inventory`. Record the HTTP status, `X-Inventory-Export-Error` on failures, complete file byte length on success, and `X-Inventory-Export-Diagnostic-Id`; match that random ID to the single structured server log. The log contains only raw response bytes, CSV bytes, elapsed stage times and sampled heap-plus-external/RSS deltas. Memory is sampled after each bounded response chunk and CSV row; the fixed stage keys retain only their latest elapsed time and the maximum sampled deltas, never a per-row log or value. Do not place inventory values, filters, user identifiers or tokens in proof notes. Turn the opt-in off after the preview check. A hosted 413/503 must have no CSV attachment header or partial file. Sampling at code checkpoints does not prove a continuous memory peak or isolate other requests sharing the process; use a platform per-invocation peak metric or external profiler before claiming a strict hosted 64 MiB peak.

package.json is the canonical command source. Iterate cheaply; certify the final candidate completely.

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

Focused commands such as `npm run test:e2e -- tests/e2e/room.spec.ts` use the original single `chromium` project without dependency expansion. Any explicit Playwright arguments select this ordinary mode, including a full serial comparison with `npm run test:e2e -- --workers=1`. For discovery alone, `E2E_FULL_SUITE=1 npm run test:e2e:list` lists the scheduled partition; omit that environment flag for ordinary discovery. The scheduling regression checks compare the actual full discovered test identities in both modes, reject duplicates, verify project placement and preserve focused room selection. They run in `npm run test`.

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

See [room navigation](room-navigation.md#validation) for graphics-specific contracts. `npm run test:e2e -- tests/e2e/room.spec.ts` forwards focused Playwright arguments while retaining the local backend build. The default `npm run validate` still runs every test. Real WebGL rendering/raycast interaction and forced graphics failure supplement pure and component tests; visual inspection is required for proportions and label readability.

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

F307 checks branded route-kind titles without private record names or UUIDs.
Keep real direct missing-resource document requests (including their HTTP 404
status), anonymous access checks, and client navigation evidence distinct.
The interface E2E uses a clearly synthetic navigation-boundary fixture: a real
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

The scoped production fixture used installed Next.js 16.3.6/React 19.2.8, a
delayed async `notFound()`, the actual privacy components and PageArrival, and
private shell/body probes that throw if mounted before readiness. The old
route-omitting boundary returned HTTP 200 even without Suspense. The structural
page-gate pattern returned HTTP 404 for the missing page and HTTP 200 for the
successful page without mounting those private probes. This is DB-free local
transport evidence, not full-application or hosted browser acceptance. Preserve
the real direct missing-resource document assertions in the interface E2E, and
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
