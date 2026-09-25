# Validation

The metadata database gate includes `supabase/tests/metadata.test.sql` and `tests/integration/metadata.ts`. It proves publication validation, direct-write denial, value evolution, draft UUID/version/published-pointer ABA rejection, and independent-connection item creation/update versus publication plus category removal/reassignment versus publication in both serial orders. It also checks that two export reads in one SQL statement retain the same inventory and category snapshot when another connection commits between them, while the next statement sees the commit. Export limits also require a real authenticated Data API download and hosted PostgREST timeout evidence before release; unit tests alone do not establish those bounds.

`npm run test:export:memory` runs without a database in an isolated Node process. It streams a 1,924,608-byte UTF-8 snapshot in 32 KiB chunks through the raw response reader, JSON parser and CSV encoder, and checks the 2 MiB raw and 3 MiB CSV limits, including the exact raw boundary and an oversized response. It samples heap plus external memory and RSS at reader and encoder checkpoints, adding the retained source fixture bytes to the incremental estimate. On the 2026-09-24 local run, the accepted 2,115,801-byte CSV used 31.7 MiB sampled incremental heap plus external memory and took 55.5 ms; a separate CSV expansion case threw before response at 38.7 MiB sampled incremental memory. These are observed checkpoint maxima in an isolated process, not a continuous transient peak or hosted Vercel measurement. The script enforces a 64 MiB sampled incremental bound and ten-second local processing bound; hosted end-to-end memory and timeout proof remains a separate gate.

For isolated hosted export proof, set the **server-only** `EXPORT_DIAGNOSTICS_ENABLED=true` on a Vercel preview deployment (`VERCEL_ENV=preview`) and redeploy that preview. No diagnostic log or response header is emitted in production or without both conditions. With an authenticated preview member, download a narrowly filtered CSV, a near-limit custom-field CSV, and a deliberately over-limit export through `/api/exports/inventory`. Record the HTTP status, `X-Inventory-Export-Error` on failures, complete file byte length on success, and `X-Inventory-Export-Diagnostic-Id`; match that random ID to the single structured server log. The log contains only raw response bytes, CSV bytes, elapsed stage times and sampled heap-plus-external/RSS deltas. Memory is sampled after each bounded response chunk and CSV row; the fixed stage keys retain only their latest elapsed time and the maximum sampled deltas, never a per-row log or value. Do not place inventory values, filters, user identifiers or tokens in proof notes. Turn the opt-in off after the preview check. A hosted 413/503 must have no CSV attachment header or partial file. Sampling at code checkpoints does not prove a continuous memory peak or isolate other requests sharing the process; use a platform per-invocation peak metric or external profiler before claiming a strict hosted 64 MiB peak.

package.json is the canonical command source. Iterate cheaply; certify the final candidate completely.

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

The database gate uses the repository `db:start` bootstrap to install the local-only Storage `v1.77.9` override, then verifies the actual running image before reset and integration tests. `npm run test:local-storage` covers fresh-checkout creation, cache drift, linked-cache preservation and wrong-image rejection without Docker; CI's database job additionally exercises the real clean-checkout start. This override never enters the production migration-delivery command.

## Proof by layer

Unit/component tests cover strict room parsing, measured/default classifications, coordinate mapping, capability predicates, auth validation, explicit confirmation, and cookie refresh behavior.

pgTAP proves counts/categories, immutable identity, hierarchy integrity, role-based reads, direct-write denial and immediate deactivation. A separate real database integration test checks the exact 35-location fixture, room bindings/parents/capabilities, and concurrent hierarchy writers.

Playwright uses real local Supabase and the production Next server for login/logout, membership denial/deactivation, phone layout, captured invitation/recovery emails (including a deployment origin different from Site URL), password updates and token replay rejection. Do not substitute mocked Auth for this proof.

## Efficient iteration

Run affected tests first and reuse dependencies until dependency inputs change. No Supabase reset for isolated visuals. Schema, seed, RLS, function or persisted-contract changes require the clean DB gate. Preserve regressions; do not skip tests to achieve green checks.

CI builds the application with unreachable placeholder Supabase configuration. Its database/browser job runs disposable local Supabase on Ubuntu. This proves the local stack in CI, not that Docker is installed on a developer's laptop.

## Certification and provenance

PR jobs check out the exact head SHA. Main jobs report the actual post-merge SHA. The required aggregate fails when a required job fails or skips. After that aggregate succeeds on main, `Production database ready` fails closed unless explicitly enabled and fully configured, then checks the pinned project and migration history before and after forward delivery. It is a production Vercel Deployment Check, not a PR branch-protection check. Failure artifacts include reports, traces and regenerated types, never credentials/environment dumps.

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

For the mixed label queue, pgTAP checks record-level quantity deduplication before count/page, zero-stock and historical visibility, searchable identifiers, exact-ID mixed resolution, invoker RLS and anonymous denial. Vitest checks copy/distinct/total limits, session member/environment isolation and logout clearing, quantity QR fallback, preflight refresh, acknowledgement, missing-record blocking, and stale async responses. Browser acceptance should build a mixed quantity/asset/location job, navigate away and back, print a multi-page PDF at the chosen physical size, decode a rendered quantity QR, and verify that changed or unavailable records cannot print. The database and browser gates must run after the new migration is applied locally; static/unit checks alone do not certify those boundaries.

Export tests cover filtered and subtree completeness beyond the visible page, low-stock one-row-per-definition shape with all current holdings and locations even when filters match one holding, zero-stock unlocated rows, literal search characters, empty headers, escaping, formula-like text with leading whitespace/control characters, timestamped filenames, the UTC snapshot timestamp and Environment column, `preview-` filename prefix, the 10,000-row explicit overflow boundary, and viewer download/staff-only write access. A downloaded file should be checked through the real authenticated application path.

Report synthetic-frame or mocked camera evidence separately from real-phone camera use and physical printer output. Automated browser print inspection does not prove actual paper measurements, printer clipping, phone performance, or camera behavior on physical devices; list any such acceptance checks not performed. Preserve the production database readiness gate: local validation and an isolated preview do not prove that production migration automation is active.

## Private Speed Insights proof

Focused tests check the Vercel-only explicit opt-in, exact route and URL allowlist, whole-event rejection for auth/token query or fragment parameters, ordinary search redaction, queued-event rejection after login/token navigation, mismatched/dynamic/auth/scan/download rejection, provider script failure isolation, and location picker DOM ID/keyboard relationships. An official Vercel browser script fixture is executed locally with captured intake bodies to verify the _emitted_ URL and route, including the runtime behavior that retains the original route. The fixture source and SHA-256 are recorded in the test. This proves local payload shaping; it does not prove hosted project activation, Vercel ingestion, paid-tier state, or production traffic. Hosted acceptance requires a verified signed-in preview and the owner-approved Vercel setting, without sending test identifiers from real inventory.

## Configuration acceptance

`npm run validate:db` now runs `tests/integration/configuration.ts` after pgTAP and the existing integration suites. The configuration suite uses real authenticated Data API clients and independent PostgreSQL connections to test maintainer-only writes, member reads, direct-write denial and no self-escalation; normalized receipts and decimal-string versions; current category labels in exports; archived/retired reassignment; historical-only inventory references requiring a replacement and retained tombstone; hard deletion of truly unused categories, including the last active category; exact impact staleness after a new reference or version change; no partial update after a later-row failure; shared/exclusive catalog races; and fresh isolation rejection with completed replay. It checks that category reassignment adds metadata events without stock lines. Browser acceptance covers phone-width Settings forms, impact review/cancel/confirm, empty-catalog guidance, viewer controls and shared defaults on Print labels. A delayed Data API call must establish that PostgREST hoists the five-second RPC timeout before execution; checking only `pg_proc.proconfig` is insufficient.
