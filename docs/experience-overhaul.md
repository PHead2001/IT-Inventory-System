# Inventory experience overhaul

Implementation and acceptance contract for one PR based on main
`299aef486eba6e3ac7594afc0e414c3769a3abf4`. The September 28 owner goal authorizes
these changes; existing inventory, custody, private-file, history and release
invariants remain in force. This document records decisions and coverage, not a
claim that unfinished work is implemented.

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

### Working checkpoint

The baseline at `299aef4` is recorded in `experience-baseline.md`. It includes
36 desktop/phone screenshots and five warm samples per scenario. Both the old
Settings screen and quantity detail fetched 49 category forms; focus/visibility
produced two designer verification requests. Those observations determine the
focused-loading and verification work, rather than speculative auth changes.

Settings routes and name-derived site-code behavior are implemented with focused
component coverage, pending integrated browser acceptance. Root inspection caught
that the first site-code edit still placed Code before Name; the corrected order now
has a DOM-order regression. The earlier local Storage
exception is not carried forward: the existing `v1.77.9` fix passed the original
denial-then-large-upload browser regression and a same-agent connection recovery
probe on September 28. An unrelated site-form locator failure from the full Files
run is not represented as a green full-suite result.

The functional working tree has passed a fresh local database gate (481 pgTAP
assertions, all configured integration suites and generated-type comparison),
including atomic form saving, versioned legacy form reads and Item code contracts.
Independent source reviews accepted the publication/compatibility and designer
identity boundaries after fixes. These are working-tree checkpoints, not final-SHA
certification. The focused production-build Chromium sweep now passes all 17
cases in `experience-overhaul.spec.ts` and `metadata-designer.spec.ts`, including
on-screen pointer reflow/resize before release, gesture interruption on account
switch, rendered QR/Code 128 decoding and PDF dimensions, phone layouts, persisted
layout reload, unsaved recovery and legacy draft discard. The adapted legacy
custody flow now passes 3/3 browser cases, including bounded label search.
Remaining legacy suites, final visual acceptance and the matched performance
comparison are outstanding.

The initial PR checkpoint `78ec7dc9a46881c634c573f1401735002f1a2248` received a
completed Codex review with no findings; its Linux CI passed application and
database checks but failed seven of 65 browser cases. The later pushed checkpoint
is `5c05437`, with further visual, test and review fixes in a dirty working tree.
Checkpoint CI reported a `designer-model.test.ts` formatting failure, corrected
locally but not certified on a new SHA. A newer Codex P2 location-ancestry finding
has a local fix with eight unit and one browser checks passed; its review thread
remains unresolved and the fix is unpushed. The emitted telemetry wire field is
`eventTarget`; the focused browser rerun passed native INP and verified a native
CLS shift of 0.0020345 with `hadRecentInput: false`, source
`inventory-location-results-tree-2`, and an emitted 0.002 value. None of these local corrections
replace fresh exact-SHA CI and review.

Hosted acceptance is pending. The earlier Supabase PR22 child
`bhqrwxclpggeurtbzfps` was removed before configuration completed. A replacement
child, `hshhtmnwejpfjyzuzdej`, was observed `ACTIVE_HEALTHY` with
`FUNCTIONS_DEPLOYED`. A user-authorized PR22 preview secret was retrieved to an
ignored local file; the child's Vercel branch environment and exact `5c05437`
deployment were verified ready. Three temporary staff/viewer/maintainer accounts
are recorded in an ignored ledger, and their sign-in and membership reads passed.
The preview-only file-validation HMAC pair is installed: its database key is active
and TLS-verified, and the matching branch-only Vercel environment setting is added.
The current `5c05437` deployment predates that setting. A new deployment, hosted
workflows and supported fixture cleanup remain pending. The PR was closed
and reopened under owner authorization;
that workflow does not grant production access or establish preview acceptance.

The representative visual/navigation slice has 14 focused component tests passing
across inventory rows, room links and the measured static closet preview. App-wide
visual propagation has 60 working-tree captures. Root found a four-child designer
grid defect; its layout and wrapping corrections are in the working tree. Root
accepted a fresh 1440px desktop designer view with the selected field readable
across three panes; focused 1024px and 390px geometry checks passed. Telemetry has 42 focused
unit tests passing. The restored label guards have 19 focused unit tests passing.
These working-tree checks do not establish final rendered acceptance across all
routes and states or full E2E behavior. A confirmed print defect produced five
pages for one label. The corrected print flow passed the focused browser case at
`experience-overhaul.spec.ts:852`, including rendered QR/Code 128, quiet zones and
the direct-print guard. Poppler inspection found one page in each of four
one-label size/paper PDFs and two pages in each of two 20-label PDFs.

Completion requires evidence for every listed boundary; an implementation commit
or a partial checkpoint alone is insufficient.

Final performance comparison will use a new deterministic fictional dataset shared
by separate production builds of the baseline commit and final candidate. The
original pre-reset database was not snapshotted, so its 49-category timings remain
historical observations, not directly matched final comparison samples. Pin the
same detail target and populated/empty locations, record fixture counts, and keep
browser/runtime/instrumentation identical. Run five warm samples per comparable
scenario with normal visual effects enabled; report median and nearest-rank p95
(the maximum at this sample count). Fresh-context single samples remain descriptive.
Supabase HTTP fetch counts and summed parallel request durations must not be
presented as SQL query counts or critical-path latency.

| Requirement                            | Local implementation and evidence                                                                                                                                                                                                                                                                                                                                                                                                                       | Remaining acceptance evidence                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings landing and five sections     | Addressable routes, focused loading and name-derived site-code behavior have component checks. `experience-overhaul.spec.ts` covers deep links, active navigation, Back/Forward, selected-area loading and viewer explanation in the 17-case local sweep.                                                                                                                                                                                               | Rerun on final candidate, including label defaults without form-definition fetches and read-only states; hosted role proof.                                                                                                                                           |
| Designer workspace and sections        | The 17-case sweep covers held pointer reflow/resize, cancellation, undo, phone panels, persistence and recovery. `designer-model.test.ts` covers cross-section moves and hierarchy constraints.                                                                                                                                                                                                                                                         | Final rendered interaction recordings, edge autoscroll, keyboard reordering/focus, empty targets and nonempty section removal; recheck after the local formatting correction.                                                                                         |
| Protected visibility/applicability     | The 481-assertion DB gate and `designer-model.test.ts` cover protected controls, type/ancestor limits and publication blockers; versioned legacy reads were included in integration validation.                                                                                                                                                                                                                                                         | Final candidate DB/UI run for hide/restore, hidden values, old revisions and safe overlays; hosted role behavior.                                                                                                                                                     |
| One Save changes                       | DB/integration gate exercised atomic save and publication; local browser sweep covered targeted confirmation, stale edit retention, direct phone save and draft recovery/discard.                                                                                                                                                                                                                                                                       | Final candidate receipt/retry, stale/ABA/actor denial and open-form conflict evidence, plus signed-in hosted save.                                                                                                                                                    |
| Permission interruption                | Local browser sweep covered coalesced same-user checks, transient retry, account switch during a gesture and recovery.                                                                                                                                                                                                                                                                                                                                  | Final logout/revocation and direct API-denial proof; hosted cross-account/role checks.                                                                                                                                                                                |
| Measured performance and telemetry     | Baseline has 36 captures and five warm samples per scenario. Filtered collector and 42 unit/emitted-payload tests pass locally; route/token redaction and native CLS/INP browser evidence passed, including the `eventTarget` wire field.                                                                                                                                                                                                               | Matched final normal-motion warm/cold and feedback/content-ready runs with median/p95, requests, payload, bundle and long-task provenance.                                                                                                                            |
| Site suggestion and quantity Item code | Local DB gate covered normalization, uniqueness and Item code contracts. Component and browser checks cover site-code suggestion, quantity form/display, label identity and scanner-safe QR; the 17-case sweep decoded rendered QR/Code 128.                                                                                                                                                                                                            | Final candidate collision/retry, omission-versus-clear, history/export and all create/edit/search/scanner paths; hosted write/read roles.                                                                                                                             |
| Automatic label preview and printing   | `label-designer.test.tsx`, `label-sheet.test.tsx` and the 17-case browser sweep cover automatic validation, retained sheets, rapid edits, authorization, rendered code decoding and PDF dimensions. Nineteen focused label guard tests and custody 3/3 pass locally. The one-label/five-page print defect was fixed; a focused browser case passed, and Poppler confirmed four one-label PDFs at one page each and two 20-label PDFs at two pages each. | Final-source lifecycle/error/read-only states and visual print inspection across both 70x35 and 90x50 sizes on Letter and A4.                                                                                                                                         |
| Locations and Spaces                   | `spaces.test.ts` and the local browser sweep cover fallback/old links, ancestry, A/B/A stale results, history, immediate heading, failed contents and camera restore. Separate room E2E cases exist for real WebGL and fallback. The ancestry fix passed eight unit and one browser checks locally.                                                                                                                                                     | Final full room suite for dense/empty/paginated contents, same-location refocus, modeled/inventory-only spaces, WebGL loss and phone navigation; resolve the P2 thread after final evidence.                                                                          |
| App-wide visuals                       | Shared shell/auth/Overview and representative inventory/detail styles exist in the dirty tree; 14 focused component tests cover inventory rows, room links and the static preview. Sixty app-wide captures exist; the four-child designer grid/wrapping fixes have root-accepted 1440px selected-field readability and focused 1024px/390px geometry passes.                                                                                            | Root rendered acceptance across every named route and state; real interaction recordings, 200% zoom, focus, contrast, clipping, reduced motion and normal-motion performance.                                                                                         |
| Compatibility and final delivery       | Earlier 481 pgTAP assertions, configured integration suites, generated types, 17 focused overhaul cases and 3 adapted custody cases passed on working-tree checkpoints. PR22's replacement child and three role sign-in/membership reads passed; preview-only HMAC database and branch environment settings are installed.                                                                                                                              | Deploy after the environment change, then complete app/DB/browser gates on final source, hosted staff/viewer/maintainer workflows with supported fixture cleanup, independent review, exact-SHA CI/Codex, zero actionable threads and clean local/remote HEAD parity. |

The lead must deploy the updated branch environment and complete hosted role
workflows, accept the rendered
route and motion evidence, resolve
the verified P2 review thread, and obtain a fresh review plus matching final-SHA CI.
The browser owner must complete the remaining targeted/full runtime checks; source
tests and preview health alone cannot close those gates.

No merge or production mutation, permission grant, secret installation, setting
change or promotion is authorized. The goal separately authorizes minimal fictional
fixtures and, if required, an environment-specific file-validation HMAC pair through
the documented process in the verified isolated preview. Existing preview credentials
belong to their verified environment; prior PR20 credentials cannot be reused for a
new child implicitly.
