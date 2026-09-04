# Local development

Use Node 24.19.0 and npm 11.11.0, matching .nvmrc, package engines and CI. Windows requires Git and Docker Desktop with a working WSL2/Linux-container backend; WSL2 without a distribution/container runtime is insufficient.

The requested IT Inventory Management folder is the working checkout. Diagnose OneDrive locking/sync problems before changing its location.

## Setup

1. Run `npm ci`.
2. Run `npm run db:start` and `npm run db:reset`.
3. Copy .env.example to ignored .env.local.
4. Obtain URL/public key from `npx supabase status`.
5. Set APP_ORIGIN=http://localhost:3000 and APP_ENV=local.
6. Run `npm run dev`.

Local ports: app 3000, API 54321, PostgreSQL 54322, Studio 54323, email capture 54324. CLI status contains local administrative credentials: never publish its full output. The deployed application needs no service-role key.

Production compilation can use nonsecret URL/key placeholders without Supabase running. Runtime authentication needs a working backend.

## Local accounts

Public signup is disabled. Invite a fictional user in Studio, follow the captured local email, explicitly confirm and set a password. Then provision membership through the local SQL editor:

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
