# Application architecture

The approved v0.1 plan and amendments govern Foundation and Inventory Core. PR3 implements the R3F room navigation surface.

## System boundaries

Next.js App Router serves the operational dashboard. Request-scoped Supabase clients use the signed-in user's credentials. PostgreSQL owns logical data; Git owns geometry. The scene emits location codes and receives selection/focus state; it never owns persistence. Conventional workflows remain independent of 3D.

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
- Box nodes may define interaction targets. Groups may bind aggregate location codes for picker selection, focus and descendant highlighting; the schema rejects selectable group targets while allowing nonselectable group focus metadata.
- interaction.focusPoint is **parent-local**.
- interaction.hitBox.center is **node-local**, rotating with its node.
- The renderer maps positions [x,y,z]→[x,z,-y] and sizes [x,y,z]→[x,z,y].
- Node IDs have no persistence meaning. locationCode is the logical bridge.
- Every destination has one primary binding; aggregate bindings preserve ancestry.
- JSON contains neither inventory state nor generated database UUIDs.

Room/opening/rack dimensions and positions, shelving spans/depths/top elevations, sections, drawers, and container dimensions are measured. Container X/Y positions, door hinge side, shelf thickness, wall thickness, camera and styling are visual defaults. Shelf centers derived using default thickness are not extra measurements. Drawer numbering follows shelf A/B/C orientation: left front-to-back, right back-to-front; this is an explicit assumption.

geometryBasis classifies the required measured/default distinction. Rack-face profiles describe dimensions, not installed inventory or rack-U assignments.

Structural parsing runs at build/test/load time without a database. A separate local-Supabase integration test resolves every code, parent relationship and capability flag and proves all 28 primary bindings.

## Access boundary

Invite-only email/password Auth; public signup and anonymous sign-in disabled. Proxy refreshes verified sessions and preserves refreshed cookie chunks and cache headers. Protected server requests verify Auth identity and current membership, never user-editable role metadata.

Active viewers/staff may read reference data and their own active membership. Nonmembers/inactive members read nothing. RLS independently enforces access. Both application roles are denied direct writes. Inventory Core adds authorized mutation RPCs; the application still has no service-role key.

Email confirmation GET only displays a form. Explicit POST verifies invite/recovery tokens and redirects to a fixed password route. Password setup requires verified Auth but not membership. Recovery responses do not reveal account existence. Server Actions retain Next origin checks; auth responses are private/no-store and token pages use no-referrer policy.

## Inventory Core

Quantity inventory and serialized assets are separate models. No tracking-type conversion or hard-delete workflow exists.

| Table                     | Current contract                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| quantity_items            | UUID, name, description, category UUID, optional manufacturer/model, archived flag, positive integer version and timestamps. No duplicated total.                                                                     |
| stock_balances            | Composite item/location UUID key; nonnegative integer whole-unit quantity. Zero rows may remain but are excluded from ordinary stocked-location results.                                                              |
| quantity_events           | UUID, item UUID, kind, actor membership UUID/name snapshot, reason, before/after metadata, entity version, timestamp. One event per changed entity version.                                                           |
| quantity_event_lines      | Event/location composite key, nonzero signed delta, nonnegative before/after counts; after = before + delta. Physical transfers have two opposite lines.                                                              |
| serialized_assets         | UUID, descriptive/category fields, optional normalized unique asset tag, optional nonunique serial, required location UUID, active/retired status, version and timestamps. Retired assets retain last-known location. |
| asset_events              | UUID, asset UUID, event kind, actor/name snapshot, reason, from/to location UUIDs, before/after metadata, entity version and timestamp.                                                                               |
| private.mutation_requests | Actor/request UUID composite key, operation, normalized validated request JSONB, original successful result JSONB, creation time. Private transaction reservations may temporarily have null result.                  |

Foreign keys restrict deletion of referenced inventory, locations, categories and actor memberships. Quantities are 0–2,147,483,647 per balance. Item row locking serializes operations across all of its balances. Version exhaustion rejects further changed mutations; no-change observations and receipt replay remain possible. Totals are computed from balances.

Asset tags normalize to lowercase trimmed text; blank becomes null. Uniqueness includes retired assets. Serials trim surrounding whitespace while preserving punctuation and leading zeros; a nonunique lower(serial_number) index supports contextual duplicate checks. Duplicate warnings include name, tag and status and never prevent save. Manufacturer remains optional free-form text.

### Mutation contract

Each exposed mutation accepts p_request_id UUID and p_payload JSONB and returns entity_id, version, event_id (nullable for no-change), changed. Existing-entity payloads include item_id or asset_id plus expected_version.

| RPC                    | Payload and behavior                                                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| quantity_create        | name, category_id, optional description/manufacturer/model; initial_quantity defaults to zero, optional initial_location_id. Positive stock requires a valid location; supplied zero-stock location is validated but creates no balance. Definition and creation history commit together. |
| quantity_receive       | location_id, positive quantity, required reason. Adds stock at one eligible location and records the addition.                                                                                                                                                                            |
| quantity_move          | source_location_id, destination_location_id, positive quantity OR move_all=true, optional reason. Source must have stock; destination must differ and be eligible. Move All consumes only the selected source balance.                                                                    |
| quantity_adjust        | location_id, absolute observed_quantity, required reason. Computes signed delta from locked state. An equal count returns changed=false and event_id=null with no version/history increment.                                                                                              |
| quantity_update        | Full descriptive/category metadata. Preserves before/after values. Archived definitions cannot be edited.                                                                                                                                                                                 |
| quantity_archive       | Required reason; succeeds only when every balance is zero.                                                                                                                                                                                                                                |
| quantity_restore       | Required reason; restores the definition without creating stock.                                                                                                                                                                                                                          |
| asset_create           | Metadata, optional asset_tag/serial_number, eligible location_id. Creates one active asset and history atomically.                                                                                                                                                                        |
| asset_move             | Different eligible location_id, optional reason; physical move, active assets only.                                                                                                                                                                                                       |
| asset_correct_location | Different eligible location_id, required reason; distinct recorded-location correction, active assets only.                                                                                                                                                                               |
| asset_update           | Full metadata and identifiers, with before/after history. Retired asset metadata may be corrected.                                                                                                                                                                                        |
| asset_retire           | Required reason; active to retired, retaining location.                                                                                                                                                                                                                                   |
| asset_restore          | Explicit eligible location_id and required reason; retired to active.                                                                                                                                                                                                                     |

Destinations require active=true and can_hold_inventory=true, independently of kind. Existing stock can be evacuated from an inactive source. Reference eligibility is locked while mutating. Categories must be active on creation/change; an unchanged inactive category may be retained during a metadata edit.

Every changed mutation checks the locked entity's expected_version and increments once. Current state, history lines, actor snapshot and receipt commit in the same PostgreSQL transaction. Any failure rolls everything back. No deferred reconciliation trigger, latest-event check, or separate ledger projection exists.

Each of the thirteen mutation functions is one exposed SECURITY DEFINER function: it derives auth.uid(), locks and checks active staff membership before validation/replay, uses an empty search_path with qualified application objects, and contains no dynamic SQL. Only authenticated receives EXECUTE; callers still need active staff membership. Shared private SECURITY INVOKER helpers normalize inputs, validate references and reserve receipts, rather than duplicating a privileged mutation implementation.

All inventory/history tables enable RLS with active viewer/staff SELECT policies. Anonymous, inactive and nonmember users cannot read inventory. Direct mutation-table INSERT/UPDATE/DELETE/TRUNCATE is denied to application roles and service_role. History UPDATE/DELETE triggers also reject privileged edits. Owner-level database maintenance remains outside ordinary application authority.

Idempotency uses JSONB equality, not external canonical hashing. Authorization and scalar validation precede receipt replay; reference eligibility and optimistic version checks follow replay, so a legitimate retry returns the original successful result after later state changes. Concurrent identical actor/request submissions serialize at the receipt key and produce one logical mutation. Reusing a key for a different operation/normalized payload returns idempotency_conflict. Failed transactions leave no committed receipt. UI retries retain the request ID for the same payload and generate another when payload/version changes.

Stable SQLSTATEs P1001–P1012 map respectively to forbidden, stale_version, insufficient_stock, invalid_location, same_location, invalid_quantity, identifier_conflict, invalid_transition, idempotency_conflict, not_found, invalid_category, invalid_input. Unknown failures use a safe retry message; React never parses PostgreSQL message text. Input-validation failures remain distinct from domain/concurrency failures.

### Reads and application boundary

Request-scoped server queries verify Auth/current membership and use the user's Supabase credentials. There is no application administrator client. Security-invoker views preserve caller RLS. inventory_search and inventory_history return bounded JSON pages; inventory_serial_matches returns at most twenty contextual exact serial matches.

Search uses case-insensitive literal substring matching over name, description, manufacturer/model, category, tag/serial and location code/name/breadcrumb. Percent, underscore and backslash are literal characters. Quantity search emits a row per positive location balance, or one unlocated row for a zero-stock definition. Active is the default; archived/retired inventory requires the historical or all filter. Location filters include descendants. Results carry UUID, stable code and breadcrumb for conventional and room navigation.

Search ordering is lower(name), kind, entity UUID, location code. History orders newest timestamp, kind, event UUID. Page size defaults to 25 and database functions cap it at 100; the application fixes it at 25. History displays human event labels, actor snapshots, reasons, location links, quantity before/after/delta and descriptive metadata changes. JSON is not the primary history UI.

Routes are /inventory, /inventory/quantity/new, /inventory/quantity/[id], /inventory/assets/new, /inventory/assets/[id], /locations, /locations/[code], /history. The /room route provides interactive location navigation and inventory context. Search/filter/page state lives in the URL. The shared location picker uses an indented collapsible tree for browsing and flat full-breadcrumb search results; browse mode can select aggregates, while ineligible form ancestors only navigate. Server pages own reads; controlled client forms own pending input and confirmation; Server Actions validate and call the RPC. Viewer pages omit mutation controls and create routes enforce staff membership.

Consequential actions require before/after review. Recoverable errors preserve input. A form's editable values and expected_version share a captured baseline: unrelated prop refreshes must not silently advance its version. Explicit stale refresh adopts the latest baseline, preserves pending input, and requires renewed before/after review. Database version checks remain authoritative.

The conventional responsive UI works without WebGL. Scene components emit stable location codes and receive selection/focus state; neither room JSON nor meshes own inventory persistence.

Location selectors share a searchable picker. Browse mode uses stable codes for
navigation and may select aggregate locations; inventory forms retain location
UUIDs and restrict destinations to active inventory holdings. The picker does
not change the server's authoritative eligibility checks or a form's captured
value/version baseline.

## Interactive room

PR3 adds the client-loaded room as a navigation layer over the existing inventory reads. Selection lives in `/room?location=CODE`; aggregate highlighting uses the database hierarchy. See [room navigation](room-navigation.md) for geometry, camera, lifecycle and application contracts.

Guided is the default camera mode, constraining both azimuth and elevation; returning from Free Orbit clamps both to their nearest allowed values. Free Orbit allows unrestricted horizontal rotation and viewing above or below the room, with a small pole epsilon to avoid the numerical singularity and no camera roll. Recenter restores the room overview target while preserving angle and zoom; Fit room reframes against the available canvas; Center selected follows the existing primary and aggregate focus bindings. Tilt up/down controls complement camera rotation. Location labels appear on hover by default, with a Show all labels toggle; touch selection remains available through the conventional location panel.

## Labels, scanning and low stock

See [labels, scanning and stock status](labels-and-stock.md) for the durable payload, route, threshold, dashboard and export contracts. Stable location codes and asset UUIDs form label destinations; labels confer no access. The label and scan path uses ordinary authenticated application routes and the existing membership/RLS boundary. QR generation is local to the application. Camera access is user-initiated, and scan content is validated before normal application navigation. If production `APP_ORIGIN` is missing, label generation and absolute-URL scans fail closed; internal relative paths and identifier payloads remain usable.

Quantity definitions may carry a nullable whole-unit reorder threshold. Low-stock state is derived from the sum of all current balances, including balances at inactive locations; it is not a second mutable inventory ledger. Dashboard, inventory filter and CSV export share this meaning. Quantity detail reads its authoritative `stockSummary` separately from editable item metadata and the metadata version baseline. Threshold changes extend existing metadata/history mutations without creating stock movement events. The database read contracts are `inventory_search_v2`, `low_stock_dashboard`, and `inventory_export_snapshot`; export snapshots are single-query, bounded to 10,000 rows, and report overflow explicitly. The low-stock CSV includes all current holdings and locations for each selected definition even when filters match a subset of holdings.

## Configuration categories and label defaults

The Settings route is readable by active members. Category and shared label-default writes require an active staff membership with `app_members.can_manage_configuration=true`; the flag is provisioned outside the application and cannot be self-granted through the Data API or JWT claims. Existing memberships default to false. The database owns this check in each exposed configuration RPC, and the application repeats it for early feedback. `configuration_events` is append-only and member-readable.

Category UUID and code are permanent. Active names are unique after case folding and whitespace normalization. A category has a bigint version, exposed as a decimal string, and a `removed_at` tombstone for historical references. Seeded categories, including Other, follow the same lifecycle; migrations do not reseed them after removal. New configurations expose decimal-string versions and affected counts; application parsing accepts legacy safe integer inputs. Existing inventory integer version, quantity and receipt contracts remain compatible.

`category_removal_review` records a 15-minute, actor-bound token containing the source, optional replacement, both category versions, and the exact quantity/asset IDs and versions. It includes archived definitions and retired assets. `category_remove` locks the catalog exclusively, rechecks every reviewed reference and version under READ COMMITTED, requires an active replacement for referenced categories, and reassigns at most 10,000 records in one transaction. Each reassignment increments its entity version and writes a descriptive metadata event with category-name snapshots; it creates no stock movement line. Existing stock, tags, locations, extension data and identity remain on the original entity. A category with current or historical inventory references is tombstoned. A truly unreferenced category may be deleted while its configuration audit event remains. Unchanged or failed requests do not leave partial updates or receipts.

Inventory create, metadata update and restore RPCs take a shared advisory catalog lock after authorized receipt replay and before category/entity reads. Category lifecycle RPCs take its exclusive form. Stock-only mutations keep their entity row locks without a catalog lock. These functions reject fresh Repeatable Read and Serializable transactions; successful completed receipt replay remains available under those modes. Lock wait is bounded to two seconds. The new category RPCs declare a five-second `statement_timeout` for PostgREST to hoist before the main RPC statement; runtime certification verifies this with a delayed Data API call. The 10,000-record cap is a maximum, not a guarantee of completion before the time budget.

Shared label defaults cover the current 90×50/70×35 mm size, US Letter/A4 page and QR/Code 128 format choices. The print page starts from these defaults, while each print session can choose differently. The future custom-fields engine, designer and file schema are separate work. This slice preserves inventory rows and their extension point but creates no custom-field tables or forms.
