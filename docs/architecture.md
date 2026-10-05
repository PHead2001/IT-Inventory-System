# Application architecture

Published inventory form revisions, stable custom field identities and bounded custom CSV exports are specified in [published metadata](published-metadata.md).

Operational timestamp rendering and the appended CSV display-zone metadata follow [shared time](shared-time.md). The protected layout supplies one browser-resolved zone after matching UTC server/initial hydration; canonical instants and datetime entry semantics remain unchanged.

Inventory creation and site-opening forms keep per-tab recovery in sessionStorage, scoped by browser origin, backend origin, authenticated actor, inventory kind, site UUID and a distinct opaque draft UUID in the URL. Canonical creation links start a new instance and offer other pending drafts explicitly. Supported router replacement preserves unrelated query and fragment state; Back/Forward, internal return and reload recover the exact instance. Existing-record metadata editors do not use this creation mechanism.

Recovery retains raw core and custom input, touched/cleared distinctions, the original clean baseline, reviewed and prior published form snapshots, raw datetime wall/display timezone, opening quantity, reason and reference. Hydration and binding the durable instance into the canonical URL complete before controls become usable. If supported router navigation is interrupted, the visible recovery retry reopens that same durable UUID; it never enables a stale canonical instance. A failed initial storage write keeps the current in-memory canonical form without changing its route key. Recovered review is invalidated; a changed category schema requires explicit review of updated fields while keeping answers. Strict versioned envelopes accept only bounded JSON and the four matching create/site-open commands; credentials and file bytes are excluded. Limits are 2 MiB UTF-8 per envelope, 8 MiB across 32 instances, with no automatic eviction of pending requests or saved/discarded tombstones. These application ceilings are not a promise of available browser quota.

Before first dispatch, the exact operation, request UUID, actor and payload must be durably stored. Submitted or uncertain saves lock edits and discard, then resolve the same command and request identity. Authentication loss and idempotency/actor conflicts do not prove that a prior save failed. Only a matching definitive rejection returns to editing; only acknowledgement of the matching request writes a saved marker. Saved markers retain the completed request UUID. Terminal markers precede navigation and are rechecked on mount and pageshow; stale writers cannot overwrite them or a newer submitted request. If a completion marker cannot be written, the original durable submitted command remains available for safe retry.

Storage failures retain the current in-memory entries and native refresh/tab-close warnings, explain that browser/internal navigation may lose them, and pause first dispatch until safe request persistence succeeds. Cancel keeps its explicit Discard changes/Keep editing choice; discard must record its terminal marker before leaving. Per-tab recovery does not guarantee recovery after cleared browser data, arbitrarily closed tabs or browser termination.

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

## Private performance telemetry

The protected server layout mounts one `@vercel/speed-insights/next` client wrapper only when `SPEED_INSIGHTS_ENABLED=true` and `VERCEL_ENV` is `preview` or `production`. Local development and CI remain off. The root layout, login, recovery, confirmation, and access-denied pages have no instrumentation mount. On client navigation, `beforeSend` accepts only exact original framework routes and URL paths `/dashboard`, `/inventory`, `/locations`, `/room`, and `/labels`. It rejects scan, record detail, export, auth, unknown and mismatched routes. An auth/token parameter in the event query or fragment rejects the whole event before URL normalization; ordinary search queries/fragments are removed. A metric queued on a protected page is also dropped if the actual browser location has since moved to an auth/unknown path or gained auth/token parameters. The official intake script retains its original route, so both values must be safe before any URL rewrite.

[Vercel documents](https://vercel.com/docs/speed-insights/privacy-policy) that events can include URL, route, and an element selector for Web Vital attribution. Measured surfaces therefore keep DOM IDs and CSS classes free of inventory identifiers and user text. The location picker uses local row ordinals for tree DOM IDs while retaining immutable location IDs in React state and keys. This is a route-scoped performance signal, not user analytics or a substitute for application authorization. No Web Analytics package, custom events, or paid tier is enabled here.

## Inventory Core

Inventory result totals count matching rows, including quantity holdings and unlocated definitions; they are not distinct-item or stock-unit totals. Distinct quantity-item and asset counts are explicitly scoped to the visible page and keyed by kind and UUID. Shared list rows lead with the quantity at that row's real location/site, then label item-wide storage availability and overall assigned/recorded totals separately. Aggregate destinations include descendant rows without inventing one physical holding.

Location status navigation, result scope and CSV links use the same normalized inventory filters. Record-specific history resolves actual kind/name with two bounded caller-RLS `id,name` reads, locks type, and visibly reconciles contradictory links. Invalid, missing, inaccessible or ambiguous records do not broaden to general history. Read failure remains an error. Clearing record scope preserves the normalized type/location filters. An unfiltered empty inventory read may use a single-row all-status search presence probe under the same caller to distinguish first use from historical-only inventory; filtered empty pages never establish catalog absence.

Quantity inventory and serialized assets are separate models. No tracking-type conversion or hard-delete workflow exists.

| Table                     | Current contract                                                                                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| quantity_items            | UUID, name, description, category UUID, optional manufacturer/model and Item code (SKU), archived flag, positive integer version and timestamps. No duplicated total.                                                                                                       |
| stock_balances            | Composite item/location UUID key; nonnegative integer whole-unit quantity. Zero rows may remain but are excluded from ordinary stocked-location results.                                                                                                                    |
| quantity_events           | UUID, item UUID, kind, actor membership UUID/name snapshot, reason, before/after metadata, entity version, timestamp. One event per changed entity version.                                                                                                                 |
| quantity_event_lines      | Event/location composite key, nonzero signed delta, nonnegative before/after counts; after = before + delta. Physical transfers have two opposite lines.                                                                                                                    |
| serialized_assets         | UUID, descriptive/category fields, optional normalized unique asset tag, optional nonunique serial, version and timestamps. Active assets occupy either one eligible storage location or one site; retirement has neither current holding. History retains prior endpoints. |
| asset_events              | UUID, asset UUID, event kind, actor/name snapshot, reason, from/to location UUIDs, before/after metadata, entity version and timestamp.                                                                                                                                     |
| private.mutation_requests | Actor/request UUID composite key, operation, normalized validated request JSONB, original successful result JSONB, creation time. Private transaction reservations may temporarily have null result.                                                                        |

Foreign keys restrict deletion of referenced inventory, locations, categories and actor memberships. Quantities are 0–2,147,483,647 per balance. Item row locking serializes operations across storage and site holdings. Version exhaustion rejects further changed mutations; no-change observations and receipt replay remain possible. `inventory_quantity_totals` reports available storage, assigned site units and their recorded sum as decimal strings. See [custody and locations](custody-and-locations.md) for site workflows and the separate assignment ledger.

Asset tags normalize to lowercase trimmed text; blank becomes null. Uniqueness includes retired assets. Serials trim surrounding whitespace while preserving punctuation and leading zeros; a nonunique lower(serial_number) index supports contextual duplicate checks. Duplicate warnings include name, tag and status and never prevent save. Manufacturer remains optional free-form text.

Quantity Item codes are nullable display identifiers distinct from asset tags and manufacturer part numbers. The database trims Unicode whitespace, maps blank to null, rejects controls and values above 100 Unicode code points, and reserves a case-insensitive PostgreSQL `lower` key across active and archived definitions. It preserves display case, punctuation, and leading zeros. Legacy and v2 quantity create/update plus opening-site creation share this normalizer. An omitted update key preserves the locked current code; explicit null or blank clears it. Only supplied keys are appended to normalized receipt payloads, so historical omitted-key retries retain their exact shape. Code changes join the item's version, before/after history, and receipt in one transaction; stock is unaffected.

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

`quantity_archive` remains a legacy zero-stock-only operation. The explicit `quantity_archive_and_clear` requires `confirm_clear_stock=true`, a reviewed version, and a reason. It atomically zeroes all positive balances (including inactive locations), archives the definition and records one `archived` event with a negative line for each cleared location. `quantity_archive_review(item_id)` supplies the version, per-location counts and total in one security-invoker read snapshot. A concurrent change rejects the confirmation; restore creates no stock and retains the reorder threshold. The new mutation returns decimal-string version and bigint removal total; new application parsers also accept legacy safe-integer versions without rewriting prior receipts.

Each exposed mutation function is one SECURITY DEFINER function: it derives auth.uid(), locks and checks active staff membership before validation/replay, uses an empty search_path with qualified application objects, and contains no dynamic SQL. Only authenticated receives EXECUTE; callers still need active staff membership. Shared private SECURITY INVOKER helpers normalize inputs, validate references and reserve receipts, rather than duplicating a privileged mutation implementation.

All inventory/history tables enable RLS with active viewer/staff SELECT policies. Anonymous, inactive and nonmember users cannot read inventory. Direct mutation-table INSERT/UPDATE/DELETE/TRUNCATE is denied to application roles and service_role. History UPDATE/DELETE triggers also reject privileged edits. Owner-level database maintenance remains outside ordinary application authority.

Idempotency uses JSONB equality, not external canonical hashing. Authorization and scalar validation precede receipt replay; reference eligibility and optimistic version checks follow replay, so a legitimate retry returns the original successful result after later state changes. Concurrent identical actor/request submissions serialize at the receipt key and produce one logical mutation. Reusing a key for a different operation/normalized payload returns idempotency_conflict. Failed transactions leave no committed receipt. UI retries retain the request ID for the same payload and generate another when payload/version changes.

Stable SQLSTATEs P1001–P1012 map respectively to forbidden, stale_version, insufficient_stock, invalid_location, same_location, invalid_quantity, identifier_conflict, invalid_transition, idempotency_conflict, not_found, invalid_category, invalid_input. Unknown failures use a safe retry message; React never parses PostgreSQL message text. Input-validation failures remain distinct from domain/concurrency failures.

### Reads and application boundary

Request-scoped server queries verify Auth/current membership and use the user's Supabase credentials. There is no application administrator client. Security-invoker views preserve caller RLS. inventory_search and inventory_history return bounded JSON pages; inventory_serial_matches returns at most twenty contextual exact serial matches.

Search uses case-insensitive literal substring matching over name, description, manufacturer/model, category, tag/serial and location code/name/breadcrumb. Percent, underscore and backslash are literal characters. Quantity search emits a row per positive location balance, or one unlocated row for a zero-stock definition. Active is the default; archived/retired inventory requires the historical or all filter. Location filters include descendants. Results carry UUID, stable code and breadcrumb for conventional and room navigation.

Search ordering is lower(name), kind, entity UUID, location code. History orders newest timestamp, kind, event UUID. Page size defaults to 25 and database functions cap it at 100; the application fixes it at 25. History displays human event labels, actor snapshots, reasons, location links, quantity before/after/delta and descriptive metadata changes. JSON is not the primary history UI.

Routes are /inventory, /inventory/quantity/new, /inventory/quantity/[id], /inventory/assets/new, /inventory/assets/[id], /locations, /locations/[code], /history. The /room route provides interactive location navigation and inventory context. Search/filter/page state lives in the URL. The shared location picker uses an indented collapsible tree for browsing and flat full-breadcrumb search results; browse mode can select aggregates, while ineligible form ancestors only navigate. Server pages own reads; controlled client forms own pending input and confirmation; Server Actions validate and call the RPC. Viewer pages omit mutation controls and create routes enforce staff membership.

Consequential actions require before/after review. Recoverable errors preserve input. A form's editable values and expected_version share a captured baseline: unrelated prop refreshes must not silently advance its version. Explicit stale refresh adopts the latest baseline, preserves pending input, and requires renewed before/after review. Database version checks remain authoritative.

Quantity movement shows recorded source availability and checks positive whole-unit amounts, source stock, destination eligibility and destination capacity before review. Review is bound to the item, endpoints, amount and recorded version/balances; edits or newly observed relevant revisions invalidate it. Unknown availability cannot authorize review. Move All remains source-scoped, and PostgreSQL locking/version/stock checks remain authoritative after review.

An acknowledged quantity move enters completion. Its receipt reads the exact committed event/entity through the existing caller-scoped history view, validates the conserved two-line transfer, and labels the immutable resulting balances “After this move.” Current stock may change afterward. Failed history reads or cache refreshes preserve acknowledged success and offer receipt/balance reloads. Move more requires a successful fresh authorized snapshot, clears the amount and allocates a new request identity only on a new confirmation. Domain conflicts preserve intent and require deliberate refresh/review; an uncertain response freezes the original payload, actor and request identity for an exact retry.

The verified move snapshot retains its location catalog alongside the item and balances. Pickers, destination eligibility, location names and review identity use that catalog after Move more, balance refresh or invalid-reference recovery, even before route data refreshes. A newly observed route catalog can replace it and invalidates an affected review; reverting route props cannot revive that confirmation.

A bounded per-tab completion pointer stores only event/entity IDs, scoped by browser origin, backend URL, authenticated actor, item and operation. A hard reload verifies that exact history receipt before showing completion or permitting another move; it never reconstructs balances from saved input. Move more clears the pointer only after its fresh read succeeds. Unavailable/quota-exhausted storage retains in-memory success but explicitly limits reload recovery. Cleared browser data and closed-tab recovery are not guaranteed. This pointer does not persist pending or uncertain stock commands across page destruction.

Malformed completion references may be explicitly discarded after a fresh authorized balance read; this discards a browser reference to an acknowledged move and never undoes its history. Valid references whose history cannot currently be verified retain their read-retry barrier. After a lost response, authorization, actor or idempotency rejection before replay does not prove the command failed: the unresolved command stays frozen for the same identity to be retried.

The conventional responsive UI works without WebGL. Scene components emit stable location codes and receive selection/focus state; neither room JSON nor meshes own inventory persistence.

Location selectors share a searchable picker. Browse mode uses stable codes for
navigation and may select aggregate locations; inventory forms retain location
UUIDs and restrict destinations to active inventory holdings. The picker does
not change the server's authoritative eligibility checks or a form's captured
value/version baseline.

## Interactive room

PR3 adds the client-loaded room as a navigation layer over the existing inventory reads. Selection lives in `/room?location=CODE`; aggregate highlighting uses the database hierarchy. See [room navigation](room-navigation.md) for geometry, camera, lifecycle and application contracts.

Logical storage structure is code-managed. Configuration maintainers can change a
location's display name through the narrow, audited `location_rename` operation;
ordinary clients cannot create, delete, reorder, reparent, or alter kind/capability/
active state. Trusted reference-data/migration tooling keeps those structural
responsibilities. Existing records and inventory-only office placeholders remain.
Current authorized names take precedence over static room interaction label text
and registered space names by stable location code; coordinates, geometry, binding
identity and historical snapshots remain independent. See [custody and locations](custody-and-locations.md)
for lifecycle, concurrency, replay and fixture contracts.

Guided is the default camera mode, constraining both azimuth and elevation; returning from Free Orbit clamps both to their nearest allowed values. Free Orbit allows unrestricted horizontal rotation and viewing above or below the room, with a small pole epsilon to avoid the numerical singularity and no camera roll. Recenter restores the room overview target while preserving angle and zoom; Fit room reframes against the available canvas; Center selected follows the existing primary and aggregate focus bindings. Tilt up/down controls complement camera rotation. Location labels appear on hover by default, with a Show all labels toggle; touch selection remains available through the conventional location panel.

## Labels, scanning and low stock

See [labels, scanning and stock status](labels-and-stock.md) for the durable payload, route, threshold, dashboard and export contracts. Stable location codes and asset UUIDs form label destinations; labels confer no access. The label and scan path uses ordinary authenticated application routes and the existing membership/RLS boundary. QR generation is local to the application. Camera access is user-initiated, and scan content is validated before normal application navigation. If production `APP_ORIGIN` is missing, label generation and absolute-URL scans fail closed; internal relative paths and identifier payloads remain usable.

Quantity definitions may carry a nullable whole-unit reorder threshold. Low-stock state is derived from the sum of all current balances, including balances at inactive locations; it is not a second mutable inventory ledger. Dashboard, inventory filter and CSV export share this meaning. Quantity detail reads its authoritative `stockSummary` separately from editable item metadata and the metadata version baseline. Threshold changes extend existing metadata/history mutations without creating stock movement events. The database read contracts are `inventory_search_v2`, `low_stock_dashboard`, and `inventory_export_snapshot`; export snapshots are single-query, bounded to 10,000 rows, and report overflow explicitly. The low-stock CSV includes all current holdings and locations for each selected definition even when filters match a subset of holdings.

## Configuration categories and label defaults

The Settings route is readable by active members. Category and shared label-default writes require an active staff membership with `app_members.can_manage_configuration=true`; the flag is provisioned outside the application and cannot be self-granted through the Data API or JWT claims. Existing memberships default to false. The database owns this check in each exposed configuration RPC, and the application repeats it for early feedback. `configuration_events` is append-only and member-readable.

Category UUID and code are permanent. Active names are unique after case folding and whitespace normalization. A category has a bigint version, exposed as a decimal string, and a `removed_at` tombstone for historical references. Seeded categories, including Other, follow the same lifecycle; migrations do not reseed them after removal. New configurations expose decimal-string versions and affected counts; application parsing accepts legacy safe integer inputs. Existing inventory integer version, quantity and receipt contracts remain compatible.

`category_removal_review` records a 15-minute, actor-bound token containing the source, optional replacement, both category versions, exact current quantity/asset IDs and versions, and distinct historical-only inventory reference counts. It includes archived definitions and retired assets. `category_remove` locks the catalog exclusively, rechecks the reviewed references, historical counts and versions under READ COMMITTED, requires an active replacement for current or historical inventory references, and reassigns at most 10,000 current records in one transaction. Each reassignment increments its entity version and writes a descriptive metadata event with category-name snapshots; it creates no stock movement line. Existing stock, tags, locations, extension data and identity remain on the original entity. A category with current or historical inventory references is tombstoned. A truly unreferenced category may be deleted while its configuration audit event remains; a category's own creation/configuration event alone does not prevent deletion. Unchanged or failed requests do not leave partial updates or receipts.

Inventory create, metadata update and restore RPCs take a shared advisory catalog lock after authorized receipt replay and before category/entity reads. Category lifecycle RPCs take its exclusive form. Stock-only mutations keep their entity row locks without a catalog lock. These functions reject fresh Repeatable Read and Serializable transactions; successful completed receipt replay remains available under those modes. Lock wait is bounded to two seconds. The new category RPCs declare a five-second `statement_timeout` for PostgREST to hoist before the main RPC statement; runtime certification verifies this with a delayed Data API call. The 10,000-record cap is a maximum, not a guarantee of completion before the time budget.

Shared label defaults cover the current 90×50/70×35 mm size, US Letter/A4 page and QR/Code 128 format choices. The print page starts from these defaults, while each print session can choose differently. The future custom-fields engine, designer and file schema are separate work. This slice preserves inventory rows and their extension point but creates no custom-field tables or forms.
