# Integrated inventory capabilities

Design checkpoint for the authorized September 25 milestone. Baseline: main
`98ae22e71cf24ca38dcd91de143020f8ee0b1ac5`. This document records implementation
contracts, not completed acceptance. One integration branch targets main; PR19's
independent preview-polling change is not incorporated or altered here.

## Current state and custody

Keep `stock_balances` exclusively for logical storage. Add `sites` with immutable
UUID/code, editable name/notes, active state and optimistic version, and
`site_quantity_holdings(item_id, site_id, quantity)` with a composite primary key
and the existing bounded nonnegative integer quantity domain. These tables are
disjoint current holdings, not duplicate totals. An item row lock serializes every
storage/site mutation for that item. No persisted aggregate stock total is added.

Serialized assets gain site custody without a parallel assignment-current table.
An active asset has exactly one storage location or site. A site-held asset cannot
be moved or retired through a legacy storage-only operation. Explicit site loss or
retirement closes custody and records its former site in immutable history;
restoration requires an explicitly chosen eligible storage destination. Retired
assets require a null site; an existing retained storage location is labeled last
recorded storage, not current custody. Site retirement clears both custody columns.

Append-only assignment events link to the corresponding quantity/asset event.
They identify issue, return, site transfer, opening holding, correction and
write-off independently. Quantity events include source/destination balances and
deltas for every affected storage/site holding. One transaction changes holdings,
increments the inventory version once, appends evidence and completes the receipt.
An opening record creates current site stock without inventing a storage issue,
and validates the current published metadata schema like ordinary creation.
Separate nullable quantity-event/asset-event foreign keys with an exactly-one
constraint, unique links and matching entity relationships enforce event identity.
Events retain source/destination identity and label snapshots. Export row identity
includes custody kind and site/location UUID; independently aggregated storage/site
totals avoid join multiplication. Site filters select holdings, but reorder status
always remains item-wide storage availability.

Available stock is the sum of storage balances, including inactive storage.
Assigned stock is the sum of site holdings; total recorded stock is their sum.
Low-stock uses available stock with the existing null/zero/inclusive threshold
rules. Shared read projections feed details, search, dashboard and bounded exports.
Before site assignments exist these numbers equal the existing stock contract.
Site reports separate gross storage issues, returns, transfers, openings,
write-offs and distinct serialized asset IDs. They never add unlike products into
an unexplained equipment count.

## Authorization, transactions and compatibility

Active members read. Staff mutate inventory, assignments and supporting files.
Active staff with `can_manage_configuration` manage categories, forms, locations
and sites. Neither user-editable claims nor fixture identity grants maintenance.

Every exposed mutation authorizes and locks membership before receipt replay.
Fresh work uses READ COMMITTED; catalog-sensitive paths retain the catalog lock
and subsequent-statement live reads. Inventory/topology operations require one
additional shared/exclusive placement guard: shared for inventory references,
exclusive for location/site lifecycle changes. Acquire it before inventory rows,
not from a late destination helper. Order is membership, receipt, catalog if
needed, placement guard, category/schema rows if needed, inventory rows in stable
type/UUID order, then destination rows in stable order. The existing hierarchy
guard remains responsible for structural integrity; its statement trigger acquires
the exclusive placement guard before updating the guard row, including privileged
direct topology changes. Enumerate every legacy writer before implementing this
protocol. Stock-only operations acquire
no catalog lock. Operations remain timeout-bounded and all-or-nothing.

Old metadata calls preserve custom values and cannot change custody. Old generic
storage moves/adjustments cannot operate on sites. Archive-and-clear is still
storage-only and rejects outstanding site holdings. Sites cannot archive with
outstanding holdings. No restore recreates a closed assignment. New versions and
aggregate totals cross JSON boundaries as decimal strings, with safe legacy
integer parsing retained; historical receipts are not rewritten.

## Logical locations

Add a general `storage_area` kind under rooms or storage groups, with explicit
`can_hold_inventory`. Bootstrap IT Office and its provisional General Storage /
Unsorted destination once in a forward migration. These names are software labels,
not measurements. Codes and UUIDs never change or recycle.

Effective destination eligibility includes every ancestor's active state.
Deactivating a subtree requires no positive storage balances or active assets
anywhere in that subtree; do not silently deactivate children or erase stock.
Inactive sources remain evacuable. Capability changes and reparenting may not make
a stocked subtree ineligible. Reparenting rejects cycles, invalid kinds,
inactive destination ancestry and stale reviewed versions. Closet model bindings
keep their parent/kind/capability relationship; safe display-name/order edits do
not change Git geometry. Location configuration history is separate from physical
inventory movement. No hard-delete workflow is needed.

Pickers, filters, labels, scans and exports support unmodeled destinations.
Show-in-room is unavailable with an explanation outside the model's actual code
bindings. Seed tests assert the required closet subset rather than total database
cardinality.

## Attachments

Reuse the existing unpublished private Storage lifecycle only after reviewing its
implementation against this goal. Preserve immutable reservation/object identities,
byte inspection, normalized photo variants, original validated PDFs, server-only
HMAC evidence, terminal cleanup claims, quotas, restricted grants and replay rules.
No service-role client is added to normal application requests.

Each parent has one attachment collection row with a positive bigint revision and
exactly one nonnull quantity/asset foreign key, unique per parent. Create it lazily
under a conflict-safe insert/row lock or at inventory creation; absence reads as
the initial revision. Reservations and byte-validation progress do not advance
the collection revision. Publication, rename, replacement and removal do, once
per changed operation, together with a separate append-only attachment event and
retry result. Replacement/removal/rename additionally bind the reviewed file
revision. A concurrent collection change requires explicit renewed review; it does
not discard immutable staged bytes. Completed authorized retries return the saved
result before checking expired signatures or later collection versions.

Attachment events identify parent, file/replacement UUIDs, actor, timestamp,
action, title/type/size and collection revision; they contain no secrets or signed
download URLs. Retained metadata is not a promise to retain removed file bytes.
Renaming changes a bounded display title, never the immutable object path or
inspection provenance. Files use membership/receipt, quota/lifecycle guard,
collection and file/object locks in a documented consistent order; no catalog or
placement lock is needed because they never alter inventory custody. Parent
deletion is already prohibited by referential history, while archive/retirement
does not prohibit supporting-file management.

Replace parent stock-version coupling with a separate attachment-collection
revision per inventory parent. Reserve, replace, rename, remove and finalize use
that reviewed revision and file identity; a new attestation format version prevents
old inventory-version signatures being reinterpreted. Stock movements do not invalidate file
work. Attachment events and receipts remain independent of stock event/version
churn. Archived/retired parents remain readable and staff-manageable. A failed
replacement preserves the previous ready file. Quantity supports one recognition
photo; assets support up to 20 documents/photos. JPEG, PNG, still WebP and PDF are
supported; HEIC/HEIF, HTML and SVG are explicitly rejected. Existing bounded
inspection/normalization must be proven against real Storage, not inferred from
PostgREST behavior. Source photos are never published; PDFs remain live until
their attachment is removed.

Server validation keys and private Storage readiness are separate deployment
prerequisites. Preserve migration-first delivery. Do not activate production or
grant a production maintainer in this task. Document a read-first owner procedure
using a verified Auth UUID, never an embedded real identity.

## Delivery and acceptance

Recover only missing designer and relevant metadata repair deltas, retaining live
form rendering, stable field IDs, identity-bound recovery and explicit publication.
Then integrate files, managed locations and site custody/shared reads on this one
branch. Each checkpoint gets focused regressions; final certification covers the
integrated candidate, including independent-connection races and rollback,
direct API/Storage bypass, visual drag/keyboard/mobile workflows, actual files,
signed-in isolated hosted workflows, exact-SHA CI and fresh Codex review.

Required evidence remains pending until recorded: designer publication into real
inventory; staff/viewer/maintainer permissions; file replacement and cleanup;
office stock with honest unmodeled navigation; 10/7/3 issue and return/transfer
availability example; serialized custody/QR/files/history; opening holdings and
write-off/retirement/archival guards; full existing regression suites. Hosted test
cleanup preserves accounting history and the standing preview test account.

Independent Astra design review accepted this model with the status-aware retired
constraint, underlying topology barrier, structurally enforced event links,
site-aware export identity, shared opening metadata validation and versioned file
attestation conversion above. This is design review only; implementation and runtime
proof are still required.
