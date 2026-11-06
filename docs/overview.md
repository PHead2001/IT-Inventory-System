# Overview read projection

Audit 4.2 A403 requires an actionable Overview using real authenticated data.
This local reconciliation adds `overview_snapshot_v1(p_time_zone text default 'UTC')` and
the caller-scoped server adapter and the actionable `/dashboard` Overview.
The existing low-stock dashboard, report and export contracts remain intact.

## Selective release checkpoint — November 5, 2026

The current source integration starts at `39e1b8b40d0b17a7bff46127703e7dbeae633743`
and imports the Overview slice, its direct shortfall dependency, current-consumer
restock completion and tests.
It retains current shared theme, privacy, navigation, Peek, CountTicker and motion
owners. The chart adapter compares snapshot identity so Reduced-to-Full admission
cannot replay unchanged data; new data received in Reduced seeds that comparison.

Fresh dependency installation, 97 focused UI/contract tests, strict TypeScript,
47-migration clean replay, and actual generated-type comparison passed locally.
The database evidence is composed from a 1,562-assertion pgTAP pass and focused
retries plus every registered integration step, rather than one uninterrupted
`test:db` success. Fixture corrections preserve normal occupied-site deactivation
rules, make the multibyte boundary events strictly newer, isolate the literal
search query by run, and clean only exact owned raw cap IDs with no references.
All recorded inventory history remains retained.

The pinned Node 24 Overview run proved complete old/new snapshots around held
writes, rollback, replay, custody races, base-event deduplication and membership
revocation. Its authenticated REST request timed out with `57014` at 5,006.0259 ms
against an independently held lock; the ambient setting was eight seconds and
pooled-setting reuse was verified. Earlier direct Node 27 adapter receipts are
superseded and supply no current proof. A legacy export cap request initially
timed out; the corrected focused Node 24 run reached the cap and returned its
required rejection in 1,703.8 ms. The initial timeout's cause is unproven; no
export SQL or rejection assertion was weakened.

The subsequent forward-upgrade and local plan checkpoint below closes those
specific local evidence gaps. Full application certification, populated Overview
desktop/phone visual and browser inspection, exact-SHA CI/review and isolated
hosted proof remain pending. A403 is not accepted by these local checkpoints.
The older donor evidence below remains historical.

### Forward upgrade and local plans — November 6, 2026 UTC

The corrected guarded cycle at committed `5718d446f4d36353cb9515c3b2b532f02d5db611`
passed in 107.897 seconds. It reset the disposable local database to 46 migrations
through `20261019151034`, then applied only `20261019193000`. Eight normal
authenticated mutation calls used an explicitly configuration-capable fictional
fixture maintainer. Before/after fingerprints preserved inventory, balances,
versions, history, receipts, membership capability and prior function contracts;
the quantity retained 10 available, two assigned and 12 recorded units. Canonical
generated-type comparison passed after upgrade and after the final clean
47-migration reset. An authenticated HTTP Overview availability read passed in
151.28 ms; this was a small committed fixture, not volume-latency proof.

Four rollback fixtures measured the actual authenticated SQL function separately
from a source-derived inner `EXPLAIN (ANALYZE, BUFFERS)`: zero inventory,
1,000 quantity definitions/100 assets, 5,000 events per stream, and a 5,001-event
quantity overflow. Function times were 29.29/33.08/55.81/36.19 ms; inner execution
times were 0.958/5.907/33.172/12.650 ms. Recent-event ordering matched History,
activity counted 0/1,100/10,000/5,001 events, and overflow returned unavailable
`ledger_budget` with zero line-lookup loops. The representative ledger used
`quantity_events_overview_ledger` and the line primary key. All observed buffer
reads were warm-cache hits with no temp I/O; this does not establish cold-cache,
hosted/provider or arbitrary aggregate-growth capacity. The earlier real REST
five-second timeout proof remains separate.

Retained local artifacts are `.local-tools/overview-integration/forward-current-binding.json`,
`forward-before.json`, `forward-after.json`, `plan-*.json` and
`db-forward-plans-corrected/receipt.json`. The migration SHA-256 remains
`504E1AB60399F0483D154E67853BA24851FB56538F8B3C0E34944C73E0BEA84F`.
The first fixture attempt lacked the required configuration capability and
stopped before inventory committed; its failed receipt is retained. No product
permission was weakened. Volume fixtures rolled back, and the final supported
reset removed the disposable upgrade fixtures without deleting history by SQL.

The RPC is additive, stable and `SECURITY INVOKER`, pins an empty search path,
checks `auth.uid()` against active `app_members` before validating input, and
grants execution only to `authenticated`. Viewer and staff members can read;
inactive members, Auth accounts without membership, anonymous callers and
`service_role` cannot use this endpoint. There are no writes, new caches,
reconciliation triggers or analytics services.

## Snapshot and numeric contract

Version 1 returns `asOf` from the database statement clock, `timeZone`, a window,
stock summaries/action rows, current site holdings, recent events, activity, and
three featured per-definition stock trends. The server adapter separately adds
`fetchedAt` when the validated response arrives. The sections are selected in one
SQL statement, including current balance reconciliation; no independently fetched
history/current-state combination is used. Values remain decimal strings through
the typed projection so quantities/counts cannot lose JavaScript integer precision.
`overviewChartRatio` approximates only a bounded drawing coordinate; it never
returns or changes an authoritative inventory value.

The only caller argument is a database-recognized named timezone, at most 100
characters (`UTC` or a slash-delimited timezone name). Abbreviations, arbitrary
dates, IDs, page sizes and reconstruction budgets are not accepted. Initial UI
integration should request UTC, label the timezone, and may then explicitly
refetch using the browser timezone. The window includes today and the previous
13 calendar dates. Historical endpoints use the following local midnight;
today uses `asOf`. Spring/fall days therefore have 23/25 hours where applicable.
An event exactly at midnight belongs to the next day, while events at today's
`asOf` are included. Activity counts today only so far.

Stock summaries count active quantity definitions. `monitoredItems` have a
threshold; `needsAttention` use available storage quantity **at or below** that
threshold; `zeroAvailable` is a subset of attention, never another additive
total. `unmonitoredItems` have a null threshold. Five attention rows include
`max(threshold - available, 0)`; five unmonitored rows support the existing setup
flow. Storage at inactive locations remains available, consistent with existing
stock reads. No headline adds quantities of different products or adds asset
counts to quantity units. Current thresholds label the current state; the chart
does not claim historical threshold values or monitoring coverage.

Site counts distinguish active serialized assets, distinct quantity definitions
with positive holdings, and occupied sites. Five deterministic rows name the
actual site and record with its own quantity. Positive holdings are retained even
if a site is inactive; each row carries `siteActive` and labels inactive sites,
so custody visibility is distinct from topology eligibility. Recent history merges the last ten base `quantity_events` and
`asset_events`, then selects ten by timestamp descending, record kind ascending,
event UUID ascending, matching existing History. Both per-stream limits and the
final limit/JSON array preserve that tie order. Assignment
events are linked evidence, not additional operational events. Activity counts
each base event once, including metadata changes, lifecycle and site operations.

## Bounded stock reconstruction

Choose up to three definitions by attention first, other monitored second,
unmonitored third, then lowercase name and UUID. Each series is available storage
for one definition. The SQL examines at most 5,001 ordered quantity events and
20,001 storage lines/current-balance rows per item. The extra row is a sentinel,
not a partial exact result. Only fourteen endpoints per series reach the client.

Provenance requires version-one creation or site opening matching the definition
creation time, consecutive event versions ending at the current version, and
timestamps that do not reverse in version order or exceed `asOf`. Tied timestamps
are valid and ordered by version; location-line order is deterministic. Each
location's first before-balance is zero and later before-balances equal its prior
after-balance. Signed deltas must match before/after and reconcile every location
to the same-snapshot current balances, including retained zero rows. Normal item
metadata edits/category moves advance item versions with `metadata_updated`
events; `needs_metadata` recalculation and file versions do not advance them.
No-op operations advance neither item version nor history.

Event-budget overflow excludes the definition before any storage-line lookup.
Eligible definitions retrieve unsorted raw storage-line candidates through the
event-key index with a 20,001-row sentinel limit. The overflow subset need not be
deterministic because it is never reconstructed. Only a complete set of at most
20,000 candidates is sorted and checked for location chains. Actual execution
plans require environment-specific verification; the scoped local witness above
does not establish hosted cost. A bounded emitted result alone is not cost proof.

Creation/receives add real storage lines; corrections use signed deltas; storage
moves have two lines and net zero; issues remove storage; returns add storage;
archive-and-clear removes storage. Metadata/restore/site opening and site-only
transfer/correction/write-off events have no storage lines. A site opening can
establish zero storage while recording positive site custody. Historical points
before creation are null with `not_yet_recorded`, never invented zeros.

Every recorded archive storage line must be negative and end at zero, matching
the archive-and-clear mutation. A legacy archive with no storage lines remains
valid. A partial decrement labeled as an archive is `event_shape`, even when its
arithmetic and current balances reconcile. Budget overflow still takes precedence
over provenance checks.

The 20,000-line cap is a defensive bound, not a reachable successful fixture for
complete RPC-origin history within the 5,000-event cap. Let E be all events, N
non-clear events, C archive-clear lines, and U zero-to-positive location-balance
transitions. Each non-clear RPC event has at most two storage lines and creates
at most one positive location balance. Each clear line consumes a positive
balance completely; charge it uniquely to that location's most recent
zero-to-positive transition. Thus C <= U <= N and total lines L <= 2N + C <= 3N
<= 3E <= 15,000. This conservative proof assumes complete history from zero,
actual RPC mutation semantics, and no unlogged privileged balances or replayed
writes; no-op mutations produce no events. It does not certify arbitrary
privileged ledgers accepted by table constraints. In particular, repeated
partial decrements labeled as archives invalidate the charging argument and
must be refused by the read projection.

Missing opening, version/order gaps, broken before/after chains, unsupported
event shapes, current-balance mismatch or exceeded budgets mark the whole trend
`unavailable`, supply a reason and return null endpoints. Valid recent creation
produces `partial` coverage only because older endpoints are not yet recorded.
Charts must break lines at null points and expose a table/coverage explanation.
This conservative read does not diagnose or repair inventory integrity.

Activity retrieves at most 10,001 candidates from each base stream (20,002 source
candidates maximum), then retains at most 10,001 combined candidates. More than 10,000
marks every activity count unavailable; it does not publish a truncated total.
The serialized JSON response is capped at 65,536 UTF-8 bytes. Exact current-state
aggregates are output bounded but still depend on database size. Existing event
timestamp indexes serve activity/recent reads; an additive item/version/time index
supports bounded ledger access. Query plans/latency must be measured rather than
calling all work constant cost.

## Validation and remaining integration

`supabase/tests/overview.test.sql` covers grants, membership denial, empty data,
timezone validation, 23/25-hour calendar arithmetic, base-event deduplication,
ledger shapes, opening gaps, endpoint mismatch, bad chains/order, inclusive
thresholds, inactive-location availability, and event/activity sentinels.
`supabase/tests/overview_boundaries.test.sql` adds admitted 4,999/5,000-event
histories, refusal at 5,001, exact combined activity at 9,999/10,000 and refusal
at 10,001. Archive cases retain legacy zero-line and valid repeated/multi-location
clears while refusing a reconciled partial archive. Separate malformed partial-
archive fixtures contain exactly 19,999/20,000/20,001 raw lines with 495 events
and matching chains/current balances: the first two must report `event_shape`,
the last `ledger_budget`. These are defensive provenance/budget tests, not
successful operational histories at 20,000 lines. UTF-8 cap cases include the
whole JSON metadata overhead; client cases exercise 65,535/65,536/65,537 bytes.
An authored 20,001-line fixture isolates the raw line sentinel using privileged
malformed provenance, and an armed RLS read guard verifies no line execution for
an event-overflow definition. These tests prove refusal rather than accepting
the intentionally malformed fixture as a valid operational history.
`supabase/tests/overview_ordering.test.sql` exercises twelve equal-time events
per stream, a mixed tie group larger than ten, and agreement with existing History.
Pure contract tests cover exact large integers, null gaps, shortfalls, response
size, dates and today/current reconciliation. Adapter tests cover a single scoped
read, concurrent accounts and failure handling. An RPC membership denial after
the initial membership check, a privilege denial or invalid/missing JWT produces
the existing `forbidden` outcome with `clearSnapshot=true`; transient/transport/
projection errors produce `unexpected` with `clearSnapshot=false` and a generic
public message. Database messages/details never become public error text. Future
refresh server actions must return these typed fields explicitly, since framework
serialization of thrown errors does not preserve this browser contract.

Donor checkpoint checks are historical and do not certify the reconciled tree. Clean local
migration/reset/tests, canonical type generation and comparison, application gates,
the authored large line-budget/no-line-access regressions, representative query
plans/latency, concurrent writer/snapshot proof, and the actual Data API five-second timeout proof remain
pending. `SET statement_timeout='5s'` is a function defense, not claimed REST
runtime proof. Known DST arithmetic is covered in SQL; the endpoint's real clock
is not caller-controlled for historical simulation. Independent Astra review of
the new membership/read boundary is required before acceptance.

## Overview UI

The main route requests one authenticated UTC snapshot. The responsive bento puts
attention and threshold setup before recent events, site equipment, and the
fourteen-day charts. Counts/amounts stay decimal strings in text and tables;
SVG coordinates alone use bounded drawing ratios. Stock lines split at nulls,
and every chart has a keyboard-accessible daily table with exact values and
coverage. History links identify base events once using the shared event title
vocabulary; site rows show the actual site name and individual record amount.
The projection lacks site codes, so equipment links open the record and the
section offers the supported sites list, never an invented site-code link.

Refresh uses a serializable action outcome. Transient failures preserve the
snapshot, as-of and fetched-at times, with a stale warning. Membership/JWT denial
clears the private sections and edit actions. The action recognizes actual Next
framework redirects only to the known sign-in/access-denied destinations (using
the existing safe login-return allowlist); unrelated control flow rethrows.
Successful refresh replaces data, both timestamps and current viewer/staff
permissions together. A verified permission downgrade is returned and applied even
if the later snapshot read fails, so stale data cannot retain staff-only affordances.
Every server result carries a unique account-bound revision, including unavailable
and forbidden reads; the revision remounts the complete client state. Each client
request has a local generation guard and captures the committed privacy grant,
pending-provider scope, presentation lifetime and source. The existing
`useRouteActionResult` observes the real action promise at its await boundary.
Revocation, assignment invalidation, hidden/unverified admission, provider replacement
and unmount retire completion authority even if a retained child is later shown
again with the same generation string. This callback fence never grants access,
owns privacy cleanup or cancels a business operation. Deferred tests cover recovery
then denial, overlapping revision requests, revocation/re-verification without
unmount, A → B → A, provider-scope replacement, stale denials and unmount.
The initial route retains normal authentication redirects
and displays a retryable region if its data read fails. Loading reuses the existing
`PairedRouteLoading` owner and inventory-shaped skeleton, including its single
elected announcement and paired-route retention rules. Scan and label tools remain available to viewers;
Add item and threshold setup actions are staff-only. Reads never submit a write.

The original paginated low-stock surface remains at `/dashboard?view=low-stock`.
Existing `/dashboard?page=N` bookmarks retain that surface too. Explicit view
parameters persist through pagination and obsolete-page recovery; its reads,
reports retain their existing data contracts and column positions. The new cards
show exact shortfall; equality is labelled At threshold. This slice reuses the
precision-preserving shortfall helper/component in Overview, ordinary inventory
rows, quantity detail and the legacy detailed dashboard. Low-stock CSV appends `Shortfall` after
all existing columns; missing/null availability produces a blank, never a zero
derived from recorded or assigned totals. The future P11 `view-rows` consumer
remains an explicit integration edge when it lands; no future consumer is claimed
complete here. Runtime/final A308 acceptance is still pending for current surfaces.
The donor's separate grouped inventory view remains on its inventory-views branch
and is not imported into this Overview integration.

`overview-view.test.tsx` and `refresh.actions.test.ts` cover projection retention,
private-data clearing, viewer actions, exact large decimal text, threshold equality,
null gaps, accessible tables and real framework redirect classification.
`refresh-authority.test.tsx` exercises retained private children with the current
route provider and pending scopes. These are authored regression definitions;
reconciled-tree execution is pending and donor results are not reused as current proof. Offline checks do not
establish browser or database acceptance.
`tests/e2e/overview.spec.ts` authors a real caller-data comparison, responsive
Full/Reduced captures, daily table checks and signed-out refresh clearing for
staff and viewers. Its browser execution remains pending. Attention and recent
changes share the first desktop content row; recent events retain all ten in a
labelled keyboard-scroll region bounded to 330px. The hero reuses ClosetPreview
and AmbientLight, with stationary hero controls and a separately tilted decorative preview.

Overview action/event/site/trend lists reuse W05 `ListEntrance` with stable record
identities and actual pending state. Headline and site counts reuse W06
`CountTicker`: exact SSR/AT values remain immediate, while the first admitted
Overview visit may interpolate from zero. Shared admission owns Reduced reseeding,
privacy withdrawal and the 500 ms count lifetime; no primitive is replaced here.
Charts render complete exact SVG/table values immediately and use the same
presentation admission for a 500 ms decorative line draw or bar reveal. Null gaps
retain separate paths. Reduced/reseeded arrivals stay static; withdrawal restores
original inline styles and does not replay a denied historical snapshot.
`chart-motion.test.tsx` owns the decorative engine contract; native motion and
populated Full/Reduced inspection remain pending.
W10 depends on the companion local surface patch's `MagneticVisual` export and
stationary `.experience-tilt`/`.experience-tilt-visual` API. Only Add item and Print labels
receive magnetic visual layers; Scan is navigation, while Start camera remains
in its existing Scan flow. Hero preview and four stat visuals tilt within
stationary hosts. Rows, forms, Refresh and the hero's actionable content do not
tilt. The shared engine owns fine-hover/full-motion gates, intensity tokens and
4px/6-degree limits; this slice adds no second effect engine. Theme, privacy and
room authority code is retained from the current branch. Populated desktop/390px,
keyboard, Dark/Light, Full/Reduced and native hit-testing acceptance remain pending.

## Reconciliation and authoritative database certification plan

The historical donor delta is
`38d5923127f8957c3cf0d1179fe78d3c75225e0d` →
`8066fff5fef7cfa1ad826ac23bcd8fe80f7670b9`, selectively reconciled onto
`db6429ba666e8dd28106be0e7bea65f41a2ca1bb`. Its ancestry is not merged; the current
selective release baseline is recorded above.
The forward additive `20261019193000_overview_snapshot_v1.sql` follows the target's
`20261019151034_command_palette_index_maintenance_grant.sql`. All existing migrations,
including `20261012065001_audit_four_serial_scan.sql`, are unchanged. The new RPC
entry in `database.types.ts` is now actual Supabase generator output from the
integrated local schema. `npm run db:types:check` passed after the local database
exercise. Future schema changes still require regeneration and comparison.

Run the following only in the canonical isolated local database environment with
adequate resources. No hosted fixtures, fabricated load capacity or SQL metadata
alone can replace these acceptance results.

1. **Replay and upgrade:** run the complete `npm run validate:db` clean-replay gate,
   including `supabase/tests/overview.test.sql`. Separately prepare the prior
   deployed schema with the existing migration history, apply only the forward
   migration and compare inventory IDs/codes, balances, versions, events, receipts,
   grants and serial lookup behavior before/after. The read must not change data.
2. **Concurrent writer/snapshot:** use two independent authenticated Data API
   clients and independent PostgreSQL connections for deterministic barriers.
   Hold a real receive, move, issue, correction or archive-and-clear transaction
   after its writes but before commit; request Overview from another caller before
   commit and again after commit. Require the entire old state then the entire
   committed state (summaries, holdings, base event/activity and reconstructed
   endpoint together), never mixed states. Repeat rollback and two competing
   writers, and prove that one base event is counted once and receipt replay
   creates no additional event. Include current threshold change, quantity metadata
   edits, site-only opening and asset site transfer without combining unlike units.
   Preserve statement/as-of values and exact decimal comparisons in artifacts.
3. **Authorization races:** revoke membership between the initial server check
   and RPC execution using a deterministic barrier, and require denial/private-data
   clearing. Check inactive/nonmember/anonymous callers, staff-to-viewer downgrade,
   independent concurrent accounts and an old refresh completing after denial or
   account change. SQL tests prove the boundary; adapter/component mocks cover only
   the application contract, not the database race.
4. **Nested query cost:** use representative under-budget, exact-boundary and
   sentinel-overflow histories. Capture actual nested SQL plans with `EXPLAIN
(ANALYZE, BUFFERS)` for the projection's inner statement and/or local nested
   statement instrumentation. A top-level Function Scan is insufficient. Record
   event-key index access, rows read/removed, loops, buffers, sort/temp work and
   latency. Confirm the event-overflow case never executes line reads, line
   candidates stop at 20,001, complete lines alone are sorted, and activity
   streams use their declared sentinels. Measure exact aggregate growth separately;
   the 64KiB response limit and bounded output do not establish bounded scan cost.
5. **Effective REST timeout:** introduce a reversible local-only, deterministic
   delay in the actual Overview execution path (for example an isolated test read
   policy), invoke `overview_snapshot_v1` through authenticated PostgREST and
   retain the real 57014 cancellation plus monotonic elapsed time near five seconds.
   Verify server-side cancellation and no leaked pooled timeout/session setting;
   restore instrumentation and repeat a successful read. A client abort, direct SQL
   call or `pg_proc.proconfig` assertion cannot establish timeout hoisting.
6. **Boundaries:** execute the authored event/line/activity/UTF-8 sentinel tests and
   representative concurrency cases; capture unavailable/null outcomes instead of
   partial exact totals. Do not run massive synthetic fixtures on this constrained
   host. Record environment, fixture dimensions and measured results rather than
   asserting arbitrary throughput or capacity.

The historical reconciliation plan above predates the selective-release local
checkpoints, which record composed database coverage, generated types,
concurrency/REST timeout, forward upgrade and scoped inner plans. Full app gates,
exact-SHA remote checks, real downloads and populated Overview/hosted runtime
acceptance remain required before A308/A403 acceptance.

### November 4, 2026 focused local runtime checkpoint

A focused Overview integration run completed against the dirty donor candidate on
`assist/audit-four-overview-integrated` at HEAD
`a273a608094f7430dbbbb9d1ea93e4b9f3e57dc8`. The tested
`tests/integration/overview.ts` source had SHA-256
`D5C524AEC5C7A0FB9AA2C24876A9887211B9658927A861CD550A2B451EAAC16D`.
The run verified the recorded migration count of 47 before execution; all 163
database input files and the source binding matched before and after. The focused
child gate passed in 11.817 seconds with a 1 GiB heap and a measured minimum
free-memory floor of 6,683,373,568 bytes; owned child exit, output stream closure,
and process cleanup were observed.

The exercise used a real authenticated PostgREST request for
`overview_snapshot_v1`. A separate independent transaction held an
`ACCESS EXCLUSIVE` lock on `public.quantity_items`, blocking the actual Overview
RPC. A uniquely named, fixture-owned viewer probe exposed only the backend PID,
backend start time, and ambient statement timeout; it installed no delay and no
timeout override. The request returned SQLSTATE `57014` after 5,006.3977 ms,
before the client deadline and without forced blocker release. The blocked backend
stopped executing; a subsequent read succeeded, and reuse of the observed pool
backend retained its prior timeout setting. The probe was test harness metadata
instrumentation only; application RPC grants and permissions were not changed.

The run compared complete Overview projections around a held receive, its commit,
a held rollback, and REST receipt replay; it also covered site opening, competing
quantity custody writers with stale-loser/replay behavior, and serialized-asset site
transfer with event deduplication. Held writes matched the complete old snapshot;
commit exposed the complete new projection; rollback and replay preserved the
committed projection. The exercised stages included `receive-held`,
`receive-committed`, `rollback-held`, `rollback-released`, `receive-replayed`,
`site-opening-committed`, `custody-transfer-held-competing-writer`,
`custody-transfer-committed`, `custody-transfer-replayed`, and
`asset-site-transfer-committed`.

Authorization used separate authenticated accounts. The first account's active
membership was revoked and committed after its successful precheck but before its
RPC; that RPC returned `P1001` with no snapshot, while the independent second
account remained allowed to read. After the second account was downgraded to
viewer, its Overview read remained allowed and the `mayMutateInventory` predicate
returned false. No backend mutation attempt was made or claimed. The adapter error
mapper's `clearSnapshot=true` contract was asserted. This run does not claim
mid-statement revocation cancellation or late-refresh UI suppression.

Fixture cleanup dropped the owned probe, used normal archive/clear and
site-deactivation RPCs for owned records, signed out fixture clients locally, and
deactivated fixture memberships. Append-only events, receipts, and actor references
were intentionally retained. Cleanup completed without a reported failure.

This is scoped local evidence only. The pure helper checks completed, but this run
did not perform clean database reset/migration certification, forward-upgrade
proof, canonical generated-type comparison, query-plan or broader load analysis,
full application gates, build, browser or hosted run, theme/export inspection,
exact-SHA remote checks, or final A308/A403 acceptance. Remaining final gates stay
pending.
