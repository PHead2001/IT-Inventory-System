# IT Inventory System

Internal IT inventory software with conventional workflows and planned 2.5D room navigation.

Inventory Core adds conventional quantity and serialized-asset workflows, multi-location stock, receiving, partial/Move All transfers, count/location corrections, archive/retire/restore, search and auditable history. Active viewers have read-only access; staff mutations are enforced in PostgreSQL. The graphical room renderer remains planned for PR3.

## Quick start

Use Node 24.19.0, npm 11.11.0, Git, and a running Docker-compatible Linux container runtime.

```text
npm ci
npm run db:start
npm run db:reset
```

Copy `.env.example` to ignored `.env.local`. Obtain the local API URL and public/anon key from `npx supabase status`; never put a service-role key in public variables. The origin defaults to `http://localhost:3000`; override `APP_ORIGIN` only if needed, then run `npm run dev`.

Invite a local user through Supabase Studio and provision membership as described in [local development](docs/development/README.md). There is no public signup or administrator UI.

## Documentation

- [Architecture](docs/architecture.md)
- [Local development](docs/development/README.md)
- [Validation](docs/validation.md)
- [Deployment](docs/deployment.md)
- [Repository rules](AGENTS.md)

Room geometry uses inches and stable location codes, never generated database UUIDs. Production compilation does not require a live database.
