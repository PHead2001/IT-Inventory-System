# Application architecture

Published inventory form revisions, stable custom field identities and bounded custom CSV exports are specified in [published metadata](published-metadata.md).

Operational timestamp rendering and the appended CSV display-zone metadata follow [shared time](shared-time.md). The protected layout supplies one browser-resolved zone after matching UTC server/initial hydration; canonical instants and datetime entry semantics remain unchanged.

Inventory creation and site-opening forms keep per-tab recovery in sessionStorage, scoped by browser origin, backend origin, authenticated actor, inventory kind, site UUID and a distinct opaque draft UUID in the URL. Canonical creation links start a new instance and offer other pending drafts explicitly. Supported router replacement preserves unrelated query and fragment state; Back/Forward, internal return and reload recover the exact instance.

Existing quantity and asset metadata tasks use separate versioned recovery envelopes scoped by browser origin, backend origin, authenticated actor, record kind/UUID and metadata task. They share the bounded creation-input parser and limits, retain an explicit allowlist of reconciliation metadata, and preserve the original record version, published form snapshots, raw inputs, touched/cleared answers and datetime display drafts. Returning and reopening Edit details restores the task without restoring a prior confirmation. Newer records and schemas still require the existing conflict/schema review; recovered versions are never silently adopted. Actor or environment changes hide the mounted task. Recovery excludes file content, signed URLs and credentials.

An explicitly closed or replaced metadata task finalizes its own editing recovery
envelope before leaving, including normalized no-op edits that have no unsaved
semantic changes. Task close, switch and reset share the existing discard cleanup;
failed marker storage falls back only to removing the matching editing envelope.
If both paths fail or another writer replaced it, the task stays open with recovery
guidance. Repeated cleanup accepts only the same owned terminal envelope under the
current storage session and comparison checks. Reopening then starts from current
record values and a new editing instance. Pending and uncertain requests remain
blocked. An editor is not finalized merely because its current input normalizes
to no changes or its record is stale. Back, reload and external navigation retain
the existing recovery contract; cancelable navigation gestures do not finalize a
still-mounted editor.

A pristine memory-only metadata editor with no owned persisted envelope can
close or switch tasks without recovery finalization, including when storage
cannot be read during hydration. Any inaccessible envelope remains untouched.
Durable drafts, including reverted edits, still require the existing exact-envelope
cleanup; dirty, pending and uncertain work retains its safeguards.

A hidden editor whose actor or backend changed may explicitly close or switch
tasks once no command is pending or uncertain; that exit touches neither scope's
recovery. Unknown results establish the unresolved task guard before suppressing
an old actor's response, so account changes cannot make a submitted command clean.
Returning to the original scope, including after remount, recovers the original
command and request identity. Definitive acknowledgement or rejection still uses
the existing exact-envelope transitions before the stale response is suppressed;
those resolved tasks may leave without discarding their scoped recovery.

Metadata recovery stores the exact update command, actor and request UUID before dispatch. Unknown outcomes replay that command after navigation; only its matching acknowledged completion or definitive rejection may resolve a submitted envelope. Instance/sequence comparisons prevent stale mounts from replacing a newer command or terminal marker. Explicit Cancel or task discard records only that task's discard marker; successful saves retain a saved marker and expose Details saved and Done. Pristine edit opens keep their original baseline in memory without allocating storage. The edit store separately caps entries at 2 MiB, 8 MiB total and 32 record tasks; capacity and browser-quota pressure reclaim only validated saved/discarded envelopes after comparing their stored value again. Editing, submitted and invalid entries are never evicted. Mount generations and envelope comparisons prevent stale writers from reviving reclaimed tasks. Storage failure preserves in-memory work and pauses dispatch until durable request storage succeeds. Same-tab internal links require an explicit Stay/discard choice while recovery is unavailable; pending or uncertain commands offer Stay only. Explicit discard can remove only its matching editing envelope when writing a discard marker fails. Modifier clicks and new-tab links retain their browser behavior. Browser Back/Forward and reload recovery cannot be guaranteed until storage is restored; native unload warnings remain where supported. Per-tab/session recovery has the same browser-data and termination limitations as creation recovery.

Inventory result links carry an allowlisted internal return scope with normalized search/type/category/location/site/status/restock filters and page, plus a bounded row-position anchor. Anchors use page-local ordinals to keep inventory identifiers out of telemetry selectors. Record pages return to that scope or fall back to Inventory for direct or invalid targets. External, protocol-relative and malformed targets and recursive return parameters are excluded; ordinary links preserve browser modifier-click behavior. If current results no longer contain the previous page, the list redirects to the nearest available page and explains the adjustment.

Recovery retains raw core and custom input, touched/cleared distinctions, the original clean baseline, reviewed and prior published form snapshots, raw datetime wall/display timezone, opening quantity, reason and reference. Hydration and binding the durable instance into the canonical URL complete before controls become usable. If supported router navigation is interrupted, the visible recovery retry reopens that same durable UUID; it never enables a stale canonical instance. A failed initial storage write keeps the current in-memory canonical form without changing its route key. Recovered review is invalidated; a changed category schema requires explicit review of updated fields while keeping answers. Strict versioned envelopes accept only bounded JSON and the four matching create/site-open commands; credentials and file bytes are excluded. Limits are 2 MiB UTF-8 per envelope, 8 MiB across 32 instances, with no automatic eviction of pending requests or saved/discarded tombstones. These application ceilings are not a promise of available browser quota.

Before first dispatch, the exact operation, request UUID, actor and payload must be durably stored. Submitted or uncertain saves lock edits and discard, then resolve the same command and request identity. Authentication loss and idempotency/actor conflicts do not prove that a prior save failed. Only a matching definitive rejection returns to editing; only acknowledgement of the matching request writes a saved marker. Saved markers retain the completed request UUID. Terminal markers precede navigation and are rechecked on mount and pageshow; stale writers cannot overwrite them or a newer submitted request. If a completion marker cannot be written, the original durable submitted command remains available for safe retry.

Storage failures retain the current in-memory entries and native refresh/tab-close warnings, explain that browser/internal navigation may lose them, and pause first dispatch until safe request persistence succeeds. Cancel keeps its explicit Discard changes/Keep editing choice; discard must record its terminal marker before leaving. Per-tab recovery does not guarantee recovery after cleared browser data, arbitrarily closed tabs or browser termination.

The approved v0.1 plan and amendments govern Foundation and Inventory Core. PR3 implements the R3F room navigation surface.

Inventory uses a collapsed Add item disclosure with equally styled quantity-item and individual-asset paths, examples and the existing filtered return context. The protected header exposes the verified member's full name and role through a compact native account disclosure, including at narrow widths; identity is never stored separately in browser storage.

History lists summarize quantities from immutable event deltas or custody snapshots. Quantity history has null top-level endpoints: a conserved, consistent negative/positive ledger pair identifies a move and a single positive line identifies a receipt. Count corrections retain their recorded before/after/delta; zero or ambiguous transfer shapes never become invented moves. Missing or inconsistent movement deltas display Amount not recorded. Custody endpoint names use recorded labels. Older storage events only expose location IDs and current reference labels; technical event details explain this provenance and the current record name without appending it to ordinary summaries. Headings share one event vocabulary; summaries add endpoints, amounts or changed fields instead of repeating the operation.

Individual assets have one recent inventory timeline including the joined custody snapshot. Separate event identities remain separate even with matching text or timestamps. Quantity site-correction history remains distinct from movement. Recent record timelines link to `/history/events/[kind]/[id]`, which reads that exact kind and event UUID from the existing security-invoker `inventory_history_rows` view under `requireMember` and the caller's RLS. The read is bounded to two rows to detect an unexpected duplicate; it never walks pages or scans application results to find an event. New events cannot move the target out of reach. Invalid or unavailable identities yield not-found; query/identity errors remain errors. Event detail reuses the shared mapper, renderer and label provenance and links back to the record and its complete paginated history. `/history?event=kind:uuid` remains the separate custom-metadata snapshot interface.

Custom-history answers use human No/Yes/empty labels and recorded option paths, with optional raw JSON; retained web links are revalidated through the same safe HTTP(S) Open/Copy component as current details.

## System boundaries

### Login and password sessions

An ordinary signed-in visit to `/login` verifies the current Auth user and active
application membership, then opens the validated internal return path or Inventory.
Fresh password sign-in and an existing member session use the same landing rule,
so a session becoming visible while sign-in navigation is pending cannot change
the destination. Only an explicit validated `/dashboard` return opens Overview;
missing or unsafe return targets fall back to Inventory.
Inactive and nonmember accounts go to Access is not enabled. Auth or membership
transport failures show a recoverable error. Explicit `/login?switch=1` permits a
different account's credentials to be entered; it grants no access or password-change
authority and preserves the existing actor-scoped draft and queue contracts.

Ordinary password changes submit `current_password` and the new password to Auth.
The provider's **Require current password** setting is the direct-API enforcement
boundary; the application form alone cannot establish provider-wide enforcement.
Invitation/recovery email confirmation remains an explicit POST exchange. Before
rendering emailed completion and again on submission, the server checks a live Auth
identity and verified current-session JWT claims: matching subject, valid session
UUID, unexpired token and an `otp`, `magiclink` or `recovery` AMR timestamp no more
than ten minutes old. The pinned GoTrue provider represents invitation and recovery
with emailed AMR; this is not proof of a specific email template. Query flags and
client state cannot grant the exception. Stale, future or malformed emailed proof
rejects the entire password action even if current credentials are supplied: the
provider would otherwise exempt that session from checking them. Sign in again to
obtain an ordinary password session or request a new reset email. Mixed stale-email
and password AMR also fails closed; unavailable verification never mutates the password.

After a successful password update and confirmed caller-scoped sign-out, the action
returns a typed password-updated/session-closed acknowledgement and a fresh opaque
logout generation. Confirmed ordinary sign-out uses the same generation helper.
Only confirmed local Supabase sign-out creates the versioned browser-wide HttpOnly
cookie (SameSite=Lax, Path=/, no Domain, one-year Max-Age); configured HTTPS uses
Secure and the `__Host-` name, while local HTTP uses a separate cookie name.
A cookie-preparation failure is a distinct already-signed-out reminder-unavailable
result: close the tab, rather than replaying the committed password change.
A password-free
client completion clears and verifies this tab's assignment batch, exact uncertain
commands and label queues before navigating to normal sign-in. Failed cleanup keeps
the strongest durable all-cleanup tombstone and offers cleanup retry without another
password mutation. Auth entry and the protected shell read the current generation
before mounting private restoration consumers, and recheck on entry/reactivation.
Readiness is bound to pathname, full query, known server generation and the
explicit action revision. Reactivation immediately marks verification pending.
The protected controller always renders the opaque server route slot without
an ancestor Suspense or accepted-content gate. Each async protected server page
completes its existing authorization, reads, validation, `notFound()` and
`redirect()` decisions before returning a `ProtectedPrivacyContent` success body.
That content gate shares the controller's readiness and accepted-child retention;
it performs no additional generation or resource read. Keep all success, empty
and access-denied JSX branches gated. Gating the unresolved route slot itself
lets the shell send HTTP 200 before an async missing-resource decision settles.
Static Auth routes keep their query-aware Suspense boundary.
Private brand/account identity, the ordinary sign-out form, navigation, telemetry
and Settings navigation have separate content gates. The confirmed logout receipt
owner and its distinct **Finish signing out** cleanup retry stay outside those
gates so failed cleanup remains actionable after the private header is masked.
The authoritative scope observer also stays outside those gates. Layout/context providers and PageArrival pass route
children through continuously. The gated wrapper uses `display: contents` while
accepted presentation is authorized and is hidden/inert when it is revoked.
This preserves layout boxes and retained editable nodes. Existing
inventory-specific unavailable boundaries and route-kind titles stay independent
of private success content. Adding a protected page requires the same server
checks-before-content-gate contract; see the route map and proof limits in
[validation](validation.md#protected-page-content-gates).
Admission readiness and accepted presentation are separate. A same-binding
pathname/query or focus check blocks incoming children and new restoration while
keeping accepted nodes visible and focusable, including their native focus and
selection. Known logout, generation change or binding mismatch revokes presentation
immediately, before storage cleanup succeeds. Unavailable/invalid generation or
cleanup evidence masks presentation as uncertainty and retains the draft rather
than declaring a terminal identity revocation. Hidden/inert
owners remain mounted so an uncertain in-memory command and an ordinary logout
action can finish without being replaced. This does not freeze internal updates
or effects. Assignment and label bootstrap gates independently consult readiness
before a new instance can restore storage; an unchanged accepted instance does not
rehydrate merely because focus returned. Label persistence waits during checks.

The protected layout supplies the server-verified actor, backend origin, role and
configuration capability. After revocation, readmission requires a fresh caller-
scoped server check of that original binding and current privacy cleanup, with no
intervening invalidation. The logout generation alone is not identity proof.
Different actors, inactive membership and changed privileges cannot expose or
retarget a retained owner. Transient verification failures offer explicit retry.
The recovery UI offers Inventory in a new tab so the current account can use a
fresh server-authorized owner without replacing the original uncertain recovery.
Restoring the original account and retrying can reveal its retained owner; designer
revocation remains terminal until its existing explicit access/recovery flow runs.
Designers erase private input DOM and gestures before paint on known revocation
while keeping any unresolved original command in their owner. A transient privacy
verification failure masks the existing draft and requires fresh original-binding
verification without erasing that draft.

A sign-out attempt invalidates old callbacks but grants no logout/discard
authority. Scan keeps the exact reserved/dispatched command and durable original
record; only verified original-binding readmission allows explicit retry with the
same request ID and payload. There is no automatic replay or rebase, and a late
old response stays fenced after readmission. A separate shared cleanup revision
advances only after a verified authoritative all-wipe, including successful Auth
observer cleanup. That confirmed cleanup clears hydrated label queues and their
late persistence without remounting unrelated action owners. A matching generation
cannot revive a cleared queue. Unchanged checks and attempted logout do not
advance this revision.
Label hydration and persistence also compare their mounted revision with the live
authoritative cleanup revision immediately before storage access. This prevents
an old queued effect or late refresh from restoring cleared entries while React
has yet to commit the workspace reset.
Each tab keeps a verified generation in a separate sessionStorage key outside the
cleanup namespaces. A new valid generation invalidates callbacks, verifies all
cleanup, compares the exact expected generation with the current server cookie,
then writes and reads back the tab acknowledgement before release. A changed
generation restarts cleanup; unavailable storage, invalid markers and invalid or
unavailable cookies block release. A matching tab acknowledgement never overrides
an outstanding all-cleanup marker. The comparison action never writes or deletes
the retained cookie, so one tab's completion cannot consume another tab's reminder
or overwrite a later logout. Login and email-confirmation actions compare the
rendered verified generation before creating a new session; mismatch returns a
cleanup-required state, not a claim that the server verified browser erasure.
An already authenticated member landing on login cleans/checks the tab and resumes
the existing safe destination without another credential exchange.
With no server reminder, only an existing valid all-cleanup marker authorizes this
deletion; URL flags, anonymous landing and private markers never grant authority.
The cookie is a privacy reminder, not an Auth/RLS credential or cryptographic proof.
Server logout and browser cleanup are not atomic. A delivered reminder survives
first-storage-read failure and page destruction without a tab tombstone. Cookie
expiry/eviction or deliberate browser-data removal, never-delivered Set-Cookie
headers, and inaccessible cookie plus tab storage leave no durable coordination
guarantee; close affected tabs before signing in again. Server acknowledgement
compares a request snapshot, so a concurrent later logout is also checked before
new session creation and at the next protected entry/reactivation. Browser
acceptance remains separately required for these delivery and Flight boundaries.
The password form keeps its action-state owner outside the privacy gate when cookie writes trigger
a server rerender, while refreshing the server-verified sessionAvailable prop.
An unavailable/expired session hides editable fields without clearing recovery;
only the action's genuine session-closed result permits the completion cleanup.
If sign-out fails after the update commits, the UI states
that the password changed and offers the existing guarded Sign out action rather
than retrying the password change. Email-token replay rejection does not imply
one-use password mutation: an already issued recovery JWT may remain usable through
the provider until its session/expiry policy rejects it. GoTrue `v2.196.0` checks
the session's emailed AMR methods without an AMR-age limit for this provider
exemption; the ten-minute limit is an application policy, not a direct-API limit.
The disposable direct-provider check accepted a second password update using the
same already-issued recovery JWT while rejecting a second email-token exchange.
Hosted policy verification
and activation remain separate owner prerequisites in [deployment](deployment.md).

### Inventory display and bounded read contracts

Asset tags separate display spelling from lookup identity. The current
`asset_create_v3`, `asset_update_v3` and `asset_site_open_v3` mutations preserve
the exact entered case, punctuation and leading zeros after the existing outer
whitespace normalization; blank tags become null. `serialized_assets.asset_tag`
holds that display value. Its generated `asset_tag_normalized` column uses
PostgreSQL `lower(btrim(asset_tag))` and is unique across active and retired
assets. The lowercase normalization described in the legacy Inventory Core
contract below continues to apply to the original asset create/update RPCs,
their v2 versions and `asset_site_open`.

The v3 receipt payload includes exact trimmed display spelling. A case-only
edit checks the expected version, advances it once and records the old and new
display values in the same transaction as the receipt. A retry with different
display spelling is different intent. Existing lowercase rows retain their
spelling unless an explicit metadata edit changes it; migrations do not infer
original case or rewrite historical events. Legacy operations keep their
lowercased receipt identity and original successful results. Recovery accepts
the original create/site-open command names alongside the new asset v3 names;
an uncertain submitted command retains its original operation, payload, actor
and request UUID. Authorization is checked before successful receipt replay.
Permanent QR identity remains the asset UUID.

`inventory_asset_tag_lookup(p_tag text)` supplies the existing scanner's exact
tag-resolution path. It applies the same database `lower`/`btrim` rule to the
input and compares it with the unique normalized key; `%`, `_` and backslash
are literal characters. Scan parsing preserves tag spelling until that call.
The caller must be an active member, reads retain RLS, and the request is bounded
to 1,024 UTF-8 bytes and 100 characters after trimming. The returned record
retains display spelling and status, including retirement. Existing location,
asset-UUID and quantity-UUID resolution and namespace ambiguity remain intact.

`metadata_preview_batch(p_keys jsonb)` is a caller-authorized, typed projection
for ordinary result summaries. It accepts at most 25 unique `{kind, id}` keys
and a 4,096-byte UTF-8 request. Each record returns at most three answers with
`label`, `type`, `displayValue` and `truncated`, plus a record-level `truncated`
flag. Labels and display values are bounded to 160 and 256 UTF-8 bytes,
respectively; JSON escaping also consumes that budget, and the complete
response is bounded to 49,152 bytes. Choices use their immutable validated
revision paths; multi-select previews resolve at most three selected paths.
The projection omits internal provenance decoration while preserving literal
UUIDs and other identifiers deliberately stored as user answers. Full answers
remain on record details. The provenance-rich `metadata_describe_batch` API is
unchanged for existing technical consumers.

`inventory_location_entry_counts(p_location_codes text[])` reads one authorized
snapshot for at most 100 unique codes and a 16,384-byte UTF-8 request. It returns
only requested active, inventory-capable leaf destinations. One entry means one
positive holding of a nonarchived quantity item or one active individual asset;
stock units are never added to asset counts. Site holdings, zero balances,
archived definitions and retired assets are excluded. These are the same active
contents filters used by the selected-location view. Counts are decimal strings
so PostgreSQL bigint precision survives JSON and application transport. Known
zero is returned explicitly; unknown or ineligible codes are omitted. Loading,
errors and omitted codes must remain unknown. There are no aggregate-parent
totals or implied claims about physically empty storage.

Active location names are unique within their parent under
`lower(btrim(name))`; null parents share one root scope. Different parents may
use the same name. A partial unique index and authoritative checks after the
placement lock protect rename, trusted structure creation/update, activation
and reparenting. Application structure-editing privileges remain revoked.
Inactive duplicate names may remain, but activation must use a distinct name.
The migration audits existing active sibling collisions before installing
enforcement and fails with the colliding codes if any remain. It does not
rename, deactivate, delete or move data. Before retrying, an authorized
configuration maintainer must correct the reported names through the existing
name-only rename workflow with current versions. That explicit correction
retains codes, UUIDs, inventory relationships and historical names; migration
execution is not authorization for automatic data repair.

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

After an acknowledged move, Done and task switching attempt to remove only the matching completion pointer. Browser read/removal failures cannot veto closing that committed task or starting Move more after its successful fresh read. An inline warning survives task closure and explains that the completed receipt may reappear after reload. Newer, different-item and malformed pointers are left untouched. Pending and uncertain commands retain their switching barriers.

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

Scan-assignment batch recovery is client session state, not inventory truth. The per-tab origin/backend/actor-scoped CAS envelope holds context, compact operation snapshots, historical inspection and a finished flag, bounded to 200 entries/1 MiB UTF-8. The existing custody engine remains the sole writer. Its exact command recovery retains the original 262,144-byte bound and is reconciled before fresh mutations. Pending write-ahead, exact recovery readback, uncertain ledger, writer, terminal ledger and matching recovery cleanup preserve safe replay through interruption. Restored inspection is historical until an authorized current lifecycle/availability read succeeds; restoration never assigns stock. A protected-shell scope guard invalidates late callbacks and clears private context on account/backend changes even away from Scan. Only authoritative logout may discard uncertain commands. See [scan-assignment batches](labels-and-stock.md#scan-assignment-batches) for limits, ordering, privacy and Finish/End contracts.

See [labels, scanning and stock status](labels-and-stock.md) for the durable payload, route, threshold, dashboard and export contracts. Stable location codes and asset UUIDs form label destinations; labels confer no access. The label and scan path uses ordinary authenticated application routes and the existing membership/RLS boundary. QR generation is local to the application. Camera access is user-initiated, and scan content is validated before normal application navigation. If production `APP_ORIGIN` is missing, label generation and absolute-URL scans fail closed; internal relative paths and identifier payloads remain usable.

Quantity definitions may carry a nullable whole-unit reorder threshold. Low-stock state is derived from the sum of all current balances, including balances at inactive locations; it is not a second mutable inventory ledger. Dashboard, inventory filter and CSV export share this meaning. Quantity detail reads its authoritative `stockSummary` separately from editable item metadata and the metadata version baseline. Threshold changes extend existing metadata/history mutations without creating stock movement events. The database read contracts are `inventory_search_v2`, `low_stock_dashboard`, and `inventory_export_snapshot`; export snapshots are single-query, bounded to 10,000 rows, and report overflow explicitly. The low-stock CSV includes all current holdings and locations for each selected definition even when filters match a subset of holdings.

## Configuration categories and label defaults

The Settings route is readable by active members. Category and shared label-default writes require an active staff membership with `app_members.can_manage_configuration=true`; the flag is provisioned outside the application and cannot be self-granted through the Data API or JWT claims. Existing memberships default to false. The database owns this check in each exposed configuration RPC, and the application repeats it for early feedback. `configuration_events` is append-only and member-readable.

Category UUID and code are permanent. Active names are unique after case folding and whitespace normalization. A category has a bigint version, exposed as a decimal string, and a `removed_at` tombstone for historical references. Seeded categories, including Other, follow the same lifecycle; migrations do not reseed them after removal. New configurations expose decimal-string versions and affected counts; application parsing accepts legacy safe integer inputs. Existing inventory integer version, quantity and receipt contracts remain compatible.

`category_removal_review` records a 15-minute, actor-bound token containing the source, optional replacement, both category versions, exact current quantity/asset IDs and versions, and distinct historical-only inventory reference counts. It includes archived definitions and retired assets. `category_remove` locks the catalog exclusively, rechecks the reviewed references, historical counts and versions under READ COMMITTED, requires an active replacement for current or historical inventory references, and reassigns at most 10,000 current records in one transaction. Each reassignment increments its entity version and writes a descriptive metadata event with category-name snapshots; it creates no stock movement line. Existing stock, tags, locations, extension data and identity remain on the original entity. A category with current or historical inventory references is tombstoned. A truly unreferenced category may be deleted while its configuration audit event remains; a category's own creation/configuration event alone does not prevent deletion. Unchanged or failed requests do not leave partial updates or receipts.

Inventory create, metadata update and restore RPCs take a shared advisory catalog lock after authorized receipt replay and before category/entity reads. Category lifecycle RPCs take its exclusive form. Stock-only mutations keep their entity row locks without a catalog lock. These functions reject fresh Repeatable Read and Serializable transactions; successful completed receipt replay remains available under those modes. Lock wait is bounded to two seconds. The new category RPCs declare a five-second `statement_timeout` for PostgREST to hoist before the main RPC statement; runtime certification verifies this with a delayed Data API call. The 10,000-record cap is a maximum, not a guarantee of completion before the time budget.

Shared label defaults cover the current 90×50/70×35 mm size, US Letter/A4 page and QR/Code 128 format choices. The print page starts from these defaults, while each print session can choose differently. The future custom-fields engine, designer and file schema are separate work. This slice preserves inventory rows and their extension point but creates no custom-field tables or forms.

## Shared screen palette and interactive transitions

The dark screen palette is centralized in semantic custom properties in `globals.css`, including workspace, Labels, Scan, form-designer, inventory-row and closet-preview colors. Minimal interactive defaults scope the transition property list without supplying a duration. Existing animated controls opt into the shared feedback duration/easing; route and panel motion remain a separate implementation. UI scene colors keep the existing single-capture `readScenePalette` contract and its Three-compatible formats. Physical room data, geometry and material defaults are unchanged. Print/PDF/export ink remains independent of screen theme. See [interface standards](interface-standards.md) for the exact foundation scope and exceptions. Dark/Light/System persistence, prepaint handling and live scene retheme are not implemented by this foundation.
