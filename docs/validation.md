# Validation

package.json is the canonical command source. Iterate cheaply; certify the final candidate completely.

| Command                    | Responsibility                                                       |
| -------------------------- | -------------------------------------------------------------------- |
| npm run typecheck          | Strict application/test TypeScript                                   |
| npm run lint               | ESLint, zero warnings                                                |
| npm run format:check       | Formatting verification                                              |
| npm run test / test:watch  | Unit, room, auth and component tests                                 |
| npm run db:start / db:stop | Local Supabase lifecycle                                             |
| npm run db:reset           | Explicit local reset and migrations                                  |
| npm run db:types           | Generate committed database types                                    |
| npm run db:types:check     | Fail on drift without rewriting tracked files                        |
| npm run test:db            | pgTAP and local-Supabase integration contracts                       |
| npm run validate:db        | Clean reset → DB tests → type comparison                             |
| npm run build              | Production build without a live database                             |
| npm run test:e2e:list      | Discover browser tests without a running backend                     |
| npm run test:e2e           | Local fictional users, backend-specific production build, Playwright |
| npm run validate:app       | Static checks, unit/components, E2E discovery, production build      |
| npm run validate           | App gate, clean DB gate and critical E2E                             |

Start Supabase before database/full validation. Final certification runs fresh `npm ci` then `npm run validate`. E2E rebuilds with local public backend values because they are build inputs.

## Proof by layer

Unit/component tests cover strict room parsing, measured/default classifications, coordinate mapping, capability predicates, auth validation, explicit confirmation, and cookie refresh behavior.

pgTAP proves counts/categories, immutable identity, hierarchy integrity, role-based reads, direct-write denial and immediate deactivation. A separate real database integration test checks the exact 35-location fixture, room bindings/parents/capabilities, and concurrent hierarchy writers.

Playwright uses real local Supabase and the production Next server for login/logout, membership denial/deactivation, phone layout, captured invitation/recovery emails (including a deployment origin different from Site URL), password updates and token replay rejection. Do not substitute mocked Auth for this proof.

## Efficient iteration

Run affected tests first and reuse dependencies until dependency inputs change. No Supabase reset for isolated visuals. Schema, seed, RLS, function or persisted-contract changes require the clean DB gate. Preserve regressions; do not skip tests to achieve green checks.

CI builds the application with unreachable placeholder Supabase configuration. Its database/browser job runs disposable local Supabase on Ubuntu. This proves the local stack in CI, not that Docker is installed on a developer's laptop.

## Certification and provenance

PR jobs check out the exact head SHA. Main jobs report the actual post-merge SHA. The required aggregate fails when a required job fails or skips. Failure artifacts include reports, traces and regenerated types, never credentials/environment dumps.

Ready means: complete gates, exact-SHA green CI, clean worktree, local/remote HEAD agreement, latest fresh clean Codex review, and zero unresolved actionable threads. Verify a matching preview when configured. Code changes require new affected validation and fresh review.

Infrastructure failures are not passes. Report missing runtime/hosted prerequisites separately.
