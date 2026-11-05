# IT Inventory System

Internal IT inventory software with conventional workflows and interactive 2.5D room navigation. Staff choose **Add quantity item** for interchangeable items tracked by count or **Add individual asset** for one specific device. Both choices show examples before entry. **Properties & sites** is the site-custody area; these presentation terms preserve the existing quantity and serialized-asset storage contracts.

Inventory Core adds conventional quantity and serialized-asset workflows, multi-location stock, receiving, partial/Move All transfers, count/location corrections, archive/retire/restore, search and auditable history. Active viewers have read-only access; staff mutations are enforced in PostgreSQL. The graphical room provides location selection, inventory context and search-to-room focus, with conventional controls available without WebGL.

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
- [Room navigation](docs/room-navigation.md)
- [Local development](docs/development/README.md)
- [Validation](docs/validation.md)
- [Search and keyboard shortcuts](docs/command-palette.md)
- [Deployment](docs/deployment.md)
- [Repository rules](AGENTS.md)

Room geometry uses inches and stable location codes, never generated database UUIDs. Production compilation does not require a live database.

Production release uses a required Vercel GitHub Deployment Check on the main-only `Production database ready` job. After one-time owner activation, successful main CI applies checked-in forward migrations before Vercel aliases the matching build. See [deployment](docs/deployment.md#one-time-activation) for the fail-closed setup and backup prerequisites.

PR6 adds local QR/optional Code 128 labels, scan-to-open navigation, item-wide reorder thresholds, a low-stock overview and authenticated CSV downloads. See [labels, scanning and stock status](docs/labels-and-stock.md) for user and data contracts.

Private Speed Insights instrumentation is available for selected authenticated overview routes when explicitly enabled on Vercel. It is off in local development and CI by default; see [deployment](docs/deployment.md#private-speed-insights) for the opt-in and privacy boundary.

Settings lets active members read categories and shared label defaults. An active staff member with the separately provisioned `can_manage_configuration` grant can create, rename, or remove categories and edit label defaults. Referenced category removal requires an impact review and replacement; inventory identity, stock and history are preserved.
