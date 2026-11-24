# Inventory views

## Current local reconciliation

U303/A305 selectively adapts donor `31bc1d41` onto PR66 base `beba9904`; it does
not replace the donor tree or join history donor `45999655`. The held dirty
reader-retirement changes are adapted separately: settling the read scope aborts
pending siblings and late response bodies are cancelled without replacing the
settled result. The earlier donor's canonical CLI created the grouped migration;
the unpublished, locally unapplied source is now appended as
`20261119061422_inventory_grouped_views.sql`, after main's
`20261119061421_overview_utc_fast_path.sql`. The retained November 9 checkpoint
records 47 migrations through `20261019193000`, no grouped RPC and no grouped
upgrade/reset execution. Historical donor filenames do not identify an applied
migration. Earlier migrations and generated database types remain
unchanged. Actual schema replay/upgrade and canonical type generation/comparison
are required before database acceptance; no manual declaration is certified.

On November 20, exact main `ac841de496bc969156a4467a1b66c495996037b0`
was merged locally without conflicts. Its only new migration replaces the
independent Overview RPC; it does not change the grouped read dependencies.
The grouped SQL bytes are unchanged by the append-only filename correction.
This source reconciliation adds no runtime or hosted validation evidence.

Current route-ready, capture and return ownership remain in both page shells.
Rows retain current record/location peeks, exact count tickers, identity-based
entrances, spring disclosures and canonical holding feedback. Multi-holding item
titles do not manufacture a single holding for shared-title pairing. Location
labels and file summaries remain separate authorized reference reads; stable
logical identity and the inventory snapshot do not imply a global catalog/photo
snapshot.

The current A308 component derives shortfall only from the representative row's
item-wide `availableQuantity`, never `scopedStorage`, individual holding quantity
or recorded total. Null availability remains unavailable, and decimal strings
remain exact. Current W01 spotlight, W05 list ownership, W06 count tickers, Peek,
shared theme tokens and existing Show in room links remain in the grouped rows.
Item titles use an aggregate source regardless of holding count; location detail
titles bind the exact location code and aggregate or holding occurrence. No
aggregate source invents a holding. Pairing and application Back retain exact
list scope and row anchor, raw readiness, actor/epoch, visibility and uniqueness
checks. Explicit rendered view/density enter row return URLs before readiness;
only new constructors normalize absent server defaults, retaining the original
raw key. Native traversal cancels application repair. Missing or conflicting
sources retain guarded navigation and generic crossfade. Runtime proof remains
pending.
Location-inventory record returns retain exactly one validated `/locations`
directory parent, including its filtered tree and occurrence anchor. This is a
record-detail allowance only: foreign, recursive, duplicate or unsafe parents
fail closed, and whole-form Cancel keeps its existing sanitizer.

Saved-view storage and navigation require the existing strict managed
generation, matching assignment/revocation revisions, a foreground connected
host and current scope. Withdrawal clears retained names and retires queued
restoration/handlers through a monotonic local lifetime. The existing
actor/backend restoration gate remains fail-closed on scope drift. Merely having
`privacy.ready` does not admit restoration. Explicit URL display keys win, an
implicit browser default applies once, and committed Back parameters remain
authoritative.

The new server reader reuses the export reader's bounded raw JSON decoder. It
retrieves the caller token from the already validated server client, verifies
that **same token** with Auth `getUser(token)`, then matches that verified actor to
the request member. Session-user metadata is not trusted. Requests use only the
four fixed read RPC paths at the configured backend, public client key and caller
credentials, `no-store`, `redirect: error` and a shared five-second client read
scope. Raw successes are capped at 2 MiB/512 KiB/128 KiB by RPC before decoding or
JSON parsing; ordinary error bodies are capped at 64 KiB. Known HTTP 401/403
denials cancel their bodies and propagate as denial, rather than becoming empty
inventory or overflow. No central Auth or route-action denial contract changes.

SQL preappend accounting measures the exact `jsonb::text` representation of
bounded row/group objects, array separators, totals/count digits and final
envelope, with a final complete-object check. Each scalar row projection is
independently capped at 64 KiB before array collection. PostgreSQL's text
representation and PostgREST's wire representation can differ; the independent
raw wire cap remains authoritative before parsing. Neither limit is a query-cost
or throughput claim. Catalog overflow leaves the field-search controls usable;
group/preview overflow exposes an actionable error without partial rows/totals.

The matching helper lives in `private.inventory_view_matches`; only the three
new bounded RPCs live in the exposed public schema. Its invoker, empty-search-path
and active-member/RLS behavior are unchanged, and its execute grant uses the
existing authenticated private-schema usage. No new schema/role grant is added.
Authored SQL/REST checks assert the public helper is absent and private
Accept-Profile access is unavailable. Actual deployed API exposure/configuration
still requires runtime verification.

The client deadline aborts fetch/raw stream work and ignores late Auth/reference
results. The supported Auth `getUser(token)` call has no per-call AbortSignal,
so its logical timeout does not prove physical cancellation of that underlying
verification request. Actual PostgREST server cancellation at five seconds,
including timeout-hoisting configuration, remains pending.

Inventory and location pages default to **Items**. One quantity definition or
individual asset appears once; its disclosure contains every holding that
matches the current filters. **Holdings** retains the existing picking view and
its holdings-row pagination. Neither view writes inventory state.

The `inventory_grouped_page` invoker RPC applies the same literal search,
tracking type, lifecycle, category, location subtree, site and low-stock filters
as `inventory_search_v3`. It counts and paginates identities before expanding
their holdings. Each page contains at most 25 items and 1000 matching holdings.
Holdings are bounded before JSON construction; the complete UTF-8 JSON response
must fit 2 MiB. An oversized item/page fails with an actionable message and no
partial holdings or totals. Failed reads retain the requested page and their
actionable error; empty-page recovery runs only after a successful valid read.
Narrow filters or use Holdings view to recover.
Ordering is lowercased item name, kind and UUID, then location/site code and UUID
within a group. All statements in this STABLE read use the caller's single MVCC
snapshot. Active viewer/staff membership and caller RLS remain authoritative.

For quantity items, **Within these filters** shows separate storage and site
quantities, plus the number of positive holdings. **Overall item totals** uses
all caller-authorized storage/site holdings independently of these filters.
Those totals are decimal strings through the read model and UI. A zero-stock
definition has zero holdings and an explicit unlocated description; it does not
create a physical location. Retired assets identify last recorded storage.
Every modeled storage holding keeps its Show in room link.

Comfortable cards and the compact table share the same data. Compact columns
remain within a scrollable desktop region, with cards below 768 px. Selected
custom columns become chips on cards. The URL carries `view`, `density` and up
to six canonical field UUIDs in `columns`; invalid display input keeps the
filter shell and a recovery error, suppressing the new inventory/metadata reads.
Filter changes, view changes and saved views reset pagination; deliberate view
navigation cancels unsent search typing. Back and record-return anchors retain
display settings. A location path remains authoritative when a saved view's
location filter differs.

The field picker reads only published field labels. Literal field/category
search returns at most 200 fields, with a visible refine-search message; up to
six selected identities resolve independently of that page. Category context
and a UUID-ordered ordinal distinguish reused human labels. Current published
labels are preferred; fields removed from the current definition use the latest
published historical label and are marked historical. No draft label is read.
The catalog response is capped at 512 KiB: 206 entries with two legal
200-code-point human labels and JSON escaping fit this bound. Runtime catalog
validation matches PostgreSQL code-point length, including supplementary Unicode.

`metadata_selected_preview` batches at most 25 distinct record identities and
six selected field UUIDs. It preserves false, zero, missing/not-applicable values
and historical-answer provenance. Missing answers distinguish an unanswered
current applicable field, a field inapplicable to the record tracking type, a
removed field with only a historical published label, and an unavailable field
for that category. Historical labels remain marked; absent values never invent
current validation. Human labels are bounded to 160 UTF-8/escaped
bytes and displays to 256 bytes; multiple choices resolve at most three recorded
paths before aggregation. Shortened previews are visibly marked and link to full
details. A 128 KiB complete response accommodates all 150 legal previews with
identity/type/provenance bookkeeping; the older three-field, 49 KiB preview API
remains unchanged. Full 256 KiB custom-value objects never enter ordinary lists.

Personal saved views use browser local storage keyed by authenticated user UUID
and Supabase backend origin; browser origin supplies the remaining isolation.
Only allowlisted filters/display settings and user-authored view names are
stored, with schema version 1, at most 20 views, names of at most 80 characters
and a complete 64 KiB UTF-8 payload limit. Inventory records, answers, file URLs,
tokens and other fields are rejected. Restoration waits for existing privacy
verification; scope drift uses its fail-closed gate. Explicit URL display keys
win over browser defaults, and defaults restore only once, so Back does not
reapply them. Save, Rename and Remove failures are visible. Saved filters do not
alter authentication, membership or RLS.

The existing inventory CSV endpoint, columns and holdings rows remain unchanged.
The export menu calls this **Matching holdings rows**: it exports all matching
holdings within existing export limits, regardless of item/holdings view or the
visible page. **Quantity at Location** appears on every holding row. Item-wide
total cells are filled only on the first exported row for each quantity item.
**Inventory with custom fields** retains its
existing full-scope custom export. The separate display-column mapping CSV
contains selected field IDs, human labels/category and label provenance; it
does not change the inventory CSV. Mapping text receives the existing formula
guard, UTF-8 BOM, quoting and CRLF treatment.

Read RPCs declare `SET statement_timeout='5s'` in function proconfig. PostgREST
12.2+ hoists this transaction setting before execution when
`db-hoisted-tx-settings` includes it; a timeout set inside a function body does
not establish that deadline. Direct SQL tests set the session timeout before
the statement. Actual REST cancellation/version/configuration proof remains an
acceptance gate, using the existing configuration probe pattern and the new
local-only inventory-view integration fixture.

## Historical donor evidence and remaining acceptance

On the historical donor reconciliation over e894c4d, the focused batch reported **264
unique tests across 20 files**, with no skips, using a 512 MiB Node heap and one
Vitest worker. It includes grouped reads, personal preferences and ownership,
current item peeks, page/return/filter/export contracts, bounded raw transport,
published preview behavior, shared holding/list/spring/strict presentation and
existing export API authorization. The local terminal report is
`inventory-views-final-results.json` in the temporary directory. Earlier
iteration counts are not added to that total.

Those historical results are not executions of the current PR66-based selective
candidate. No fresh app, DB, browser or exact-SHA certification is inferred.

A subsequent **20-test transport-only pass** adds complete below/at/above wire
checks for all four RPC limits and retains the earlier transport regressions.
Its report is `inventory-views-final-transport-results.json`. Replacing the 17
transport cases in the 264-case batch with these 20 yields **267 unique passing
tests across 20 files**, without counting repeated cases twice. The helper's
private-schema move and authored SQL/REST assertions remain unexecuted DB work;
these JavaScript results do not certify that SQL.

The checked-in SQL tests and local-only REST integration fixture are authored
but **not executed here**. They cover active viewer/staff and denied callers,
distinct identity paging, scoped/overall/zero/retired identities, literal search,
1001-row and complete UTF-8 overflow, JSONB arithmetic against serialization,
published/historical selected fields and concurrent snapshot/timeout probes.
The REST fixture is registered in the canonical database gate. Its separate
100 ms hoisting probe is configuration evidence only; it does not establish
actual five-second cancellation of the production grouped read.

Before acceptance, run clean replay and upgrade over current migrations,
canonical generated types/comparison and complete DB/RLS gate. On an appropriate
isolated local environment, retain actual inner SQL plans and row/buffer/sort/temp
work for the identity count, selected page and bounded holdings/metadata reads.
A top-level Function Scan or output cap alone does not establish bounded query
cost. Use representative legal boundary fixtures, not massive host fixtures or
invented throughput claims. Instrument an actual grouped read with a reversible
local-only delay, retain its authenticated REST 57014 at about five seconds,
verify server cancellation and pooled-setting cleanup, then repeat a successful
read. Exercise concurrent moves/stock/custody/lifecycle changes and admission
withdrawal with real caller RLS; the authored two-read wrapper is supporting
snapshot evidence, not a substitute for those production-path races.

The authored browser suite, populated desktop/390 px both-theme Full/Reduced
inspection, compact table/card semantics and scroll/keyboard/AT continuity,
real downloads, new grouped-title/peek/room continuity, full app certification,
independent boundary review and exact-final-SHA remote checks remain pending.
No DB, browser, hosted service, credential/configuration or production mutation
was performed. All 76 audit requirements remain in the acceptance index.

## Donor provenance (historical)

Donor 3ef24157 was authored over 43351451. Its original worktree could not resolve
the shared Vitest configuration, so its runtime/type/DB/browser checks remained
pending. The current focused results above are new local evidence for the
reconciled source; they do not relabel the donor's earlier validation state.

## Local database checkpoint — 2026-11-20

This checkpoint supersedes the earlier execution status for the checks below.
It combines separate runs on the leased local stack.

- The retained 47-migration database upgraded to 49 and a clean reset replayed
  all 49 on source `4b5400093fbd3a6c6c69d40b7205d8dba710ebb0`. The database
  suite on `e94096791e21f7775f94105179193d0a2fc9815b` passed all 25 pgTAP
  files and 1,629 assertions, including grouped inventory. The aggregate run
  then stopped when the low-stock export cap returned `57014` at 5,011 ms.
  The unchanged focused low-stock test passed at 1,817 ms. The separate
  canonical `npm run db:types:check` passed on `e9409679`. Migration and
  generated-type files are byte-identical between `e9409679` and the
  grouped timeout candidate below.
- The grouped integration on `e1acb073d587f616aeaf8431dc9cff1d79bc6d57`
  passed caller authorization, concurrent snapshot and separate 100 ms hoisting
  checks. On `0f596439731596d0babdea145f1ce0e262617715`, the active viewer's
  actual `inventory_grouped_page` REST call returned PostgreSQL
  statement-timeout SQLSTATE `57014` after 5,006.5526 ms. The observer
  witnessed the PostgREST backend waiting on the owned
  `public.quantity_items` relation lock. The blocker still held that lock
  at response inspection, the exact witnessed request had retired before
  release, and the grouped result matched the baseline after release. Fixture
  cleanup completed.

Retained local receipts are under `.local-tools/`. The upgrade and clean
replay are in `local-db-nov20/group49-2026-11-20T16-21-30-461Z/`. The remaining
receipts are in `local-db-nov20-continuation/`, in the directories
`reuse49-2026-11-20T16-43-34-846Z` (pgTAP and aggregate stop),
`types49-2026-11-20T16-48-30-075Z` (types),
`focused49-2026-11-20T16-51-11-612Z` (low-stock retry),
`grouped-e1ac49-2026-11-20T16-59-14-714Z` (grouped controls), and
`grouped-0f5949-2026-11-20T17-01-15-509Z` (actual grouped timeout).

An uninterrupted canonical database run remains pending. The grouped timeout
proof leaves exact pooled-backend setting restoration, physical query-plan
evidence, production-path races with moves, stock, custody, lifecycle and
admission changes, populated visual acceptance, and final remote gates open.
