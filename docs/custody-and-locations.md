# Managed locations and site custody

Receive initializes its destination only when exactly one positive holding is
eligible under the current destination picker. Zero or multiple eligible holdings
leave it blank. Restore retains its separate eligible recorded-location default.
These defaults are initial task values; refreshed balances never overwrite a
manual destination or clear it by choosing a replacement.

An active site-assigned asset's Return task can suggest storage from its current
assignment episode. The server uses the caller's membership/session and RLS to
read one `asset_events` boundary for that asset at or before its current version,
ordered by version descending, excluding metadata updates, site transfers and
site corrections. It does not search the last 25 assignment events. The latest
`site_assigned` boundary supplies its recorded source location after an authorized
eligibility lookup (`active && can_hold_inventory`). `site_opened` has no storage
origin; missing, malformed or other boundaries stay unavailable rather than
falling back to an older episode. Ineligible origins and transport failures have
separate explanations. The suggestion records asset UUID/version, source event
UUID, destination UUID and status. These identifiers remain internal.

The Return form verifies identity, version and current picker eligibility when
reconciling refreshed suggestions. A successful same-version origin read can
recover an initial read failure and fill an untouched destination.
If a later same-version origin read fails, the last verified suggestion,
destination and clean baseline remain intact, with an explicit read-error
explanation and no retained confirmation. Only a definitive successful read can
replace that suggestion, including a verified absence of an eligible origin.
The recovered destination also updates only that field's clean task baseline,
so an automatic default leaves a pristine task clean while entered reasons,
references and other manual changes remain dirty. Manual choices
and Clear destination survive refresh and explicit stale-form review, including
an explicit clear while the origin read was unavailable. A refreshed record
version blocks submission until explicit Review latest holdings adopts that
baseline; only then does its suggestion update the explanation and untouched
destination. A changed suggestion invalidates any existing confirmation before
submission. Pending, uncertain and completed operations retain their original
suggestion, and another actor's refresh cannot reconcile the draft. The origin
explanation describes the suggestion for the adopted baseline even after a staff
member chooses another destination. Move stock and Issue stock source options
show that item's current available units in both tree and search views before
selection; refreshed amounts
do not select a different source. Existing authoritative stock/version checks
remain the mutation boundary.
Move availability follows current reads while the entered move retains its
original version and review context. Changed stock invalidates confirmation;
only an explicit verified refresh followed by review adopts a new baseline.
A depleted or missing source stays selected and unavailable rather than being
replaced. Positive holdings at inactive storage remain valid evacuation sources.

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

### Browsing inventory and location settings

Inventory's primary count is matching server rows across all pages. The current
page breakdown partitions those rows into quantity holdings (storage or assigned
site), quantity definitions without stock, and individual assets. Distinct quantity
products on the page are an overlapping statistic and are never added to the row
breakdown. Quantities, availability, assignments and recorded totals keep their
separate units. CSV and applied filter chips use the committed server search scope.

Text search applies after 250 ms, replacing the evolving URL. Explicit Search and
select-filter choices push a navigable history entry and reset pagination. Composition
does not dispatch intermediate input. Next.js App Router arbitrates navigation
responses; the stable search island retains newer unsent text across an earlier
response, and Back/Forward restores controls from the URL. During navigation, the
status announces that displayed rows and CSV retain their prior applied scope.
No additional full-catalog client read is used. Custom answer previews are bounded
typed display values, with a detail link for the full record.

The shared picker uses the existing authorized hierarchy and eligibility rules;
its group counts describe nested/eligible locations, never inventory. Desktop panels
match the trigger width, clamp to the viewport, and flip above the label when needed.
Phones retain the established sheet. Settings reuses picker sorting and full-path
search for an indented tree with Arrow/Home/End navigation and links to existing
location details. Permanent codes remain visible. Rename keeps its existing
configuration-maintainer gate; there are no structure, reparent or sort controls.

Active siblings must have distinct display names under `lower(btrim(name))`:
leading/trailing spaces and case do not distinguish names. Root locations share
the same null-parent scope; matching names under different parents remain valid.
Authoritative uniqueness protects concurrent renames without changing UUIDs,
permanent codes or historical labels. Migration preflight reports any existing
collision by code and stops; a maintainer must explicitly correct the names.
Inactive duplicates may remain, but activation requires a distinct sibling name.

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

Activity filters validate both client input and direct URLs. Malformed dates and
non-increasing two-sided ranges retain the site shell and current holdings, show
field-associated guidance, and suppress activity rows and dated metrics until
corrected. One-sided ranges remain supported. Explicit instants support at most
six fractional-second digits (PostgreSQL microsecond precision); longer fractions
receive actionable validation guidance rather than silent rounding. UTC offset
normalization preserves those digits, and range ordering compares exact instants.
The same inclusive/exclusive bounds reach both event rows and summary metrics.
Legacy offset-less minute-precision date/time URLs still mean UTC. Today,
Yesterday and Last 7 days use the browser's existing named
display timezone (with an explicit UTC choice) and calendar midnight boundaries,
including daylight-saving changes. Apply stores explicit UTC instants in the URL;
refresh never recalculates an applied preset. Applied ranges reload as Custom and
display their inclusive From and exclusive Until boundaries with the named zone.
Holdings and activity filters retain one another's URL context.

Acknowledged custody changes render a receipt independently of refreshed source
eligibility. The receipt reads the exact RPC event/entity link from
`assignment_events` and immutable storage/site event lines using the caller's
session and RLS. Endpoint names, actor, reference and time come from the event;
the record name is identified as the name reviewed for this operation. Resulting
balances are labelled as balances after that event, including zero after the last
unit leaves. Site quantity count corrections show the immutable event line's
count before, signed adjustment, and observed count after correction, without a
transfer arrow. Older cached receipts without those line details explicitly show
that correction count details are unavailable. History summaries also distinguish
count corrections from transfers when older history lacks a site event-line count
snapshot; they do not infer a signed adjustment from an unsigned quantity. These
labels do not change accounting or mutation semantics. No current holdings read
reconstructs a receipt. Receipt/cache
failure preserves known success and event identity, with a separate exact-event
reload action after current actor and active membership checks. Done closes the
task without another write. Starting another operation requires the acknowledged
version to match refreshed route data, then initializes new editable state and a
new request identity. Unknown outcomes retain the original actor, payload,
version and request ID for exact replay; authorization errors during uncertain
retry cannot establish that the original operation failed.

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

Site create/edit/lifecycle recovery uses bounded, versioned per-tab session records
scoped by origin, public backend origin, actor, site and draft identity. A canonical
`siteDraft` UUID in the create URL distinguishes separate Add site instances.
Recovery whitelists site baselines, entered values, lifecycle reasons and exact
submitted commands; it retains no credentials, files or signed URLs. Stored
expected versions remain original after navigation and reload. Compare-and-swap
writes reject stale mounts; submitted commands cannot be discarded or replaced
until the matching outcome is known. Known completion records prevent a reload
from reopening the completed create as an editable submission. Site creation
offers View site and Add another; only Add another starts a clean draft with a new
identity. Recovery capacity or storage failures pause submission and expose an
honest retry message. Browser reload/closure uses the native unsaved-entry warning;
app links are blocked if a dirty draft could not be retained. Cleared browser data
and closed-tab recovery are not guaranteed.
When capacity is needed, only fully verified saved or discarded envelopes may be
reclaimed. Editing, submitted and invalid recovery data remain intact. A stale
mounted form cannot recreate a reclaimed envelope using its former baseline.

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
visible with operation-specific completion actions; custody provides Done and a
deliberate new-operation action. Quantity moves retain their explicit Move more
and durable receipt recovery flow. Reviewed refresh after a definitive stale
rejection preserves entered values.

Site detail leads with compact, separately labelled current quantity and individual
asset totals. Grouped holdings and every activity metric remain accessible in
expandable sections. Site emptiness uses unfiltered authoritative current totals,
not a filtered page. Filter exclusions and out-of-range pages offer recovery;
archived sites and viewers receive appropriate non-mutation guidance. Active staff
can enter Issue existing stock at `/scan?mode=assign&site=<UUID>`; opening-new-record
actions remain secondary and do not represent a past storage issue. Opening this
entry link does not mutate inventory.

## Scan and assign

`/scan` remains a read-only scan-to-open workflow. Active staff enter assignment
explicitly at `/scan?mode=assign`, optionally with an active destination site's
UUID in `site`. The loader validates that selection; unavailable or archived
destinations require a new active choice. Camera frames, pasted label text,
keyboard scanners, exact quantity codes and inventory search all enter the same
existing-record inspection. Outer scanner whitespace is trimmed; internal
identifier content is preserved. Locations, unknown labels and ambiguous matches
never cause a write or create a record.
Search uses the existing caller-scoped record-level read, which deduplicates typed
inventory identities before its 25-record pagination. Explicit Previous/Next
candidate controls retain the destination and ticket. Responses from an earlier
page or context cannot replace a newer inspection.

The batch retains its named destination, optional ticket and selected source
preference while the actor and backend remain unchanged. Each inspection captures
the record version and storage availability. Multiple sources require an explicit
choice, quantities default to one whole unit, and existing stock may leave an
inactive storage source. Already assigned, retired, archived or depleted records
explain why assignment is unavailable. Returning or transferring equipment uses
the ordinary custody workflow.

Confirm assign submits the existing `quantity_site_change` issue or
`asset_site_change` assign command. One immutable request is allowed in flight;
unknown results retain the original actor, version, payload and request ID and
allow only the same-request retry. A bounded actor/origin/backend session record
retains an unresolved command across navigation and reload. Storage failure before
submission blocks the write. A failure to clear recovery after a known commit
preserves success and blocks further writes until exact replay reconciles it.
Authorization precedes every inspection and retry, and the RPC remains the
transactional authority. Stale rejections require another explicit inspection and
confirmation rather than an automatic version refresh.

Success leaves the immutable event receipt visible and readies the next input
without requiring dismissal. If event details are unavailable, captured review
context is clearly labelled and the exact committed receipt can be reloaded;
current holdings are never substituted for receipt balances. A fresh inspection
and confirmation permits a legitimate repeat quantity assignment. Camera access
starts only on a user action and releases on stop, navigation or account/backend
change. Frames during lookup/review/submission are ignored. A held label remains
suppressed after success until three missed frames establish loss and reentry, or
the user chooses Rescan. Physical camera/device acceptance remains separate from
automated frame and generated-label keyboard-input coverage.

Asset detail has one primary identifier/custody summary. Retired custody is labelled
last recorded custody. Recent events are compact rows with native expandable full
before/after values and existing bounded custom snapshot links; historical labels
come from the original read model rather than current record fields.
