# Validation

package.json is the canonical command source. Iterate cheaply; certify the final candidate completely.

| Command                       | Responsibility                                                            |
| ----------------------------- | ------------------------------------------------------------------------- |
| npm run typecheck             | Strict application/test TypeScript                                        |
| npm run lint                  | ESLint, zero warnings                                                     |
| npm run format:check          | Formatting verification                                                   |
| npm run test / test:watch     | Unit, room, auth and component tests                                      |
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

## Inventory Core proof

Focused Vitest suites cover mutation input normalization and stable error mapping, Server Action authorization, read contracts, structured history, partial/Move All confirmation, duplicate serial warnings, preserved retry identity and stale form baselines. Viewer route tests prove mutation controls are absent; PostgreSQL separately enforces authorization.

Inventory pgTAP tests cover RLS, direct-write grants, hardened RPC privileges, ordinary constraints and append-only history. Local integration tests exercise the complete quantity/asset transitions, event deltas, no-change observations, rollback, normalized idempotent replay/conflicts, authorization revocation, duplicate concurrent requests and competing stock moves. Read RPC tests verify literal search, stable location contracts, historical filters and bounded deterministic pagination.

Playwright proves the conventional staff workflows against real local persistence, including multi-location stock, partial/Move All moves, count correction, archive/restore, serialized transitions, duplicate warning, search/location/history, reload persistence, viewer restrictions and stale editing. Keep the existing real Auth workflows. A component mock is not a substitute for database or browser proof.

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

Export tests cover filtered and subtree completeness beyond the visible page, low-stock one-row-per-definition shape with all current holdings and locations even when filters match one holding, zero-stock unlocated rows, literal search characters, empty headers, escaping, formula-like text with leading whitespace/control characters, timestamped filenames, the UTC snapshot timestamp and Environment column, `preview-` filename prefix, the 10,000-row explicit overflow boundary, and viewer download/staff-only write access. A downloaded file should be checked through the real authenticated application path.

Report synthetic-frame or mocked camera evidence separately from real-phone camera use and physical printer output. Automated browser print inspection does not prove actual paper measurements, printer clipping, phone performance, or camera behavior on physical devices; list any such acceptance checks not performed. Preserve the production database readiness gate: local validation and an isolated preview do not prove that production migration automation is active.

## Private Speed Insights proof

Focused tests check the Vercel-only explicit opt-in, exact route and URL allowlist, whole-event rejection for auth/token query or fragment parameters, ordinary search redaction, queued-event rejection after login/token navigation, mismatched/dynamic/auth/scan/download rejection, provider script failure isolation, and location picker DOM ID/keyboard relationships. An official Vercel browser script fixture is executed locally with captured intake bodies to verify the _emitted_ URL and route, including the runtime behavior that retains the original route. The fixture source and SHA-256 are recorded in the test. This proves local payload shaping; it does not prove hosted project activation, Vercel ingestion, paid-tier state, or production traffic. Hosted acceptance requires a verified signed-in preview and the owner-approved Vercel setting, without sending test identifiers from real inventory.
