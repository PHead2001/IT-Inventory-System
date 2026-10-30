# AGENTS.md — IT Inventory Repository Guidance

> Mandatory repository behavior for AI coding agents and developers.
> Keep this file lean. Route deeper architecture, validation, deployment, and feature detail to canonical docs.

## Purpose

This repository contains an internal IT inventory web application with an interactive 2.5D representation of physical storage locations.

Read this file before making changes.

## Companion guidance

When available in the current project/workspace, consult:

- **Codex Engineering & Prompting Playbook** for cross-project engineering workflow.
- **Prompting guidance for GPT-5.6 Sol** for model-level prompting guidance.

These do not override repository-specific facts.

For commands, architecture, schemas, environment names, deployment configuration, and current behavior, inspect the repository.

## Read order

For normal work, inspect only what is relevant:

1. `AGENTS.md`
2. `README.md`
3. `docs/architecture.md`
4. `docs/validation.md`
5. `docs/deployment.md` when deployment/configuration is affected
6. `docs/development/README.md` when setup/workflow is relevant
7. `docs/interface-standards.md` when user-visible UI, copy, motion or the room view is affected
8. affected module docs, source, tests, migrations, scripts, and workflows
9. current PR/review/CI state when working on an existing PR

Do not guess repository facts that can be inspected.

## Source of truth

Use this order:

1. explicit current task requirements
2. this file
3. canonical project/module docs
4. executable source, schema, migrations, tests, scripts, and workflows
5. companion engineering/prompting guidance
6. inference

If docs and implementation conflict, identify the conflict rather than silently choosing one.

---

# Stack

Production stack:

- **Next.js + TypeScript**
- **React**
- **Tailwind CSS**
- **shadcn/ui**
- **React Three Fiber + Drei + Three.js**
- **Supabase PostgreSQL**
- **Supabase Auth**
- **Supabase Storage**
- **Vercel**
- **GitHub**
- **Vitest + React Testing Library + Playwright**

Do **not** introduce Prisma unless explicitly requested.

Use Supabase client/server SDKs and repository-defined data helpers rather than adding an unnecessary ORM layer.

---

# Product boundaries

The application tracks IT inventory across logical physical locations.

The 2.5D room is a navigation/discovery interface over inventory data. It is **not** the source of truth for inventory state.

The application must remain usable through ordinary search/list/detail UI without requiring 3D interaction.

Initial modeled scope is the IT closet/server room.

Do not expand v0.1 into the following unless explicitly requested:

- Intune integration
- UniFi API integration
- Entra ID SSO
- QR/barcode scanning
- AR
- advanced layout editing
- office-room modeling
- rack-U precision beyond current requirements
- purchasing/warranty integrations

Design should not block later expansion, but do not build speculative infrastructure for it.

---

# Core architecture invariants

## Logical inventory and geometry are separate

Hard rule:

- inventory records reference **logical locations**
- room meshes reference the same locations through stable identifiers
- inventory must never use Three.js coordinates, mesh identity, or scene-node identity as its database location key
- moving/redesigning room geometry must not break inventory relationships
- visual geometry may change independently of inventory records

Example:

```text
Database location code: ITC-S4B
Room object locationCode: ITC-S4B
```

The stable location identifier is the bridge.

## Stable location identifiers

Preserve existing real-world labels exactly.

Current hierarchy:

```text
IT Closet
├── Left Storage
│   ├── Shelf 1: 1A, 1B, 1C
│   ├── Shelf 2: 2A, 2B, 2C
│   └── Drawers 1–6
├── Server Rack
├── Right Storage
│   ├── Shelf 3: 3A, 3B, 3C
│   ├── Shelf 4: 4A, 4B, 4C
│   └── Drawers 7–12
├── Red Container
├── Black Container
└── Clear Container
```

Orientation matters:

- left shelf `A` sections are nearest the door
- right shelf `A` sections are nearest the server/back wall

Do not silently rename or renumber these.

Prefer:

- database PK: UUID
- stable unique location code: human-readable and effectively immutable
- hierarchy: `parent_id`
- display name separate from stable code

Inventory should reference the location UUID.

Versioned room JSON should reference the stable location code rather than seeded database UUIDs.

## Room geometry

Room geometry/config is versioned in Git initially, preferably under:

```text
data/rooms/
```

Do not move furniture/layout coordinates into Supabase until a real layout editor requires it.

Use **inches** as the internal measurement unit unless a canonical geometry utility explicitly defines another unit.

Coordinate convention:

```text
X = left wall → right wall
Y = door wall → back wall
Z = floor → ceiling
```

Do not change this convention locally.

Use clean parametric geometry. Do not recreate Matterport mesh noise, wire detail, cables, or photorealistic clutter unless explicitly required.

## 2.5D interaction

Prefer:

- orthographic or orthographic-style presentation
- pan, zoom, Guided constrained rotation by default, and user-selected Free Orbit for unrestricted horizontal and vertical viewing
- clear click/tap targets
- persistent selected-location highlight
- search results that can focus/highlight a physical location
- clean low-poly visuals

Essential inventory actions must not depend on hover-only or precise 3D manipulation. Room labels are hover-only by default, with a Show all labels control; touch users select locations through the conventional panel. Location pickers use an accessible indented, collapsible tree: browse mode can select aggregate locations, while inventory forms make ineligible ancestors navigation-only; search results remain flat and include full breadcrumbs.

---

# Inventory domain invariants

## Two inventory types

### Quantity inventory

For interchangeable items where individual identity does not matter.

Examples: cables, adapters, generic chargers.

Store a quantity at a logical location.

### Serialized assets

For individually tracked equipment.

Examples: laptops, switches, access points, tagged equipment.

May include serial number and asset tag and represents one distinct asset.

Do not force bulk inventory into one-row-per-item modeling.

Do not collapse serialized assets into anonymous quantity counts.

## Movement history

Location changes must be auditable.

A move should preserve:

- item/asset
- source location
- destination location
- quantity when applicable
- actor when authentication is available
- timestamp

Normal application workflows should treat movement history as append-only.

Do not implement moves as only an overwrite of current `location_id` when movement tracking is in scope.

## Categories

Categories are data-driven, not hardcoded into UI logic.

Sensible seed categories may include:

- Computers
- Networking
- Cables
- Adapters
- Peripherals
- Parts
- Tools
- Other

## Search

Search is a first-class workflow.

Results should expose logical physical location.

When a visual room exists, selecting a result should be able to focus/highlight that location without mutating inventory state.

---

# Supabase and security

## Authentication

Local development may use explicitly documented development conveniences.

A production Vercel deployment containing real inventory data must **not** be publicly browsable.

Production access must require Supabase Auth or an explicitly approved successor.

Entra ID integration is planned later, not a prerequisite unless explicitly requested.

## RLS

Enable and preserve Row Level Security on user-accessible application tables.

Do not treat possession of a Supabase client key as authorization.

If roles such as Admin, IT Staff, or Read Only are introduced, enforce them at the data boundary, not only in UI visibility.

## Credentials

Never commit or expose secrets.

- service-role credentials are server-only
- never place service-role credentials in client bundles/public env vars
- secrets belong in Vercel/Supabase environment configuration
- secret-bearing `.env` files must not be committed

## Database changes

All schema changes must be represented by repository-controlled Supabase migrations.

Do not make undocumented production schema changes through the dashboard and leave the repository behind.

For changes to schema, seeds, RLS, triggers, RPCs, or persisted invariants:

- create/update migrations
- add database tests where appropriate
- validate from a clean local database state when required

Automated production migration delivery and its gates are defined in
`docs/deployment.md`; this repository guidance does not replace that mechanism.

## Storage

Use Supabase Storage for application-managed photos/files.

Do not use public buckets for sensitive inventory/location imagery by default.

Storage authorization should follow the related inventory access model.

---

# Next.js / React boundaries

Prefer server-side handling for privileged operations and secrets.

Client code may use public Supabase configuration and authenticated sessions but must never receive privileged server credentials.

Keep domain/persistence logic separate from presentation.

Do not bury inventory mutations inside Three.js mesh components.

The scene emits/selects logical location identifiers. Application/domain services perform inventory reads and writes.

---

# Interface standards

The app is used by IT staff during real work, often on a phone in a closet. User-visible quality is a product requirement, not polish after correctness.

Invariants:

- Never render raw identifiers (UUIDs, revision IDs, internal markers such as `legacy`, RPC or table names) in user-facing UI, including display strings composed in SQL. Show them only in technical detail, exports or logs intended for them.
- Never show success before the write commits. Plain language must stay truthful.
- Destructive and lifecycle actions (retire, archive, remove, discard) use the danger/warning treatment and name the affected record.
- Essential actions never depend on hover or precise 3D manipulation (see 2.5D interaction).

Defaults (deviate only with a stated reason in the PR):

- Use the design tokens and type scale in `docs/interface-standards.md`. Do not introduce ad hoc colors, font families, or font sizes below the documented minimum.
- Write UI copy for the staff member, not the reviewer: outcome first, verb-led buttons, no internal model terms. Correctness detail belongs in docs, tests and history, not on screen.
- A completed operation shows a clear result and a way out (Done / next action). It does not lock unrelated controls.
- Use the existing motion vocabulary and Motion library for feedback and transitions; respect the motion preference.

User-visible changes are not accepted from tests alone. Inspect real populated screens at desktop and 390 px, in Full and Reduced motion, scaled to the change. Attach before/after captures to the PR.

---

# Git safety

- work on a feature/fix branch, not directly on `main`
- do not merge, close, or retarget a PR unless explicitly requested
- the project owner performs final merge by default
- do not continue feature work on a branch whose PR already merged
- before pushing, confirm branch, worktree, and HEAD
- validation evidence must refer to the exact SHA validated
- do not deploy/promote production unless explicitly authorized

Vercel PR/branch previews are non-production.

A preview does not imply production authorization.

---

# Prompt / task modes

Use:

- `/plan` for unresolved architecture/design with meaningful alternatives
- `/goal` for a clear multi-file or multi-stage implementation outcome
- normal prompts for small/local fixes, diagnosis, docs, or follow-ups

For major unresolved subsystems, prefer `/plan` then `/goal` after approval.

Standing rules belong here or in canonical docs. Task prompts should carry only the task-specific delta.

GitHub PR review uses `@codex review`.

---

# Testing

Every real bug should normally leave behind a permanent regression test.

Preferred sequence:

1. reproduce with a focused test when practical
2. confirm the failure mode
3. fix the underlying invariant
4. inspect sibling paths
5. preserve the regression
6. run broader validation appropriate to the change

Do not weaken, skip, focus away, or delete tests merely to make CI green.

Use the lowest authoritative layer that proves behavior:

- **Vitest** for domain/unit behavior
- **React Testing Library** for components/interactions
- **Playwright** for critical E2E workflows
- **Supabase/Postgres tests** for database invariants, RLS, migrations, triggers, and RPCs where applicable

Important workflows should gain E2E coverage as they stabilize, especially:

- authentication
- search
- add/edit inventory
- quantity changes
- serialized asset creation
- moves and movement history
- location selection/highlighting
- authorization boundaries

Avoid testing Three.js implementation details when stable application contracts can prove the behavior.

---

# Validation

Use **iterate cheaply, certify expensively**.

## During iteration

- run focused affected tests first
- reuse a successful dependency install while dependency inputs are unchanged
- do not reset local Supabase for isolated UI-only changes
- batch all related findings and fixes before one push
- run `npm run validate:push` before pushing (typecheck, zero-warning lint, formatting and Vitest; no build/database/browser gate)
- keep PRs draft during iteration; mark ready for review for authoritative complete CI
- adversarially inspect sibling paths before pushing

## Fresh dependency install

Run fresh `npm ci` when:

- dependency/lockfile inputs changed
- the existing install is untrusted/corrupt
- executing the final complete gate locally, or in authoritative CI

Do not rerun it after every source-only edit.

## Supabase validation

Run the repository's complete local Supabase gate when:

- migrations/schema/seeds changed
- RLS/authorization changed
- triggers/RPCs changed
- persisted data contracts changed
- final certification requires database correctness

Do not rebuild the database for isolated visual/UI work as ceremony.

## Canonical commands

`package.json` is the canonical application command source.

As the repo is bootstrapped, prefer a small consistent command surface with equivalents of:

```text
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:e2e
npm run build
npm run validate
```

Once commands exist, inspect and use them rather than inventing replacements.

## Final PR certification

Before reporting a code PR ready, require the repository-defined complete gate on the exact final SHA. The canonical CI result is authoritative; a second full local application/database/browser run is not required when that exact-SHA CI gate has passed. Run focused local regression checks and the cheap pre-push gate while iterating. Run a full local gate when needed to diagnose a failure or validate a boundary CI does not exercise.

For the mature project, this should cover configured equivalents of:

- fresh dependency install
- strict typecheck
- zero-warning lint
- formatting
- unit/domain tests
- component/integration tests
- production Next.js build
- Playwright E2E
- database reset/migration/tests when DB correctness is in scope
- RLS/security tests when authorization is in scope
- exact-SHA remote checks
- Vercel preview health when configured
- latest fresh Codex review clean on exact final HEAD
- zero unresolved actionable review threads
- clean worktree
- remote HEAD equals local HEAD

If certification causes code changes, validate the new HEAD and obtain a fresh review.

Never claim validation that was not actually run.

---

# Codex PR review protocol

Every PR receives Codex review unless explicitly waived.

For each valid finding:

1. inspect root cause and sibling paths
2. implement the invariant-level fix
3. add durable regression coverage
4. run focused tests
5. run affected local regressions and the cheap pre-push gate; use canonical exact-SHA CI for complete certification
6. push the exact fix SHA
7. wait for required exact-SHA checks
8. reply on the original thread with:
   - fix SHA
   - root-cause explanation
   - regression coverage
   - validation evidence
9. resolve only after the evidence reply

Never resolve first and explain later.

After each batch:

- query live unresolved threads
- request fresh `@codex review`
- wait for completion
- repeat until the latest review has no actionable findings and unresolved count is zero on the same green HEAD

---

# Vercel deployment

Use Vercel for Next.js preview and production hosting.

## Preview

When GitHub integration is configured:

- PR/branch previews are non-production
- use them for stakeholder verification when useful
- avoid redundant manual redeploys when Vercel already updates the branch preview
- report the exact SHA associated with a validated preview

## Production

Protected main, required checks, and human merge authorize normal Vercel production deployment from main. Do not add a custom manual promotion pipeline.

Do not change production domains/secrets, billing, production deployment state, or run destructive production migrations without explicit authorization.

---

# Documentation routing

Update durable docs in the same PR when changing:

- architecture
- data model/domain invariants
- room-coordinate conventions
- authentication/authorization
- environment configuration
- setup
- validation
- deployment
- external prerequisites
- known limitations
- design tokens, type scale, shared copy vocabulary, or interface standards

Use:

- `README.md` — overview and fast start
- `AGENTS.md` — mandatory agent behavior
- `docs/architecture.md` — system/domain invariants
- `docs/validation.md` — gates and commands
- `docs/deployment.md` — Vercel/Supabase deployment
- `docs/development/README.md` — local workflow
- `docs/interface-standards.md` — typography, color, copy, feedback, motion, room-view, and visual acceptance standards
- module docs — only for sufficiently complex subsystems
- ADRs — only for meaningful durable architecture decisions

Detailed room measurements belong in versioned room data and architecture/location documentation, not duplicated here.

Tests are executable documentation and should be preserved.

---

# Completion report

For substantial work, report:

- branch
- final HEAD
- PR
- material changes
- tests/regressions added
- validation results
- exact-SHA CI status
- latest Codex review
- unresolved review count
- Vercel preview when applicable
- production status
- remaining manual prerequisites
- known unvalidated boundaries
- for user-visible changes: how to try it (preview link and the steps to reach the changed flow), before/after captures, and known UX gaps

Keep routine command narration out of the report.

---

# Default autonomy boundary

Within requested implementation scope, agents may normally:

- inspect repo and PR/CI state
- edit in-scope code/docs/tests
- run local non-destructive validation
- commit on the feature branch
- push the feature branch when PR work is authorized
- update PR descriptions/comments with evidence

Unless explicitly authorized, agents must not:

- push directly to `main`
- merge to `main`
- close/retarget PRs
- delete production data
- run destructive production migrations
- expose/fabricate credentials
- change billing
- promote production
- materially expand product scope

When blocked by an external/account-level prerequisite, finish everything possible and report the smallest remaining human action.
