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

Local ports: app 3000, shadow database 45320, API 45321, PostgreSQL 45322, Studio 45323, email capture 45324. CLI status contains local administrative credentials: never publish its full output. The deployed application needs no service-role key.

The canonical local ports avoid the former Supabase default range 54320–54324,
which Windows may reserve for other components. On Windows, `db:start` performs
bounded read-only checks of IPv4/IPv6 TCP exclusions and listeners before startup.
Every listener address requires coverage by an exact local Docker project/service
publication on that port. An IPv4 wildcard covers IPv4 addresses only; IPv6
wildcard publication does not imply IPv4 coverage. These checks explain published
bindings rather than proving listener PID ownership or future port availability.
Listener enumeration uses only PowerShell engine syntax and .NET, so it does not
load modules from an inherited `PSModulePath`. A present unhealthy healthcheck is refused; a service without a
Docker healthcheck must still pass the other ownership checks. The preflight
does not edit Windows reservations, firewall rules or Docker configuration.
A reported conflict needs owner review; database reset does not repair bindings.

For an existing local stack, run `npm run db:stop` and `npm run db:start` to apply
the new bindings to its existing project and volume. Do not reset or delete volumes
to migrate ports. In ignored `.env.local` (or an owner-managed runner `local.env`),
change only a recognized old `NEXT_PUBLIC_SUPABASE_URL` loopback HTTP origin on
54321 to the same host on 45321 through its existing local configuration workflow.
Recognized hosts are `127.0.0.1`, `localhost` and `[::1]`, with no credentials,
path beyond `/`, query or fragment. Confirm the local URL from CLI status without
publishing keys. Preserve credentials and hosted/staging URLs. Runner installation
and network configuration are separate owner actions. Restart the app and rebuild
production-mode local artifacts because the public URL is a build input.

Use the repository `db:start` command for a clean checkout. It writes the ignored local Supabase Storage version override (`v1.77.9`) before starting the pinned CLI and verifies that the running Storage container uses that exact tag from one of the CLI's official registries. Local reset and database tests fail before running against a different Storage image. If an older local stack is already running, use `npm run db:stop` followed by `npm run db:start`; this local image override does not change a linked or hosted Supabase project. A CLI `link` may refresh the ignored cache, so the next `db:start` restores the local override.

Before the CLI starts or resets the disposable stack, `db:start` and `db:reset`
validate and read both exact configured public email files,
`supabase/templates/invite.html` and `supabase/templates/recovery.html`. Linked
directories, symlinks, hardlinks, nonregular files and other configured paths fail
before permission changes. On Unix, the opened files receive mode `0644` so the
local Kong worker can read a checkout created with a restrictive umask. Windows
validates the same files without applying POSIX permission changes. File bytes,
the process/runner umask and unrelated files such as `.env` stay unchanged.
Permission reports include only the fixed template kind and numeric mode, UID,
GID and process umask; they do not expose paths or file content. The existing
post-start/reset and password-policy replacement checks still require HTTP 200
and exact matching template bodies from the validated local services.

PR44 CI run `38015431606`, job `114104521090`, observed invitation-template HTTP
403 during startup. The prepared runner's inherited `077` umask and the pinned
CLI's static-file mounts into Kong support a file-permission hypothesis. That run
did not establish mounted file modes or effective worker readability. Permission
normalization establishes a local prerequisite; actual Linux service checks and
the existing real email E2E assertions must establish the result.

Production compilation can use nonsecret URL/key placeholders without Supabase running. Runtime authentication needs a working backend.

Private inventory files additionally need local Supabase Storage and a server-only `INVENTORY_FILE_KEYS_JSON` entry matching an active row in `private.file_keys`; the migration deliberately installs no secret. For ordinary local browser use, keep the JSON map in ignored `.env.local` and add a distinct local key through the local database, never through browser code. `npm run test:e2e` provisions its own ephemeral loopback-only key for the child build/browser run, then disables it and replaces the database secret in `finally`. An inert key-ID tombstone may remain because published test files retain a foreign-key reference. See [private inventory files](../inventory-files.md) for the attestation, Storage and cleanup contract.

Vercel previews derive their HTTPS origin from VERCEL_BRANCH_URL when APP_ORIGIN is unset. Do not copy the local APP_ORIGIN into Vercel Preview settings. See [deployment](../deployment.md) for the one-time Supabase preview wildcard and exact production redirects.

## Automatic local push checks

After setup, run `npm run hooks:install` once to opt this repository into automatic
pre-push checks. This explicit command sets only repository-local
`core.hooksPath=.githooks`. It does not change global Git configuration.
Installation refuses an existing effective
custom hooks path or any non-sample entry in the resolved default hooks directory
so existing hooks can be integrated deliberately. It verifies the effective path
again after writing the local setting and preserves worktree-specific overrides.
Worktrees inherit the repository setting unless worktree or command configuration
overrides it. The relative path enables the hook only on branches/worktrees that
contain the shipped executable `.githooks/pre-push`; branches without that file
have no hook until they adopt these changes. The installer confirms the current
setting, not hook activation in every branch or worktree.
Package installation, CI, Vercel builds and clones do not enable the hook.

The hook runs `npm run validate:push`: typecheck, zero-warning lint, formatting and
the full Vitest suite, sequentially. The local wrapper replaces inherited Node
old-space limits with a 2 GiB limit for the canonical typecheck stage and a 1 GiB
limit for lint, formatting and Vitest. It uses at most two Vitest workers
with the default file parallelism and isolation. Other Node options are preserved. This limits
old-space, not total process/host memory, and does not alter the full CI commands.
Every nondeleted pushed ref must point at the checked-out
HEAD, with no tracked, staged or untracked work before or after the checks; commit
or stash pending changes first. A failing check or a HEAD/worktree change blocks
the push. Deletion-only/no-update pushes run no checks. It checks main refs the
same way; repository policy still prohibits unauthorized direct main pushes.
The hook is local feedback; exact-SHA canonical CI remains authoritative and adds
the locked install, both builds, database and browser gates.

Use `npm run validate:push` directly before opting in. To opt out, explicitly run
`git config --local --unset core.hooksPath` only while that setting is still
`.githooks`. Commit the shipped hook with executable mode for Unix checkouts.

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

Local Windows runs without `CI` or `VERCEL` cap Vitest workers and Next.js page-data/static-generation workers at two. Linux, CI and Vercel retain their existing defaults; the cap preserves test selection and assertions. Playwright already uses at most two workers for the full suite and one for focused runs. Next.js compilation and other tools can still use additional processes, so these caps are not a total host resource limit. Run one local validation at a time and avoid overlapping it with a heavy self-hosted runner job on the same computer. The browser performance report currently collects resource samples only on Linux; a Windows pass alone does not prove that host memory stayed below its limit.

## Inventory Core iteration

The local reset applies Foundation followed by additive Inventory Core/read migrations. Use fictional data only. Staff can create a zero-stock quantity definition or a located asset through /inventory; viewers can browse search, details, locations and history. Required reasons and optimistic version conflicts are enforced by the mutation RPCs as well as the forms.

After migration changes, run the local database gate and regenerate types. tests/integration/inventory.ts uses real signed-in local clients plus loopback PostgreSQL for invariant/concurrency checks. Browser tests use the same disposable backend and verify persisted workflows after reload. No production service is needed for local certification.

## Interactive room iteration

Use `/room` after local sign-in. Geometry lives in the validated Git JSON, with no database running needed for schema tests. Reuse local Supabase while iterating on visuals; no reset is needed for materials, camera or labels. Use `npm run test:e2e -- tests/e2e/00-room.spec.ts` for the real browser surface. See [room navigation](../room-navigation.md) for selection, coordinate and fallback contracts.

## Labels, scanning and stock iteration

Use fictional local inventory while iterating on labels, scan navigation, thresholds, and exports. Label targets use the configured local `APP_ORIGIN` (default `http://localhost:3000`); preview and production labels belong to their own application environment. Production label generation and absolute-URL scan input require explicit production `APP_ORIGIN`; internal relative paths and `LOC:`/`AST:` or bare exact-identifier lookup work without it. QR images are generated locally. Camera use starts only from the explicit scan action; manual/paste input provides a camera-free path. Keep synthetic decoder fixtures distinct from testing with a physical phone.

Thresholds default to unset. Exercise disabled monitoring, threshold zero, exact-boundary totals, multiple holdings, and a balance still recorded at an inactive location. Verify that moving stock conserves item-wide status and that viewer access remains read-only. Exports use the current caller's read access, one snapshot, and a 10,000-row limit with an explicit overflow response. Never put hosted credentials or real inventory identifiers in local fixtures.
