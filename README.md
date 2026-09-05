# IT Inventory System

Internal IT inventory software with conventional workflows and planned 2.5D room navigation.

Foundation PR 1 establishes Next.js, Supabase Auth, active viewer/staff memberships, reference categories/locations, measured room data, and validation. Inventory CRUD, quantities, serialized assets, search, movement history, and the room renderer are **not implemented yet**.

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
