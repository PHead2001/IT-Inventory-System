# Inventory experience overhaul

Implementation and acceptance contract for one PR based on main
`299aef486eba6e3ac7594afc0e414c3769a3abf4`. The September 28 owner goal authorizes
these changes; existing inventory, custody, private-file, history and release
invariants remain in force. This document records decisions and coverage, not a
claim that unfinished work is implemented.

Historical status (2026-09-29): this document preserves the PR 22/23 overhaul
contract and its then-current evidence and open-work notes. Those PRs subsequently
landed on main at `b08906a634a338171f3926f8aa3689a1f590409d`, including the
previous drag and camera corrections. The separate, still-in-progress completion
milestone and its current acceptance evidence are tracked in
[Experience completion](experience-completion.md); the historical pending items
below are not a claim about that newer branch or its final readiness.

## Delivery and visual direction

Use `feat/inventory-experience-overhaul`, with one PR targeting main. Functional,
security and measured performance work precedes the final visual propagation.
Baseline captures and repeatable measurements belong in `experience-baseline.md`;
final evidence must distinguish local, hosted and physical-hardware proof.

The direction is a luminous spatial workspace: deep navy canvas, graphite work
surfaces, cyan edge light, restrained architectural grid lines and static texture.
Overview, sign-in and Spaces carry stronger atmosphere; dense forms and tables
use opaque calm surfaces. Real stock/custody information supplies the hierarchy,
never invented metrics or decorative charts.

- Base canvas `#060d18`, elevated surface `#101e30`, readable text `#e8f4ff`, muted
  text `#9cafc4`, cyan accent `#50def2`, and clear semantic success/warning/error
  tokens. Verify final contrast rather than relying on these initial swatches.
- One typography and spacing system: expressive compact headings, readable body
  text, tabular numeric columns, 4/8-pixel spacing rhythm, consistent borders,
  12-pixel working-surface corners and stronger overlay elevation.
- A layered persistent shell with grouped navigation, moving active indicator,
  clear page context and comfortable mobile navigation. Preserve native anchors,
  modifier-click, focus, history and scroll restoration.
- Overview uses a lightweight original SVG/illustration derived from the actual
  closet data, not another always-mounted WebGL scene. Space views retain actual
  measurements; office stays inventory-only.
- Motion vocabulary: approximately 120 ms feedback, 180–240 ms layout/panel
  transitions and interruptible springs for manipulation. Requests start without
  waiting for exit animations. Stable route identity prevents query updates from
  replaying entrances. Drag owns its transform wrapper; surrounding layout motion
  uses a separate wrapper. Print disables decorative motion.
- OS reduced-motion and a local motion toggle preserve static visual quality.
  Continuous ambient motion pauses when hidden/offscreen, uses compositor-friendly
  effects and never drives React state each frame. No fullscreen blur stacks,
  cursor hijacking, flashing or parallax behind working forms.

Use the existing primitives and a single compatible Motion/drag-library generation.
No paid assets or second UI framework. Final design acceptance is based on real
populated screens and interactions, not a mockup or a passing screenshot test.

## Persistence decisions for independent review

These contracts require additive migrations; implementation follows independent
review of the concrete SQL approach. Do not change old migration files.

### Effective forms and protected controls

Extend the existing definition with optional section/control `visible` booleans
and `applies_to` arrays using the existing `quantity`/`asset` vocabulary. Missing
visibility means visible; missing applicability means the existing inherent kinds.
The effective renderer intersects section, control, custom-field applicability and
inherent built-in type restrictions. Persist visibility in published revision
definitions/normalized layout; never erase a canonical value because it is hidden.
Name and Category must be reachable exactly once for both kinds; Asset tag must
be reachable exactly once for assets, with an optional value. Item code and reorder
threshold are quantity-only; asset tag and serial number are asset-only.

The compiler rejects hidden/inapplicable ancestors of protected or required
controls. The editor offers moving protected controls to Identification when
removing a populated custom section. Optional built-ins are hidden/restored, not
deleted. Removing a custom placement retains its field definition and stored values;
retirement is a separate consequential action. A required field cannot lose its
last reachable applicable placement. Same-type choices and stable field/option
identities retain existing evolution rules.

Historical revision JSON remains immutable. Active form reads supply a deterministic
safe Identification placement for a newly protected control missing from a legacy
definition; only an explicit save persists the effective layout. Historical event
rendering continues to use the actual original revision. New compiler enforcement
must also cover legacy publication entry points, not only the new editor.

### Atomic Save changes

Migration-first compatibility requires a versioned read: `metadata_form_get` retains
the baseline strict JSON shape without overlays; `metadata_form_get_v2` supplies
effective visibility and protected/Item code placements to the new application.
Legacy reads fail explicitly with `client_upgrade_required` after a publication
or returned draft uses unsupported capabilities; they never silently strip a form
into a lossy editable projection. Legacy draft save/publication check this capability
boundary under catalog/category/draft locks after authorization and completed-receipt
replay, before fresh writes. Exact draft discard remains available. Compatibility
tests use the actual baseline parser, not the more permissive new parser.

Add a hardened `metadata_form_save(request_id, payload)` operation with the existing
actor/receipt/catalog lock discipline, READ COMMITTED requirement and timeout bounds.
Payload carries original actor/category, expected published revision, nullable
expected draft UUID/version and the edited definition. A draft absence is an exact
baseline, not permission to adopt a newly created draft. Never silently replace an
expected version after a conflict.

One transaction compiles the proposed revision, validates effective visibility,
updates the active pointer/needs-metadata projection and records revision/event/
successful receipt. Reuse existing compiler and publication internals rather than
parallel validation rules. No multi-request partially active form. Successful retry
replays the original publication after current authorization before stale checks.

The server classifies consequences by comparing the actual proposed definition
with the locked baseline. Layout, labels and other non-impacting edits save directly.
Tightening rules/requirements, narrowing applicability, retiring fields/choices or
removing a populated section requires one confirmation. A first save may return a
typed `confirmation_required` result without changing the active form, together
with actor-bound, expiring review evidence. Confirmation is a distinct request bound
to the same normalized definition, original draft/published identity and current
inventory impact fingerprint. Edited proposals or changed references invalidate it.
No browser-supplied impact summary or automatic confirmed rebase is authoritative.

Independent review requires a separate private form-save review table because the
legacy review table requires a nonnull draft. It stores actor/category, nullable
original draft identity with version `"0"` only for absence, original publication,
exact normalized proposal JSONB, reference fingerprint, targeted impact, expiration
and initial request UUID. No direct client grants. Acquire the latest exclusive
catalog helper (including its existing shared custody-placement lock), category/
draft and ordered inventory locks before staging. The existing compiler writes
canonical identities: confirmation-only compilation must run in a rollback-only
subtransaction with a narrowly caught internal sentinel, not create-and-delete
revision rows. Actual validation failures propagate. Locks remain outside staging.

Initial confirmation results are completed receipts. Their retries replay the same
token even if expired; requesting a new review uses a new request UUID. Confirmation
uses a distinct request UUID and the identical proposal/baseline plus `review_token`.
Successful replay follows current authorization but precedes obsolete baseline/token
checks. No committed null-result receipts or canonical field/option/draft side effects
may remain after confirmation-only/cancelled/failed operations. Final publication
reuses the current set-based needs-metadata refresh without changing item versions
or persisted values. Consequences compare against the active effective publication,
not an unpublished draft; unknown rule changes conservatively require confirmation.

Results distinguish `status: "confirmation_required"` (`changed: false`, token,
stored expiration, exact expected identities, reason entries with field/section/
option IDs and affected kinds, affected totals and **newly** needs-metadata totals)
from `status: "saved"` (established entity/version/event/changed envelope plus
category and published revision). Counts and versions are decimal strings. Affected
does not mean all category records are invalid; summaries distinguish retained legacy
values and newly incomplete records from previously incomplete ones.

Retain legacy draft RPCs and explicit recover/discard for existing server drafts and
browser recovery. An accepted save can consume only the exact reviewed draft and
must leave historical receipts valid. Failed/cancelled saves preserve recoverable
work and the active revision. The UI's Saved state follows confirmed publication,
not staging success. Final RPC/result details will be recorded with reviewed SQL.

### Item and site codes

Add nullable `quantity_items.item_code` with trimmed display text, a bound of 100
Unicode characters, no control characters, and a unique case-insensitive normalized
key including archived definitions. Preserve punctuation and leading zeros; blank
becomes null. Use the same database normalizer on creation, metadata update and
opening-site creation. Old callers omitting the key preserve it; explicit null/blank
clears it. Version, before/after event and receipt update atomically. The ordinary
form calls it Item code (SKU), not Asset tag or manufacturer part number.

For compatibility, append the normalized item-code key to a receipt payload only
when the caller supplied it. Never inject a null or presence flag into historical
omitted-key requests. Resolve omitted updates against the locked current row after
receipt replay. Codes remain reserved across archived current definitions, not
forever after an explicit edit/clear. Use PostgreSQL case normalization for the
unique key, preserve display case, trim Unicode whitespace consistently and reject
control characters; client checks give feedback but never replace database checks.

Append Item code to existing CSV prefixes, project it through quantity reads/search/
labels and distinguish ambiguous bare scans from unique matches. Stable UUID QR
identities remain unchanged. Do not manufacture item codes for existing rows.

Preserve the existing label grammar: explicit `LOC:` and `AST:` labels retain their
meaning and foreign URLs remain invalid navigation targets. A separate manual
Quantity Item code mode performs an authorized exact lookup, allowing legitimate
codes such as `/SKU`, `ABC:001`, or `AST:001` without interpreting them as routes.
Count Unicode characters rather than UTF-16 units. A pure public, authenticated-only
normalization function supplies the same string rules to the private mutation helper
and the invoker/RLS lookup; normalization does not read data or grant access to the
private schema. Case comparison occurs in PostgreSQL, not a divergent JavaScript
case conversion. Normal bare identifiers still return all matching kinds for
explicit disambiguation.

Site code suggestion is client feedback over the existing server constraint:
name-first, uppercase ASCII words separated by single hyphens, bounded to the
current 100-character maximum with a valid leading character. Invalid/empty slugs
require an explicit code. An untouched or cleared code follows the name; a nonempty
manual edit stays fixed. Show the actual suggested code and surface collisions
without silently choosing a new permanent identity.

### Authorization and request work

Retain authoritative `getUser` plus live membership checks and database enforcement.
Use only request/render-scoped memoization or an explicitly passed request context
for repeated reads, never global private/auth caches. Designer identity checks
coalesce focus/visibility events and keep same-user work mounted while checking;
commits stay server-authorized. Explicit identity loss/revocation locks and hides
private edits, cancels gestures and clears their rendered state. Recovery remains
actor/environment/category-bound; transient errors retain recoverable work behind
a retryable state and cannot authorize a save.

Remove the duplicate unfiltered root telemetry mount introduced by PR21 and retain
one existing opt-in filtered protected collector. Do not change provider activation,
production opt-ins or auth verification semantics for performance.

## Spaces, location contents and print state

Use a small validated Git registry keyed by stable logical root codes. Initial
entries are IT Closet (`ITC`, existing measured model) and IT Office (`ITO`,
inventory-only); the configured default remains ITC. Geometry imports remain
build-time/database-independent. Resolve an old `/room?location=...` link to its
containing registered space; unknown/inactive spaces fall back explicitly rather
than rendering the closet under a different name. Adding a room definition and
registry entry must not require a new navigation branch.

Keep `/room` as the compatible Spaces & maps route with `space`, `location` and
`page` URL state. Client selection changes highlight and heading immediately and
updates browser history without waiting for an RSC data navigation. An authenticated
no-store contents endpoint separately loads the same aggregate/page semantics as
ordinary inventory. The response carries its requested space/location/filter/page
identity; latest generation and an AbortController prevent stale contents under a
new heading. User/environment changes clear state and pending work. Popstate updates
selection and contents. The canvas stays mounted while contents load; changing
spaces cancels old work and restores only compatible per-space camera state.

The hierarchical location browser and space picker reuse existing hierarchy,
natural-order and eligibility helpers. Persistent private selection keys include
user and environment; invalid selections are checked against fresh reference data.
Do not cache authorization. Modeled-space focus, camera controls, floor guards,
hover labels and same-location refocus remain existing scene responsibilities.

The label queue separates a validated record snapshot from local sheet layout.
Queue/identity changes trigger bounded generation-checked revalidation; paper,
size and copy changes reuse the same eligible record snapshot when possible.
Automatic rendering retains the previous valid sheet with a visible pending state
until its replacement is ready. Printing is disabled while the latest generation
is unresolved, denied, unacknowledged or its fonts/code images are not ready.
Ordinary descriptive updates refresh without a dialog; lifecycle and identity
changes retain explicit acknowledgement. Direct browser print must use the same
eligibility guard. Text fitting operates within physical label dimensions with
measured typography and honest overflow; code payloads and quiet zones never shrink
below supported readability to accommodate descriptive text.

## Implementation ownership and gates

The lead owns Git/PR, architecture and visual acceptance. One worker at a time owns
the local database, production build and browser ports. Persistence/publication
contracts receive independent principal review before implementation; ordinary UI
receives independent code review. Every checkpoint stays in this branch.

1. Capture baseline screens, requests, bundles and repeated production-build
   scenarios. Establish before-state repros and comparable sampling.
2. Implement protected visibility, one-save publication, Item codes and identity
   contracts with additive migrations and authoritative tests.
3. Split Settings loading, preserve editor state across routine verification,
   improve measured request paths and implement hierarchical multi-space browsing.
4. Implement automatic coherent label previews and physical print layout.
5. Implement and inspect the visual/motion system across every route and state.
6. Certify all contracts, comparable final performance, signed-in isolated preview,
   fixture cleanup, final CI and fresh Codex review on matching final HEAD.

## Requirement-to-evidence matrix

### Historical checkpoints and current evidence requirements

The checkpoint narrative and matrix below describe the original overhaul work,
not current failure counts or current host status. The completion milestone has
since recorded a fresh complete local gate at `03233c3`; the then-held workflow
bytes were committed at `e08996b` unchanged. Keep the full command results, counts,
workflow provenance and exact-SHA remote CI/review status in the completion PR.
A local pass is separate from normal Linux CI certification. Current-source visual
and print artifacts are still being refreshed and require rendered acceptance;
physical-printer, real-phone and real reboot proof remain explicit limitations.
No production certification follows from local gates, runner activation or a pilot.

The baseline at `299aef4` is recorded in `experience-baseline.md`. It includes
36 desktop/phone screenshots and five warm samples per scenario. Both the old
Settings screen and quantity detail fetched 49 category forms; focus/visibility
produced two designer verification requests. Those observations determine the
focused-loading and verification work, rather than speculative auth changes.

Settings routes and name-derived site-code behavior are implemented with focused
component and browser coverage. The corrected Name-before-Code order has a DOM-order
regression. The earlier local Storage `v1.77.9` failure passed its original
denial-then-large-upload browser regression and a same-agent recovery probe. The
baseline's 49 category-form fetches and two designer identity checks remain
historical measurements, not matched final-source performance proof.

The historical pushed checkpoint `3d32be39dea752d09c0bcd62589e32497a896164` passed 626
application tests, 481 pgTAP assertions, all configured database integration suites
and generated-type comparison locally. Its full production-build E2E run passed 56
of 87 browser cases and failed 31; adaptation and triage were incomplete then. Focused browser
checks at that checkpoint covered designer pointer reflow/resize and interruption, mobile panels,
save/recovery, native CLS/INP attribution, rendered label codes and corrected print
pagination. Focused successes do not turn the 87-case run green. Exact-checkpoint
CI run `36502707682` passed its application job, while the database job was cancelled
after about 30 minutes, consistent with its configured timeout; the cancellation initiator was not confirmed. The required gate failed. Cancellation does not by
itself prove a database regression, nor does the local database pass replace CI.

The earlier checkpoint `78ec7dc9a46881c634c573f1401735002f1a2248` had a
finding-free Codex review but seven of 65 browser cases failed. A location-ancestry
P2 and a newer P2 from the `3d32be3` review had local corrections; their review
threads still needed green replies then. That checkpoint dirty tree also included first-paint
reduced-motion, sticky navigation, RoomDefinition identity and camera focus after
restore corrections. Focused browser/unit checks and independent review support
those corrections, but broad local/browser reruns and exact-final-SHA review/CI were
pending at that checkpoint. The emitted telemetry field is `eventTarget`; a focused browser check
observed a native CLS shift of 0.0020345 with `hadRecentInput: false`, source
`inventory-location-results-tree-2`, and an emitted 0.002 value.

Historical hosted evidence exists on the isolated PR22 preview; final-SHA hosted acceptance
was pending at that checkpoint. The replacement Supabase child `hshhtmnwejpfjyzuzdej` was reported active and
healthy with functions deployed, and the preview-only file-validation HMAC pair was
configured on that child and its Vercel branch environment. The exact `3d32be3`
preview deployment passed ten signed-in stages across staff/viewer/maintainer roles,
items, files and forms, plus seven direct negative API checks. Supported cleanup
confirmed two temporary files and four storage objects removed. Temporary actors
and fictional inventory were retained in the isolated preview for final-SHA
checks and supported cleanup; current fixture state requires separate verification. Neither preview health nor these stages establish
final-source hosted acceptance. PR22 was closed and reopened under owner
authorization; no production access follows from that action.

The visual propagation has rich desktop/phone captures and two real interaction
recordings. Root accepted representative Overview, inventory and designer direction,
including a corrected three-pane desktop designer and narrower panel modes, but
final visual acceptance across routes and states was pending at that checkpoint. Focused print evidence
corrected a one-label/five-page defect: a browser case decoded QR/Code 128 and
checked the direct-print guard; Poppler found one page in each of four one-label
size/paper PDFs and two pages in each of two 20-label PDFs. Physical print and
hardware-specific behavior remain separate acceptance work.

Completion requires evidence for every listed boundary; an implementation commit
or a partial checkpoint alone is insufficient.

The performance acceptance contract requires a deterministic fictional dataset shared
by separate production builds of the baseline commit and final candidate. The
original pre-reset database was not snapshotted, so its 49-category timings remain
historical observations, not directly matched final comparison samples. Pin the
same detail target and populated/empty locations, record fixture counts, and keep
browser/runtime/instrumentation identical. Run five warm samples per comparable
scenario with normal visual effects enabled; report median and nearest-rank p95
(the maximum at this sample count). Fresh-context single samples remain descriptive.
Supabase HTTP fetch counts and summed parallel request durations must not be
presented as SQL query counts or critical-path latency.

Later auth timing evidence is recorded in the ignored
`.local-tools/auth-latency/PROVENANCE-eb8bd83.md` and its SHA-specific captures.
The before/after summary files support removal of a redundant lookup and a local
improvement, with mixed hosted results; they do not establish an overall speedup.
Five-sample browser medians, nested server spans and fresh browser contexts against
a warm server/database must retain their provenance. The provenance also records
the overwritten older hosted raw browser JSON and the absence of a complete local
server-stage log; retained summaries cannot reconstruct missing raw evidence.

The following matrix preserves historical coverage and the acceptance still required
at that checkpoint. Use the completion PR and [Experience completion](experience-completion.md)
for newer results rather than carrying these old counts or review states forward.

| Requirement                            | Local implementation and evidence                                                                                                                                                                                                                                                         | Remaining acceptance evidence                                                                                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings landing and five sections     | Addressable routes, focused loading and name-derived site-code behavior have component/browser checks. The pushed app gate has 626 passing tests.                                                                                                                                         | Recheck every role/state on final source; verify label defaults stay independent of form-definition reads and all deep links/Back/Forward paths remain stable.                                                                                 |
| Designer workspace and sections        | Focused browser runs cover held pointer reflow/resize, cancellation, undo, phone panels, persistence and recovery. The corrected three-pane desktop and narrow panel layouts have captured bounds; two real interaction recordings exist.                                                 | Final-source pointer edge autoscroll, keyboard reordering/focus, empty targets, nonempty section removal and rendered review at phone/desktop/200% zoom.                                                                                       |
| Protected visibility/applicability     | The 481-assertion local DB gate and designer tests cover protected controls, type/ancestor limits and publication blockers; versioned legacy reads were included in integration validation.                                                                                               | Exact-final-source DB/UI hide/restore, hidden values, old revisions and safe overlays; hosted role behavior.                                                                                                                                   |
| One Save changes                       | Local DB/integration gate exercised atomic save/publication; focused browser work covered confirmation, stale edit retention, direct phone save and draft recovery/discard. Hosted `3d32be3` role/item/form stages passed.                                                                | Final-source receipt/retry, stale/ABA/actor denial and open-form conflict evidence; repeat hosted writes on final SHA.                                                                                                                         |
| Permission interruption                | Focused browser runs covered same-user coalescing, transient retry, account switch during a gesture and recovery. Seven hosted direct negative API checks passed.                                                                                                                         | Final logout/revocation, cross-account and role behavior on exact final source; retain no actionable authorization findings.                                                                                                                   |
| Measured performance and telemetry     | Historical baseline has 36 captures/five warm samples per scenario. Filtered collector and focused unit/emitted-payload tests pass; route/token redaction and native CLS/INP browser evidence passed, including the `eventTarget` wire field.                                             | Matched final normal-motion warm/cold and feedback/content-ready runs with median/p95, requests, payload, bundle and long-task provenance. Historical 49-form observations are not matched proof.                                              |
| Site suggestion and quantity Item code | Local DB gate covered normalization, uniqueness and Item code contracts. Component/focused browser checks cover site-code suggestion, quantity form/display, label identity and scanner-safe QR; hosted `3d32be3` item stages passed.                                                     | Final-source collision/retry, omission-versus-clear, history/export and create/edit/search/scanner paths; repeat hosted write/read roles.                                                                                                      |
| Automatic label preview and printing   | Focused unit/browser work covers automatic validation, retained sheets, rapid edits, authorization, code decoding and PDF dimensions. The one-label/five-page print defect was corrected; Poppler confirmed four one-label PDFs at one page each and two 20-label PDFs at two pages each. | Final-source lifecycle/error/read-only states, visual inspection for 70x35 and 90x50 on Letter/A4, with physical-printer verification explicitly unperformed.                                                                                  |
| Locations and Spaces                   | Focused source/browser checks cover fallback/old links, ancestry, stale A/B/A results, history, immediate heading, failed contents and camera restore. Local ancestry P2, RoomDefinition identity and focus-after-restore corrections have focused evidence.                              | Full final-source room suite: dense/empty/paginated contents, same-location refocus, modeled/inventory-only spaces, WebGL loss and phone navigation; green review replies.                                                                     |
| App-wide visuals                       | Shared shell/auth/Overview and route-level propagation have rich captures and two real recordings. Root accepted representative direction and selected-field readability in the designer; reduced-motion first paint and sticky navigation fixes are dirty-tree focused work.             | Root acceptance of every named route/state, 200% zoom, keyboard focus, contrast, clipping, phone, print and reduced-motion behavior; hardware limits stated explicitly.                                                                        |
| Compatibility and final delivery       | Pushed `3d32be3` passed 626 app tests and local 481 pgTAP/all configured integrations/types. Hosted matching deployment passed ten signed-in stages and seven negative API checks; preview HMAC is configured. Two files/four objects were cleaned up.                                    | Resolve 31 of 87 browser failures and rerun the full gate; repair/certify CI database timeout; repeat local, hosted and performance checks on final SHA; resolve both P2 threads, fresh review, zero actionable threads and clean HEAD parity. |

Final acceptance requires rendered route and motion evidence, matched
performance checks with explicit hardware limitations, final-SHA local/hosted/CI gates,
and fresh review with zero unresolved actionable findings. The historical 56/87
run and two P2 thread states are checkpoint evidence, not current outstanding counts.
Temporary preview actors and fictional inventory need supported cleanup only after
the final-SHA hosted run no longer needs them.

No merge, production mutation, permission grant or promotion is authorized. The
goal's narrow authorization for fictional fixtures and a preview-only
file-validation HMAC pair has been used in the isolated PR22 child. Further
environment changes require the same verified boundary; prior PR20 credentials
cannot be reused for a new child implicitly.
