# Search, commands, and keyboard shortcuts

The protected shell owns one command provider. Header Search and Ctrl/Command+K
open a keyboard-navigable palette; the help button and ? open its shortcut sheet.
Both share one modal focus owner, background inertness, Tab containment, visible
Close, and Escape return to its original connected, visible, noninert invoker
under the same authority, unless a leave-guard dialog owns focus. Accepted
navigation focuses the authoritative destination primary heading; inventory
search focuses its ordinary field.
Full motion uses a 240ms visual spring; effective Reduced motion opens immediately.

## Commands and preferences

The typed registry supplies commands, shortcut labels, navigation badges and help.
It exposes navigation and narrow tasks, never stock-mutation payloads. Shortcuts
are /, N, S, L, G then I/H/M, ?, and Ctrl/Command+K. G expires after one second and
cancels on unrelated keys, focus change, blur or route change. Held modifier hints
reset on blur. Browser/assistive modifier combinations are preserved except the
documented Ctrl/Command+K binding. Users can disable every application shortcut
through Settings; ordinary buttons remain usable.

Typing, editable content, IME/keyCode 229, repeats, prevented events, active
cameras, exclusive scopes, and open dialogs/menus/listboxes exclude shortcuts.
One window keydown/keyup owner and blur handler own this behavior. A versioned
preference key is naturally origin-scoped and also includes backend and actor.
Storage failure reports a session-only fallback. Only a boolean is stored.

Staff N opens the established individual-asset/quantity tracking choice. Move
searches navigate with task=asset_move or task=quantity_move. DetailTasks derives
current available choices; TaskWorkspace consumes each intent once before using
its existing draft-discard, pending and uncertain guards. Unknown/unavailable
intents explain without erasing a task. Removing the consumed URL parameter
prevents a remount from reopening a closed task. Retired or site-held assets gain
no forced storage move. Existing authorization, versions, review and retry
identity stay authoritative at submission.

Native URL consumption omits only Next's history bypass markers; its supported
history wrapper retains router state and synchronizes useSearchParams. Application
history state, unrelated query parameters and hashes remain. Commands and ordinary
links share the canonical leave guards in metadata forms/designers and custody
management; declined leaves and recovery/pending/uncertain decisions remain there.
Add mode focuses a connected tracking choice, including transitions from an open
palette. Arrow selection scrolls only the result viewport, immediately in either
motion mode, and wraps without scrolling the page.

Print label selects the established typed asset/quantity/location queue intent;
sites are not targets. Queue/review/print controls remain deliberate; no automatic
printing occurs. Scan opens its existing workflow. Viewers receive no Add/Move
commands.

## Route and privacy ownership

The command provider sits inside the existing RouteMotionProvider, beneath the
protected privacy, camera, operational-time/assignment and motion providers.
Navigation and privacy checks retain the mounted shell, forms and camera state.
Opening, searching and executing require the protected boundary's fresh
presentation grant. Caller getUser is an additional check and cannot authorize
an unverified or revoked presentation. Synchronous privacy-revocation and
assignment-invalidation subscribers abort requests, discard private query/results
and focus tickets, and dismiss the overlay without returning focus.

Commands request the existing shared leave decision before calling the supported
route router. They recheck the captured lifetime after that decision; declined
leaves create neither route progress nor focus work. Ordinary commands do not
invalidate route motion. Native Back/Forward remains instantaneous, and accepted
application Back retains its approved animation and restoration contracts.

The route provider owns command tickets. Each captures its provider and mount,
actor/backend binding, privacy generation/revocation and assignment epoch,
pending epoch, and accepted-navigation serial. Every accepted push advances that
serial, including a repeated same URL. Native history, terminal failures,
revocation, assignment invalidation and unmount retire old work. A same-binding
ordinary recheck pauses the original ticket while fresh authority is absent;
only that same grant can resume it. Binding drift is permanent for the old
ticket, including A to B to A changes. No refreshed binding rewrites a ticket.

Arrival focus observes currentPrimary/subscribePrimary from canonical readiness.
Fallback headings, hidden retained content, pathname-only matches and unrelated
query destinations do not qualify. The target must be inside the authoritative
visible, noninert primary. The ticket and grant are rechecked and consumed before
focus. Observing readiness neither acknowledges a commit nor settles pending work.

A consumed task URL has one explicit same-primary handoff beneath RouteReady.
It requires the exact originating record/query/task, mounted authoritative
primary and fresh grant. It removes only task through the supported native
history wrapper, retaining unrelated query/hash and Next/application state, and
publishes the same primary's effective readiness key. A command ticket may follow
only that recorded handoff. There is no router replacement, synthetic history
event, new navigation intent or general query exclusion. A hidden retained
workspace cannot consume or open the task; the privacy boundary still verifies
the changed URL through its ordinary contract.

The handoff is scoped to a separate provider-owned navigation identity. Only
accepted application navigation and native traversal advance it and capture the
exact destination. A later matching original task URL rearms the same source
only after the React router commits that full key, the original primary remains
connected/visible and fresh privacy returns. Identical cached children require
no remount or forced refresh. A raw URL change or unrelated navigation cannot
rearm it; outgoing pending work retains its clean alias. Native history can
restore functional readiness while permanently retiring old command focus.

## Caller-authorized bounded search

The additive command_palette_search_v1(text,text,text) RPC is SECURITY INVOKER with
qualified objects and an empty search path. It checks active membership before
data and preserves RLS. Only authenticated receives EXECUTE; PUBLIC, anon and
service_role do not. Ordinary inventory search is unchanged.

The closed purpose selector is all (default), move, or print. It filters every
field stream before nearest-neighbor limits, deduplication, global ranking and
the 20-entity cap. Move searches active assets/quantity definitions even under
historical scope; print searches assets/quantity definitions/locations; ordinary
search includes all four kinds. hasMore counts eligible entities for that purpose.
This is preliminary discovery, not availability/authorization for a mutation;
fresh detail/task guards remain authoritative.

Queries trim outer Unicode whitespace, allow at most 200 codepoints and 800 UTF-8
bytes, and reject controls. Active is default; an explicit all-records toggle
includes lifecycle chips. Blank queries return no database entities. One/two
characters match exact identifiers only; longer queries use true pg_trgm word
similarity at fixed 0.35 threshold. Static commands support approximate matching.

Nine GiST expression indexes cover asset name/tag/serial, quantity name/item code,
location name/code and site name/code. Each field contributes at most 21 eligible
exact candidates and 21 eligible nearest-word-distance candidates. The indexed
expression is `command_palette_normalize(field)`, an immutable invoker helper
using the same explicit Unicode whitespace set and lowercase for query, fields
and indexes. Distance orientation is
field OPERATOR(extensions.<->>) query, equivalent to 1-word_similarity(query,field);
its threshold operator is %>. Exact candidates rank first, best field matches
deduplicate by (kind,id), and kind/id break ties deterministically. At most 20
entities return with hasMore based on the 21st unique entity. Base records include
zero-stock definitions and empty locations/sites; holdings never duplicate rows.
Duplicate serials remain legal and return separate named assets.

Version-one rows expose kind, id, name, code, assetTag, serialNumber, status and
matchedField. Database JSON is capped at 64 KiB; the endpoint validates its schema
and 20-row cap. Response text limits count Unicode codepoints, matching PostgreSQL
`char_length`, including supplementary characters. Internal identities are not
rendered as normal text.

Inventory rows add optional current context: up to three authorized named storage
locations or sites, plus `hasMore` from a fourth-place sentinel. Assets use their
current storage/site fields; quantity items use positive storage and site holdings.
Enrichment follows entity deduplication and the twenty-result cap; it never
aggregates all holdings or reads event history. An explicit empty context means
no current storage/site; legacy absent context remains unknown and is omitted.
The forward normalization/context migration must deploy before context is accepted;
database execution, generated types and authenticated KNN checks remain required.

The private no-store POST endpoint caps streamed bodies at 4 KiB, requires
same-origin requests, rechecks Auth/membership with the caller SDK, propagates
cancellation and supplies one eight-second lifetime covering body reads, caller client setup,
Auth verification, membership and RPC reads. The caller fetch composes this
lifetime with existing Request/init signals; bounded waits also retire adapters
that fail to settle. Cleanup cancels timers/listeners and releases the body reader
without waiting for a nonsettling stream cancellation. JWT/session and access
denials remain 401/403; transient Auth/read failures remain retryable 503s. Invalid,
timeout and read failures offer Retry, never No matches. Session/access denial
clears private search and dismisses the palette; another explicit opening still
requires a fresh canonical presentation grant and caller session verification.
The SQL five-second statement_timeout declaration is defense and convention,
not proof of actual PostgREST timeout enforcement.

The browser debounces 150ms and cancels on close/new query/scope/purpose.
Actor/backend/query/scope/request generations reject stale callbacks. Results
are not cached across openings or persisted. Each palette open revalidates the
session with caller getUser before searching. A browser Auth subscription clears
displayed rows and aborts/increments inflight generations on sign-out or actor
change, including events from another tab. Its synchronous callback performs no
Supabase request; explicit open/Retry performs asynchronous verification later.

## Validation

Focused unit/RTL/API coverage must prove query validation, role-aware commands,
shortcut guards/preferences, modal focus, cancellation, session identity changes,
purpose forwarding, native history synchronization and existing form leave guards.
Use the repository test command with the command, navigation, search endpoint and
affected inventory/metadata/custody component suites. Run canonical typecheck,
zero-warning lint and formatting checks; follow docs/validation.md for full gates.

Schema changes require the complete local database gate and canonical db:types
regeneration/check. The pgTAP suite covers grants, membership/RLS, input, lifecycle,
empty entities, duplicate serials, multiple holdings, typo matching, ties/caps,
purpose filtering and authenticated large-fixture index plans. Verify every field's
actual KNN plan and the real Data API timeout behavior; a SQL timeout declaration
or mocked endpoint test alone does not establish either contract.

Browser acceptance must cover staff/viewer, desktop/phone, Full/Reduced motion,
ordinary buttons/keyboard, help/preferences, repeated same-record Move under the
actual Next router, history-state preservation and twenty results with arrow
wrap/Enter. Include private preview evidence and assistive/screen-reader checks.
Record run-specific results and revision bindings in verification artifacts/PR
evidence. The acceptance matrix records remaining A301/W20 and W11 criteria;
this module supplies palette/help entry, while other overlays/tasks/toasts have
their own delivery requirements.

Local integration preparation on 2026-10-12 applies held command commit
cd4a2f8c1b44ce56f484d8b4866a01801d6873e6 onto route/privacy base
4666d532079609f99cfd36b11f350f440b701e53 in
assist/audit-four-command-integration. The local integration checkpoint has focused
component/provider regression and canonical typecheck evidence; it is not full
acceptance. The lead subsequently checkpointed it and integrated the PR54
document-admission/feedback repair; cached-primary followup checks are recorded
separately in the review evidence. The unshipped additive migration was recreated with the pinned CLI as
20261012102652_command_palette_search.sql, following existing forward-history
prefix rules; deployed migrations were not renumbered. Database application,
type regeneration, actual KNN/Data API deadline proof, browser/preview checks,
independent boundary review and exact-commit full gates remain pending.
