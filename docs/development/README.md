# Local development

Use Node 24.19.0 and npm 11.11.0, matching .nvmrc and CI. package engines permit the Vercel-managed Node 24.x runtime; the local/CI certification version remains exact. Windows requires Git and a Docker-compatible Linux-container backend. Rancher Desktop with its Moby engine and WSL2 is supported; WSL2 alone is insufficient. Reopen terminal sessions after installing Node/npm or the container tools so PATH is refreshed.

The requested IT Inventory Management folder is the working checkout. Diagnose OneDrive locking/sync problems before changing its location.

## Setup

1. Run `npm ci`.
2. Run `npm run db:start` and `npm run db:reset`.
3. Copy .env.example to ignored .env.local.
4. Obtain URL/public key from `npx supabase status`.
5. Set APP_ENV=local. APP_ORIGIN is optional and defaults to http://localhost:3000 when VERCEL_BRANCH_URL is absent; set it explicitly for another local origin/port.
6. Run `npm run dev`.

Local SMTP permits 100 captured messages/hour for repeatable email tests; this is not a hosted SMTP configuration recommendation.

Local ports: app 3000, API 54321, PostgreSQL 54322, Studio 54323, email capture 54324. CLI status contains local administrative credentials: never publish its full output. The deployed application needs no service-role key.

Use the repository `db:start` command for a clean checkout. It writes the ignored local Supabase Storage version override (`v1.77.9`) before starting the pinned CLI and verifies that the running Storage container uses that exact tag from one of the CLI's official registries. Local reset and database tests fail before running against a different Storage image. If an older local stack is already running, use `npm run db:stop` followed by `npm run db:start`; this local image override does not change a linked or hosted Supabase project. A CLI `link` may refresh the ignored cache, so the next `db:start` restores the local override.

Production compilation can use nonsecret URL/key placeholders without Supabase running. Runtime authentication needs a working backend.

Private inventory files additionally need local Supabase Storage and a server-only `INVENTORY_FILE_KEYS_JSON` entry matching an active row in `private.file_keys`; the migration deliberately installs no secret. For ordinary local browser use, keep the JSON map in ignored `.env.local` and add a distinct local key through the local database, never through browser code. `npm run test:e2e` provisions its own ephemeral loopback-only key for the child build/browser run, then disables it and replaces the database secret in `finally`. An inert key-ID tombstone may remain because published test files retain a foreign-key reference. See [private inventory files](../inventory-files.md) for the attestation, Storage and cleanup contract.

Vercel previews derive their HTTPS origin from VERCEL_BRANCH_URL when APP_ORIGIN is unset. Do not copy the local APP_ORIGIN into Vercel Preview settings. See [deployment](../deployment.md) for the one-time Supabase preview wildcard and exact production redirects.

## Local accounts

Public signup is disabled globally with auth.enable_signup=false. Keep auth.email.enable_signup=true: the pinned CLI maps this provider switch to email login availability, not just registration. Invite a fictional user in Studio, follow the captured local email, explicitly confirm and set a password. Then provision membership through the local SQL editor:

```sql
insert into public.app_members(user_id, display_name, role, active)
select id, 'Local IT Staff', 'staff', true
from auth.users
where email = 'your-local-test-address@example.test';
```

Use viewer for read-only access. Account creation never automatically creates membership. Deactivate with active=false instead of deleting historical identities. There is no administrator UI.

tests/fixtures/auth.json contains deliberately fictional local-only test credentials. Administrative test helpers reject nonlocal API targets. Never reuse these accounts/passwords in hosted environments.

## Database workflow

Required reference data is migration-controlled. supabase/seed.sql is reserved for disposable fixtures. Add forward migrations; do not rewrite applied durable history.

Run `npm run validate:db` after persistence/security changes. Regenerate and commit types with `npm run db:types`. CI publishes regenerated output on drift. Reset/test helpers use explicit local operations and reject nonlocal targets.

Use focused Vitest tests while iterating; run formatting and relevant complete gates before certification. Room parsing needs no Docker; room-to-database contracts do.

## Inventory Core iteration

The local reset applies Foundation followed by additive Inventory Core/read migrations. Use fictional data only. Staff can create a zero-stock quantity definition or a located asset through /inventory; viewers can browse search, details, locations and history. Required reasons and optimistic version conflicts are enforced by the mutation RPCs as well as the forms.

After migration changes, run the local database gate and regenerate types. tests/integration/inventory.ts uses real signed-in local clients plus loopback PostgreSQL for invariant/concurrency checks. Browser tests use the same disposable backend and verify persisted workflows after reload. No production service is needed for local certification.

## Interactive room iteration

Use `/room` after local sign-in. Geometry lives in the validated Git JSON, with no database running needed for schema tests. Reuse local Supabase while iterating on visuals; no reset is needed for materials, camera or labels. Use `npm run test:e2e -- tests/e2e/room.spec.ts` for the real browser surface. See [room navigation](../room-navigation.md) for selection, coordinate and fallback contracts.

## Labels, scanning and stock iteration

Use fictional local inventory while iterating on labels, scan navigation, thresholds, and exports. Label targets use the configured local `APP_ORIGIN` (default `http://localhost:3000`); preview and production labels belong to their own application environment. Production label generation and absolute-URL scan input require explicit production `APP_ORIGIN`; internal relative paths and `LOC:`/`AST:` or bare exact-identifier lookup work without it. QR images are generated locally. Camera use starts only from the explicit scan action; manual/paste input provides a camera-free path. Keep synthetic decoder fixtures distinct from testing with a physical phone.

Thresholds default to unset. Exercise disabled monitoring, threshold zero, exact-boundary totals, multiple holdings, and a balance still recorded at an inactive location. Verify that moving stock conserves item-wide status and that viewer access remains read-only. Exports use the current caller's read access, one snapshot, and a 10,000-row limit with an explicit overflow response. Never put hosted credentials or real inventory identifiers in local fixtures.
