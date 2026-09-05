# Foundation architecture

The approved v0.1 plan and amendments govern this foundation. Inventory engines, movement RPCs, search, and the R3F renderer belong to later PRs.

## System boundaries

Next.js App Router serves the operational dashboard. Request-scoped Supabase clients use the signed-in user's credentials. PostgreSQL owns logical data; Git owns geometry. The future scene emits location codes and receives selection/focus state; it never owns persistence. Conventional workflows remain independent of 3D.

## Reference model

- `app_members`: Auth UUID, display name, viewer/staff role, active flag, timestamps. Explicit membership grants access; creating an Auth account does not. Deactivate identities rather than deleting historical actors.
- `categories`: generated UUID, code, display name, active flag, sort order, timestamps. Normalized names are unique.
- `locations`: generated UUID, immutable stable code, display name, parent UUID, semantic kind, explicit `can_hold_inventory`, active flag, sort order, timestamps.

Eligibility is exactly `active && can_hold_inventory`; kind does not compute capability. Migrations create eight categories, 35 locations, 28 destinations, and seven aggregates. Required reference data lives in migrations, not disposable seeds.

Hierarchy: room → storage group → shelf → section; drawers belong to storage groups; rack/containers belong to the room. Constraints and statement validation reject missing/self parents, cycles, and invalid parent kinds. A private guard row serializes privileged hierarchy edits even with stale Repeatable Read snapshots. This is unrelated to inventory accounting. Codes/UUIDs are immutable; display names are separate.

## Room contract

The strict Zod schema in `src/features/room/schema.ts` is the type source; TypeScript types are inferred. `data/rooms/it-closet.json` is version 1. Parsing never queries Supabase.

- Inches: X left→right, Y door→back, Z floor→ceiling.
- Box positions are centers; sizes are full extents. Groups define parent-local origins.
- Children inherit transforms; rotationZDegrees is vertical yaw.
- interaction.focusPoint is **parent-local**.
- interaction.hitBox.center is **node-local**, rotating with its node.
- The future renderer maps positions [x,y,z]→[x,z,-y] and sizes [x,y,z]→[x,z,y].
- Node IDs have no persistence meaning. locationCode is the logical bridge.
- Every destination has one primary binding; aggregate bindings preserve ancestry.
- JSON contains neither inventory state nor generated database UUIDs.

Room/opening/rack dimensions and positions, shelving spans/depths/top elevations, sections, drawers, and container dimensions are measured. Container X/Y positions, door hinge side, shelf thickness, wall thickness, camera and styling are visual defaults. Shelf centers derived using default thickness are not extra measurements. Drawer numbering follows shelf A/B/C orientation: left front-to-back, right back-to-front; this is an explicit assumption.

geometryBasis classifies the required measured/default distinction. Rack-face profiles describe dimensions, not installed inventory or rack-U assignments.

Structural parsing runs at build/test/load time without a database. A separate local-Supabase integration test resolves every code, parent relationship and capability flag and proves all 28 primary bindings.

## Access boundary

Invite-only email/password Auth; public signup and anonymous sign-in disabled. Proxy refreshes verified sessions and preserves refreshed cookie chunks and cache headers. Protected server requests verify Auth identity and current membership, never user-editable role metadata.

Active viewers/staff may read reference data and their own active membership. Nonmembers/inactive members read nothing. RLS independently enforces access. Both application roles are denied direct writes; no application service-role key or placeholder inventory RPC exists.

Email confirmation GET only displays a form. Explicit POST verifies invite/recovery tokens and redirects to a fixed password route. Password setup requires verified Auth but not membership. Recovery responses do not reveal account existence. Server Actions retain Next origin checks; auth responses are private/no-store and token pages use no-referrer policy.

## Preserved later decisions

Later PRs add separate quantity-item/balance and individual-asset models, current-state tables and append-only events, with atomic tested mutation RPCs. No deferred ledger/current-state reconciliation machinery is planned.

Each mutation is one hardened exposed SECURITY DEFINER function authorizing active staff, qualifying objects, using an empty search_path, and granting execution only to authenticated. Idempotency compares normalized validated jsonb equality and replays the original result. Supplied asset tags are normalized unique; serials are indexed and warn on duplicates without hard uniqueness. These are future contracts, not implementations in this PR.
