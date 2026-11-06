# Filtered event history (U313)

This current source selectively reconciles donor `45999655` onto reviewed grouped
checkpoint `9ee2d63b`. The specified held history query/reader lifetime fixes are
adapted separately from the read-only default worktree. It is not
runtime acceptance. Existing immutable events, legacy history RPC/view, mutation
versions, central authorization and the independent metadata-snapshot interface
remain unchanged.

## Applied scope and presentation

History applies tracking type, named record, physical location subtree, literal
item/name/tag/serial search, historical person, event type and date range together.
Search includes current and recorded identifiers; `%`, `_` and backslash are
literal text. Text is debounced at 250 ms and bounded to 200 Unicode code points.
Person plus **Movements last week** answers the requested question in two choices.
Last week is the previous Monday through this Monday in the selected named zone,
including DST calendar boundaries. Canonical instants preserve PostgreSQL
microseconds; From is inclusive and Until exclusive. Invalid direct URLs retain
the protected shell and local errors, without widening the read or export.

Record kind is resolved through the existing caller-scoped identity helper and
locked while the named record remains selected. Incompatible persisted event/type
combinations stay visible as an error until cleared. Person choices use immutable
actor UUIDs and the latest recorded name, including inactive historical actors.
Duplicate names include first activity and a deterministic ordinal computed before
search/pagination. Membership directory names do not replace event provenance.
The catalog has 50 rows plus one selected identity; it never silently drops the
selected identity when searching a different name.

The URL is the applied scope for counts, paging, record return links and CSV.
Text/IME/Back and deliberate navigation cancel unsent typing; out-of-order actor
results cannot replace the current request. Export is unavailable while draft and
applied scope differ or a transition is pending. Current strict managed-generation,
actor/backend, verified-epoch and revocation ownership fences timers, actor actions,
results and export activation. Withdrawal clears retained private state. A current
explicit actor/access denial uses the existing owned route-action denial path and
locally suppresses this filter instance until a new verified scope; retired
requests cannot suppress their successor. Query/page replacement also retires an
actor-search request within the same verified component scope. The exact request
guard reaches the central denial observer before its promise continuation, so an
old `forbidden` or `actor_changed` response cannot suppress the successor query.
Current owned denial still suppresses presentation. No global membership semantics
change.
Shared spring disclosure, W05 identity entrance and W19 record/event links remain
in use. Phone history uses the existing compact representation, one row per event.

## SQL and transport boundaries

The CLI allocated forward migration
`20261020151124_inventory_history_tools.sql`, after the grouped-view migration.
`private.inventory_history_event_keys` is a security-invoker internal view and
`private.inventory_history_matching` is an invoker helper. Existing private-schema
usage is reused; no role/schema usage grants or definer authority are added.
Only three new public RPCs are exposed: `inventory_history_v2`,
`inventory_history_actors`, and `inventory_history_export_snapshot`. They require
an active caller and retain underlying RLS, empty search paths and five-second
statement-timeout configuration. Inactive/nonmember calls fail explicitly.

Pages default to 25 events and cap at 100. Event keys precede line expansion;
there is no uncontrolled nested ledger aggregate. Complete page JSON is capped
at 2 MiB, with a cumulative 10,000-line sentinel; overflow is actionable and never
a partial event. Person JSON is capped at 128 KiB. Safe-integer count validation
rejects out-of-range counts rather than rounding PostgreSQL bigint values.
Inventory/metadata versions and persisted quantities are not changed or coerced.

The history-only transport allows the three fixed RPC paths on the configured
origin, uses caller credentials, `no-store`, `redirect: error`, and verifies the
**same bearer token** through `getUser(token)` against the request member before
issuing a read. Session user metadata is not authority. Raw UTF-8 is bounded before
JSON parsing: 2 MiB page/export, 128 KiB people, 64 KiB errors. HTTP 401/403 cannot
be disguised as overflow or empty data by its error body. The five-second read
scope aborts supported fetch/body work, including a response racing retirement.
Auth SDK calls lack a per-call AbortSignal: late Auth results are ignored, but
physical Auth cancellation is not claimed. Export additionally has its existing
ten-second encompassing request deadline through auth, reading and encoding.

## Complete filtered CSV

One STABLE function statement reads the filtered event keys, current identity and
reference labels, recorded actor/metadata/custody snapshots, and full storage/site
ledger lines. It does not stitch browser pages. A later download can legitimately
differ from an earlier rendered page; snapshot time records that fact.

Each event has one `event` data row, followed by all `quantity_line` rows. A matched
move exports both debit and credit even when the location filter matched only one
endpoint. Event quantity and signed line changes stay numeric. Storage/site line
identity remains distinct even when UUIDs coincide. Recorded versus current item
identifiers and endpoint labels are explicitly named. Intentional technical IDs,
original actor, exact UTC instant, reason/reference, snapshot/environment/zone,
matching-event count and physical data-row count remain in the file. Legacy
missing identifiers remain blank. Arbitrary custom JSON, private file URLs and
credentials are excluded.

The limit is 10,000 **physical data rows**, including events and ledger rows, plus
2 MiB complete JSON and 3 MiB BOM/CRLF-inclusive UTF-8 CSV. Key/line sentinels and
preappend row/byte checks fail the entire snapshot on overflow. JSON accounting
includes delimiters and the known wrapper; export reserves a conservative
five-digit row-count header. Final wrapper checks remain. SQL `jsonb::text` bytes
are a documented representation, not a claim about PostgREST serialization; the
independent raw response limit bounds actual wire bytes. Shared CSV quoting,
control/whitespace-aware formula guards and numeric negative deltas are preserved.
Existing inventory/custom CSV columns and exact Shortfall remain unchanged.

## Evidence and remaining gates

Focused Vitest/RTL checks cover filter compatibility, exact date boundaries,
current ownership, A/B/A/Back/IME, malformed URLs, denied versus retired callbacks,
bounded transport, Unicode/escaping and complete event/ledger CSV identity.
The existing local export-memory script includes near-limit history
fixtures and the existing custody integration calls the independent-connection
snapshot/effective Data API timeout proof. pgTAP includes caller/grant/private
exposure, ledger, overflow and complete JSON boundary regressions. Authenticated
390px download coverage is authored. DB/REST/browser fixtures are not runtime evidence until run.

### Historical donor evidence

The following recorded donor results do not validate the current reconciled tree.
The pre-review local 512 MiB, one-worker batch passed 337/337 tests across
18 files, followed by an overlapping 42/42 UI recheck. Independent Astra review
then identified a request-lifetime denial race. Four new regressions reproduced
query/page replacement followed by `forbidden`/`actor_changed`; all four failed
before the correction. The corrected affected batch passed 78/78 across four files:
28 filter, 20 history-page, 15 central observer and 15 presentation-lifetime tests.
This includes six added cases and current-owned denial controls using real denial
tickets. The 78-case result supersedes affected pre-review evidence; overlapping
batches are not summed. Scoped zero-warning lint, formatting, matrix preservation
and syntax-only transpilation are separate source checks. The canonical
isolated export-memory script passed with 700 mixed physical/custody events and
2,100 complete data rows: 2,063,709 raw UTF-8 bytes, 1,685,240 CSV bytes and
39,099,653 sampled incremental heap-plus-external bytes. The independent large
history text fixture measured 37,001,208 sampled incremental bytes. These remain
below the script's 64 MiB checkpoint-sampled bound; they are not a continuous peak,
hosted concurrency, database or production capacity claim.

### Current candidate gates

Typecheck, focused Vitest and all runtime gates remain pending for this candidate.
Before acceptance, execute clean replay and upgrade, canonical actual generated
public types and comparison, pgTAP/RLS, private-profile/public-helper Data API
negatives, positive invoker reads, actual REST five-second cancellation and nested
query plans. Run authenticated downloads on the final candidate; repeat the memory script
if its source changes. Exercise desktop/390px, both themes, Full/Reduced, keyboard/native AT,
real Back and owned errors. Complete repository/full/remote gates and independent
high-risk review. No database, browser, hosted or production acceptance is inferred
from local mocked tests. All 76 audit matrix rows retain their dispositions.
