# Managed locations and site custody

`locations` are logical IT storage. `sites` identify deployed equipment custody;
they have no 2.5D room geometry. The office seed codes `ITO` and `ITO-GENERAL`
mean **IT Office** and provisional **General Storage / Unsorted**. These are
software labels, not measured furniture. The Git room model remains bound only to
its stable closet codes. Location and site UUIDs/codes are immutable and never
recycled; names and notes can change without changing inventory identity.

Active staff with `can_manage_configuration=true` can call `location_rename`,
`site_create`, `site_update` (metadata only), and `site_set_active`. An active staff member can
change custody. Active members read locations, sites, holdings and history under
RLS. Ordinary authenticated roles cannot write any of those tables directly.
The owner provisions configuration maintainers using a verified Auth UUID and a
read-first membership check; no first-user, email, or fixture promotion occurs.

## Current state and accounting

`stock_balances` contains stored quantities only. `site_quantity_holdings`
contains assigned quantities only. A serialized asset has one active custody:
exactly one `location_id` or `site_id`; retired assets have no site custody and
their retained `location_id`, if any, means last recorded storage, not current
custody. `inventory_quantity_totals` exposes UTF-8 decimal strings for
`available_quantity` (all storage, including inactive locations),
`assigned_quantity`, and `recorded_quantity` (the sum). Its stock state uses
available storage with the existing null/zero/inclusive threshold rules.
Clients never convert aggregate totals or new version strings through JavaScript
`Number`; bounded individual balances remain integer numbers.

`quantity_site_change` accepts `action=issue|return|transfer|opening|correct|write_off`.
It requires `item_id` and a canonical-string or legacy safe-integer
`expected_version`. Issue names `source_location_id`, `destination_site_id`, and
positive `quantity`; return names `source_site_id`, `destination_location_id`,
and positive `quantity`; transfer names two distinct site IDs and positive
`quantity`. Opening against an existing definition names only
`destination_site_id` and positive `quantity`; it creates assigned stock
without inventing a past storage issue or requiring newly published descriptive
fields on an otherwise unchanged definition. Correction names one `source_site_id`, nonnegative
`observed_quantity`, and a reason. Write-off names `source_site_id`, positive
`quantity`, and a reason. Optional `reference` is a concise external ticket number
reference. A correction is visibly distinct from physical movement. No browser
loop performs partial operations: one RPC updates all involved holdings, bumps
the definition version once, appends a quantity event, storage/site delta lines,
and a linked assignment event, then completes the idempotency receipt.

`asset_site_change` accepts `action=assign|return|transfer|correct|write_off|retire`
with `asset_id`, expected version, and source/destination IDs corresponding to
the action. Asset correction changes the recorded site to a different site with
a mandatory reason and distinct correction event; it does not claim a physical
transfer. Loss/write-off and site retirement require reasons and close active
custody. `asset_site_open` and `quantity_site_open` create a new record already
held at an active site. They require a current published-form revision and
validate custom metadata by the same database validator used for ordinary v2
creation. Openings have one version-one event and do not invent an earlier closet
balance or a historical issue date. All event timestamps are server timestamps.

These RPCs return the established `entity_id`, decimal-string `version`,
`event_id`, `changed` envelope. Exact successful retry returns the saved result
after current membership authorization; a different payload with the same
request ID fails. Current-state and history changes roll back together on an
error. The linked `assignment_events` row retains endpoint IDs, display-name
snapshots, actor, reason and reference. Deferred database constraints require a
linked assignment for every `site_*` inventory event; site quantity delta lines
retain before/after counts. Normal history is append-only.

Site reads use `site_current_holdings` for quantity product counts and distinct
serialized asset IDs, `assignment_events` for date-filtered detail, and
`site_activity_summary(site_id, from, until)` for separately named quantity
units and serialized event/unique-device counts. Its time range is `[from,
until)`, while current holdings remain current regardless of historical filter.
Gross storage issues exclude opening entries and site-to-site transfers; the
report never sums unlike product units into an unexplained equipment count.

## Lifecycle and lock order

Storage structure is maintained through reviewed room/reference-data code and
repository migrations. Settings offers only a display-name rename. There are no
ordinary-client create, reparent, reorder, kind, capability, active-state or delete
controls, including for existing unmodeled locations. Legacy `location_create` and
`location_update` RPC execution is revoked from PUBLIC, anon, authenticated and
service_role; trusted SQL fixture/migration tooling maintains structure directly.
`location_rename` accepts only location ID, captured expected version and name. It
checks active configuration membership before replay, takes the exclusive placement
lock before the row lock, and commits a versioned configuration event and receipt
atomically. UUID, code, parent, kind, capability, active state, order, holdings and
historical snapshots stay intact. Current authorized location names override static
scene label text, accessible labels and hover tooltips by stable location code.
Geometry and camera bindings remain static. The office placeholders remain valid.

Sites retain their separate lifecycle. Manage sites is reachable from the site list
and site detail offers explicit Archive site / Restore site actions. Confirmation
names the property, retains identity/history, requires a reason, and links current
holdings to their inventory records. `site_set_active` sends only site ID, captured
expected version, requested active state and reason. Existing topology triggers and
the exclusive/shared placement barrier atomically reject archives with holdings or
racing assignments. No equipment is moved, written off or deleted automatically.
Archived sites are omitted from ordinary destinations and active lists; archived/all
filters and historical links retain access. Restore does not recreate assignments.
New legacy `site_update` requests may edit metadata only when active is unchanged;
changed-active payloads return `use_site_lifecycle` so callers upgrade to the reasoned
operation. Previously completed requests still replay after current authorization.
Old event rows retain null reasons rather than invented history.

Management drafts retain the baseline captured with their values. Clean refreshes
adopt values and baseline together; dirty settings cannot acquire a newer version
without discarding edits explicitly with Cancel. A confirmed save establishes its
matching saved baseline immediately. An uncertain result freezes edits and retries
the exact command and request ID even if a refresh arrives. Synchronous duplicate
submissions are suppressed, and routes scope drafts to actor plus record identity.

Fresh mutations use READ COMMITTED. The order is active membership row,
normalized receipt, catalog guard when applicable, placement guard, then
category/schema, inventory and destination rows. Stock-only operations do not
take the catalog guard. An exclusive placement guard covers location/site
lifecycle and is also acquired by the underlying topology statement triggers,
including privileged direct location changes. The catalog helper briefly takes
a shared placement guard for catalog writers that may touch inventory references;
this preserves lock order without copying legacy RPC implementations. The
placement wait budget is two seconds; a timeout rolls back the receipt and all
changes. The service role has narrowly scoped execution on the placement helper
because its direct topology fixtures use invoker triggers; ordinary clients do
not. Production mutation paths remain authenticated staff/maintainer RPCs.

## Read and UI contract

Search, detail, labels, low-stock and export must use independently aggregated
storage/site holdings to avoid join multiplication. Site filter selects current
holdings but low-stock remains item-wide storage availability. Export rows must
identify custody kind and site/location UUID while retaining existing byte,
snapshot, formula and private-read bounds. Stable item/asset QR identities do
not change during assignment or rename. Show-in-room is offered only for codes
actually bound in the closet JSON; office and site views use conventional
navigation with a clear unmodeled explanation.

Ordinary inventory CSV retains its legacy columns and omits
`recorded_total`. The named `available_quantity`, `assigned_quantity`, and
`recorded_quantity` totals describe the whole quantity definition, so they appear
only on its first deterministic exported holding row; later holding rows leave
those cells empty. A site or location filter still includes the totals once per
selected definition. Low-stock export remains one row per definition and keeps
its existing `recorded_total` column.

`location_configuration_events` and `site_configuration_events` record
before/after configuration changes without pretending they were inventory
movements. Historical IDs and event snapshots remain readable after renames or
deactivation. A production maintainer grant and production migration remain
separate owner-controlled release actions.

## Detail task workspace

Staff record details use one lazy-mounted task workspace beside stock and custody.
Ordinary tasks remain visible; opening holdings and consequential lifecycle tasks
use secondary groups. Opening holdings describe equipment already at a site.
Viewers retain readable stock, files and history without mutation launchers.

Switching or closing an untouched task is immediate. Dirty drafts require Stay or
an explicit discard. Pending and unconfirmed transactions block task switching;
retry replays the exact captured actor, command, version and request identity even
if current holdings change. A refreshed lifecycle can remove a launcher without
unmounting its existing unresolved transaction. Auth or retry-identity rejection
cannot establish failure of an earlier unknown attempt. Confirmed results remain
visible until New transaction; quantity moves retain their explicit Move more
and durable receipt recovery flow. Reviewed refresh after a definitive stale
rejection preserves entered values.

Asset detail has one primary identifier/custody summary. Retired custody is labelled
last recorded custody. Recent events are compact rows with native expandable full
before/after values and existing bounded custom snapshot links; historical labels
come from the original read model rather than current record fields.
