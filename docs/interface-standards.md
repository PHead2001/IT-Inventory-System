# Interface standards

Standing guidance for user-visible work: typography, color, copy, feedback, motion, the room view and visual acceptance. `AGENTS.md` holds the invariants. This document holds the detail and is consulted when a task changes UI, copy, motion or the room view.

The visual direction in [Inventory experience overhaul](experience-overhaul.md) remains the source of the palette and motion vocabulary. That document is a historical PR contract. This one is the standing reference that later PRs follow. Where they differ, follow this document and note the difference in the PR.

**Owner decisions** are marked ⚑. Agents propose; the owner confirms. Do not silently change a ⚑ value.

---

## 1. Audience and quality bar

Users are IT staff doing physical work, often on a phone, often mid-task. A screen succeeds when a staff member can understand it at a glance and act without reading instructions.

The quality bar is that a new user's first reaction is "this is well made." That comes from consistent type, a clear hierarchy, honest and immediate feedback, and a few deliberate moments of motion. It does not come from more glow, more cards or more explanation.

---

## 2. Typography

- ⚑ **Families:** owner-selected Inter variable for UI and JetBrains Mono for codes (SKU, asset tag, serial, location code), self-hosted through `next/font/local`. The Latin Inter subset and one normal Mono weight live under `public/fonts` with pinned sources and original OFL licenses. Non-Latin characters use system fallback. Root CSS variables are `--font-ui` and `--font-code`; use `experience-code` or `font-mono` at the surrounding size. Builds do not fetch fonts from external services.
- **Scale:** use only these sizes. Add a step here before using a new one.

| Role                  | Size / line height | Notes                                                 |
| --------------------- | ------------------ | ----------------------------------------------------- |
| Page title            | 32–42 px / 1.1     | Responsive clamp; one per page                        |
| Section heading       | 20–24 px / 1.25    |                                                       |
| Card / panel heading  | 16–18 px / 1.3     | Semibold                                              |
| Body, inputs, buttons | 14–16 px / 1.5     | Inputs stay ≥ 16 px on touch widths to avoid iOS zoom |
| Secondary / meta      | 13 px / 1.45       | Muted color                                           |
| Eyebrow / caption     | 12 px / 1.3        | Minimum. Uppercase only with letter-spacing ≥ 0.06 em |

- **Minimum:** no instructional, status or data text below 12 px at default zoom. 10–11 px is allowed only for non-essential ornament.
- Use `font-variant-numeric: tabular-nums` for quantities, counts, money and timestamps in columns.
- Render codes in the mono family at the surrounding size; do not shrink them.

---

## 3. Color and emphasis

Use the existing tokens (`--background`, `--surface`, `--foreground`, `--muted`, `--accent`, `--warning`, `--danger`) and the motion tokens in `globals.css`. Do not add raw hex values in components; extend the tokens instead. Semantic screen tokens in `globals.css` cover the workspace shell, shared Button/Input, Labels, Scan, inventory rows, form designer and closet illustration while retaining their original dark values. These are a foundation, not a completed Light theme. Shared controls use semantic aliases to the existing Tailwind color values and alpha color-mix expressions, preserving their original color space. Framework palette utilities on other surfaces remain a later D402 audit.

- **One primary action per region.** The cyan filled button marks the single most likely next step. Peer choices use the outline style.
- **Destructive and lifecycle confirmations** (retire, archive, remove, discard) use `--danger` (or `--warning` for reversible states) and name the record, for example "Retire CLAUDE-REVIEW Dell Latitude 5450".
- **Status is visible.** Retired, archived, low-stock and pending states get a badge or banner, not only muted text.
- Protected-workspace privacy cleanup uses a bounded fixed status surface so its completion does not displace admitted page content. Pending status, errors, Retry and retained-workspace recovery instructions remain accessible; long messages scroll within the viewport. Cleanup on unprotected Auth routes retains its existing placement.
- **Atmosphere is earned.** Glow, grid texture and ambient effects belong to Overview, sign-in and Spaces. Working forms and tables use calm, opaque surfaces. Avoid nesting cards more than two levels deep.
- Verify contrast for muted text on surface tokens at the actual size used (WCAG AA: 4.5:1 below 18 px).

Screen palette exceptions are narrowly scoped: opaque black alpha-mask ink in the shell gradient; transparent/currentColor paint; black-on-white printed label CSS, QR/barcode pixels, PDF/export output and original print overrides. Room JSON physical material colors and the current room-scene floor/rails/opening trim/rack decorations/default material literals stay unchanged in this foundation; they are not an exemption for room UI feedback. The later Light pass must visually review those physical defaults against the room context. Graphics UI tokens consumed by `readScenePalette` remain hex3/hex6 or comma-separated RGB and are captured once at the Canvas boundary, without idle-frame work.

---

## 4. Copy

Write for the staff member in the moment, not for a reviewer of the implementation. Precision lives in tests, docs and history.

**Rules**

- Lead with the outcome: "Moved to Red Container", not "Custody saved. Current holdings and history will refresh."
- Buttons are verbs naming the result: "Move asset", "Retire asset", "Add to queue".
- Use domain words staff already use: location, assigned to, in stock, retired. Avoid model terms on screen: transaction, definition, holding, custody record, revision, payload, scope.
- Show one short line of help at most. Move long explanations behind a "?" or "Learn more" disclosure.
- Mark optional fields "(optional)". Do not explain the asterisk convention on every form.
- Validation summaries list separate linked field entries, with spacing and visible markers. Activating an entry focuses its field; live validation clears entries without stealing edit focus.
- Error messages say what is wrong and how to fix it, next to the field.
- Plain does not mean vague. Never trade truthfulness for friendliness (see §6).

**Vocabulary: replace on sight**

| Current string                                                                             | Use instead                                                                                 |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Completed transaction retained. Start a new transaction explicitly before switching tasks. | Moved to Red Container. **Done** · **Move another**                                         |
| Saving this task. Wait for its result before switching.                                    | Saving…                                                                                     |
| Lifecycle & consequential actions                                                          | Retire or archive                                                                           |
| Checking creation recovery… / Retry creation recovery                                      | _(nothing unless a draft exists)_ → "Restore your unsaved asset?" **Restore** · **Discard** |
| Group · navigate                                                                           | Chevron with a count, for example "4 locations"                                             |
| 2 quantity holdings · 4 quantity items · 3 unlocated definitions                           | 5 results · 3 with no stock                                                                 |
| LOGICAL STORAGE AND SITE CUSTODY · INVENTORY                                               | Inventory _(or omit the eyebrow)_                                                           |
| Fields marked * or (required) are required. Other fields are optional.                     | _(remove; mark optional fields instead)_                                                    |
| From: Red Container / To: Red Container                                                    | At: Red Container                                                                           |
| Serialized asset                                                                           | Individual asset                                                                            |
| Settings saved (after a category operation)                                                | Category added / Category name saved / Category removed                                     |
| Metadata edited / Record details updated                                                   | Details updated / Details saved                                                             |
| Correct recorded location                                                                  | Correct: update the record without physically moving equipment                              |
| Move asset                                                                                 | Move: physically relocate the asset                                                         |
| Write off / Retire                                                                         | Write off quantity stock / Retire an individual asset                                       |
| Issued / Assigned (individual asset)                                                       | Assigned to site                                                                            |
| Issued (quantity stock)                                                                    | Issued to site                                                                              |
| Returned                                                                                   | Returned from site                                                                          |
| Transferred                                                                                | Transferred between sites                                                                   |
| Corrected (quantity) / Corrected (individual asset)                                        | Site count corrected / Site custody corrected                                               |
| Written off (quantity) / Written off (individual asset)                                    | Quantity written off at site / Asset written off at site                                    |
| Retired (site assignment)                                                                  | Asset retired at site                                                                       |
| Name reviewed / Endpoints reviewed for this operation                                      | Omit the implementation suffix; show the recorded item and route                            |
| Operation identity / Recorded instant                                                      | Copy technical details                                                                      |
| Quantity Item code (SKU)                                                                   | Quantity item code (SKU)                                                                    |
| Review assign asset to a site / Confirm assign asset to a site                             | Review assignment / Assign to site                                                          |
| Inventory schema / provisional software location / reviewed room code                      | Categories / storage location / application update                                          |
| Truly unreferenced category will be deleted                                                | This category has no inventory or history references and will be removed                    |

Shared display labels in `custody/vocabulary.ts` implement the vocabulary above.
Category outcomes include the completed action and
category name. Status labels share `record-status.ts` across lists, detail, Labels and
Scan. Inventory CSV appends Type label, Status label and Custody label while retaining existing
machine columns and positions. Low-stock CSV also appends Type label and Status label. Support IDs and original ISO instants belong in **Copy
technical details**; expanded timestamps show readable exact local time and timezone.

Add rows here when a recurring phrase is replaced, so later work reuses the same wording.

---

## 5. Identifiers and technical detail

- Never render UUIDs, revision IDs, `legacy` markers, RPC or table names in normal UI. This includes display strings composed in SQL (for example the metadata summary in `20260925003000_metadata_batch_reads.sql`, which appends `[revision …] (legacy)`).
- Provenance (legacy values, revisions) appears only on detail and history views, as a small labeled marker with the technical value in a disclosure.
- Live-region announcements and drag labels use field and section names, not IDs.
- Exports and logs may carry IDs when that is their purpose.

---

## 6. Feedback and completion states

Every write has three distinct, visible states: **pending → committed → failed**. Success is never shown before commit.

- **Pending:** disable the submitting control, show "Saving…" on it, and keep the rest of the page usable.
- **Committed:** show a compact receipt (what changed, from → to, the resulting balance where relevant), plus **Done** and the likely next action. Briefly highlight the changed data (for example a pulse on the custody card). A toast is appropriate when the result lands off-screen. Do not lock unrelated task controls behind "New transaction".
- **Failed:** keep the user's input, explain in plain words, and offer Retry when retry is safe.
- **Validation:** after the first submit attempt, re-validate each field on change or blur. Clear a field's error and its summary entry as soon as the field is valid.
- **Background checks** (draft recovery, refresh, access re-check) must not shift layout. Reserve space or use a non-layout indicator. Offer Retry only after an actual failure.
- **Refresh:** show "Updated 2 min ago", and keep prior data with a "stale" label on failure.

---

## 7. Motion

Reuse the vocabulary in the overhaul doc: about 120 ms for feedback, 180–240 ms for layout and panels, and interruptible springs for manipulation. Use the `--ease-workspace` and `--motion-*` tokens and the Motion library already in the bundle.

Use motion where it explains a change:

- panel and task open/close, list insertion and removal;
- the committed-write highlight (§6);
- route transitions within the shell (View Transitions, or Motion layout animations);
- room camera moves to a selected or newly moved location.

Rules:

- Transition only the properties that change. No computed `transition-property: all`, including controls with zero duration. The shared `--transition-interactive-properties` covers background-color, border-color, color, box-shadow, opacity and transform. Minimal interactive defaults in the base cascade layer set only that property list; they never start motion or override narrower utilities. The opt-in utility lives in the components layer so caller utilities retain control. Existing animated buttons use `experience-interactive` with `--motion-feedback` (130 ms) and `--ease-workspace`; narrower existing property lists remain narrow.
- Settings exposes **Reduce motion in this browser** as a labeled switch. Its checked state is the saved browser choice; adjacent help explains effective motion and any OS requirement. Turning it off cannot override system reduced motion.
- Under either effective Reduced motion setting, show every animation's end state immediately. This newer Audit 4.2 owner decision supersedes the former short-fade allowance. Static visual quality must remain.
- Until the browser preference is loaded, the motion control is a disabled ordinary button with loading help and no switch role or checked state. Once loaded, it exposes the saved choice as an enabled switch. The first styled paint remains reduced; an initial server value must not be treated as the saved choice.

- No motion that delays a request, replays on query-string updates, or runs continuously behind working forms.

Protected route motion uses stable React 19.3 `ViewTransition` with the installed
Next.js 16.3.6 commit integration, with a pathname-keyed content boundary and no update
animation. React/Next owns server commits and streaming; never wrap `router.push`
in `document.startViewTransition` or retain outgoing private children. Full motion
crossfades content and settles it 8 px in `--motion-route` (200 ms); header/sidebar
remain live. Native viewport/root snapshots are disabled. The **entire** `/room`
ancestor content boundary opts out. Separate header, command, conventional inventory
pane and location-browser boundaries animate without any canvas descendant.

Only a body explicitly paired with a shared title phases its incoming opacity:
it stays transparent for the first 100 ms and fades linearly over the remaining
100 ms of that same 200 ms document-clock stage. Its 8 px movement, outgoing
fade and title morph retain their existing ease-out. The opacity effect has no
delay and finishes with the other effects; ordinary unpaired arrivals keep their
existing crossfade. This reduces title/control interference, without promising
that arbitrary travelling title rectangles never intersect other content. It
changes no DOM visibility, focus, request, readiness or interactive availability;
Reduced motion and native browser Back/Forward remain instant.

Presentation begins suspended under the protected privacy controller. A verified
original-binding grant must match the live revocation revision and assignment
callback epoch before route motion, pending work or readiness can resume. An
ordinary same-binding recheck may retain an already accepted visible grant and
editable work. Revocation withdraws that grant and invalidates presentation before
native cancellation; restored access resumes presentation without replacing
business owners. Explicit logout, Auth account change and action access denial
close the presentation owner permanently. These presentation rules do not change
the authorization or recovery contracts.

Inventory shared titles use an opaque per-navigation name only after Next's
`Link.onNavigate` and existing dirty guards permit the initiating row. Matching
requires record kind/identity, normalized results scope and stable holding identity
(storage location UUID, site UUID or explicit unplaced);
other holdings of the same record stay unnamed. The detail H1 is emitted only
after server authorization. The application's **Back to results** link reuses only
that approved initiating origin and animates its shared title in supported Full
motion. Native browser Back/Forward is instant under the installed Next/React
history restore. It restores the actual history URL, filters, row/anchor and scroll
through Next/browser history and the ordinary authorization/privacy gates. Native
traversal cancels a departing animation or paired wait and tracks real destination
readiness; it never arms a shared title or a precommit privacy animation ticket.

Inventory **Back to results** also repairs an anchor that Next consumed while a
loading fallback had no result row. This application-Link owner is independent of
motion: it retains only the accepted source's record/holding identity and exact
result scope/anchor in the current provider. A real matching Back gesture can
replay the ordinary anchor scroll once, instantly, only after fresh actor/privacy
admission and the canonical visible primary reveal the unique same occurrence.
Changed, missing or ambiguous rows never select a guessed substitute. New
navigation, user scroll/pointer/keyboard intervention, access withdrawal and
provider/actor/generation retirement cancel a pending replay. No history or
browser storage is written. Existing non-motion focus behavior is preserved;
the application return repair never moves focus. Native Back/Forward continues
to use its separate instant coordinator below.

The same accepted inventory-title Link owner also repairs a fresh detail arrival
whose heading remains outside the viewport after Next has consumed its initial
scroll intent. This one-shot intent is independent of Full/Reduced motion and
requires the exact accepted same-origin path and complete query, the original
actor/privacy authority and the canonical visible primary with one visible H1.
After the commit and any active capture release, it reveals only an offscreen
heading, respecting a fixed/sticky header and the heading's scroll margin. Full
motion retains its earlier pre-capture title reveal; an already visible heading
does not move again. The existing abort, user-input, superseding navigation,
native-traversal and authority-retirement cancellation rules apply. App Back
keeps its unique result-anchor repair. Unpaired/plain detail links and links with
a destination hash retain ordinary Next scroll handling; no global readiness
notification, search update, refresh or native history restore creates this intent.

Privacy checks can temporarily collapse the destination document and clamp the
browser's restored scroll to zero. A provider-local scroll coordinator retains at
most 50 finite, nonnegative offset checkpoints, bound to the browser history entry
key, exact path/query/hash and actor/privacy authority generation. A temporary
same-authority recheck freezes capture without deleting those checkpoints;
revocation, actor/generation change, access denial and provider retirement clear
them. Native traversal may restore once, instantly, only when the current entry
and exact URL match, the privacy grant is fresh and the canonical primary is
connected, visible, actor-matched and ready for the complete query. Primary/privacy
notifications and post-popstate reconciliation cover either admission order and
already-authorized same-URL or hash-only entries. Consume the pending restore
before scrolling; a shorter final page clamps naturally without retries. User
wheel/touch/pointer/mouse/scroll-key input or a new navigation cancels the pending restore;
ordinary scroll events cannot cancel it because document collapse also emits them.
Only Next's exact same-entry/same-URL replacement preserves a pending restore.
Only an explicitly same-document destination starts a departure freeze or native
restore token. A true cross-document attempt leaves current-source capture active
under the existing fresh-grant and canonical-primary checks until the document
actually leaves. Choosing Stay in a native beforeunload prompt therefore needs no
synthetic abort or entry-change evidence to preserve later source scroll. A missing
sameDocument flag cannot prove a retained-document departure. A single listener on
the current same-document navigation attempt's AbortSignal releases a
cancelled departure freeze only while its original history entry, exact URL and
authority remain current. Resuming capture still requires the existing fresh
privacy grant and canonical visible primary. A commit, new attempt, authority
change or retired provider fences and removes the old abort listener; a delayed
abort cannot cancel a newer restore or revive an old actor's checkpoint.
This coordination never intercepts navigation, changes history or scroll restoration
mode, persists checkpoints, moves focus or grants authorization/readiness. Without
supported Navigation API entry observation, ordinary browser restoration remains
in charge.

Generic page and canvas-free route arrivals also require a fresh accepted
application-navigation intent for the exact source/destination query keys and
provider pending generation. Generic arrivals also require successful registration
of a passive Navigation API observer. Its `navigate` event with type `traverse`
synchronously retires generic and active title intent and commits static boundary
classes before Next restores history. The approved title origin survives for a
fresh application Back gesture. It never intercepts navigation or changes privacy
or readiness owners. Missing/failed observer support keeps all route and shared-title
motion instant, preserving ordinary navigation and restoration.
The committed page consumes its intent after React queues capture callbacks;
the later popstate cleanup remains in place. Motion support or a retained title
origin alone cannot authorize another arrival snapshot.
The shared title retains the original accepted source/destination keys and pending
epoch independently until that title's capture finishes. An outer pathname commit
may consume generic arrival before Next reveals the inner primary; it must not
prevent the authorized forward H1 from being scrolled into the capture viewport.
This layout-only reveal may pass the exact fieldset made inert by an active capture,
while controls stay disabled. Previously inert fieldsets, other inert ancestors,
hidden content, stale epochs and withdrawn privacy grants still reject it. Native
traversal and title retirement clear this title-specific identity as before.
Generic snapshot completion retires only its exact generic arrival owner;
it never consumes a shared title. Only the matching named title snapshot may
finish that title's intent. Provider, pending-epoch and captured-owner checks
prevent late completion from consuming a newer gesture. A retained title owner
remains a single metadata entry and is also retired by existing cancellation,
traversal, superseding navigation, mismatched readiness and privacy paths.
The approved origin can survive traversal for a later application Back link, but
cannot authorize another Link gesture. No history entry is changed for animation.
Ordinals locate anchors and do not identify holdings. Reordered holdings can pair
at their new ordinal on app Back; deleted/replaced/ambiguous holdings use ordinary
navigation. Do not patch router history methods, lanes or browser events to force
native animation.
Inventory list and quantity/asset detail destinations disable Next Link prefetch
in every motion mode through the shared route-link policy. Plain Full details,
filter, history and navigation links must follow it as well; the standalone asset
tag advisory also opts out. Creation forms and other destinations retain their
existing prefetch behavior. This uses public `prefetch={false}`: navigation still
uses Next's normal Link/history/scroll handling. In the installed Next 16.3.6,
a canceled partial prefetch can fulfill with null and take precedence over the
available primary, committing an empty source before its fallback and losing
the cold shared title. Avoiding those speculative requests preserves the source
without modifying framework files or private caches. Cold clicks may wait longer
for their actual Flight request; ordinary loading/progress remains visible.
Pair approval is staged and consumed within the same accepted Link event, for its
exact href and current provider generation. Prevented/thrown handlers discard it;
plain detail navigation or failed capture retires any older title intent/origin.
Dirty guards and modified gestures never enter that transaction. Retirement affects
only title metadata, preserving pending tasks, progress and ordinary navigation.
Missing/ambiguous/pre-capture pairs use the normal route crossfade. Separate
streaming commits consume the intent and cannot reconstruct the old private tree.
An accepted navigation that interrupts an unfinished paired load cancels that pair
and uses ordinary loading/crossfade for the new destination. It does not promise
that the original source node survives every interrupted route. Next-owned server
redirects remain unrestricted; a committed destination/query mismatch cancels only
the presentation gate, never acknowledges primary readiness or cancels actual work.

React owns shared pairing and capture. A narrow `onShare` adapter replaces the
exact named native group effect: it reads browser-captured source geometry,
including identity when React omits an unchanged source transform. Paired
presentation requires both `startViewTransition` and the `activeViewTransition`
capability used to bind its owned clock; idle `null` is supported. Missing that
capability keeps ordinary instant navigation and loading fallbacks. The adapter
holds then cancels native width/height keyframes, reads the fixed destination box, then
animates only translation/scale at 200 ms. Snapshot image fitting and dimensions
are static. Unsupported/nonpositive/nonfinite/transformed geometry or unsupported
pseudo-element WAAPI skips the **whole** transition instantly after capture;
recapturing private DOM to rebuild a crossfade is prohibited. Browser proof of
ordinary forward/app Back morphing, scrolled/mobile/long titles, no clipping/end snap,
allowed keyframes and CLS remains mandatory; the Vitest adapter is not that proof.
Record titles reserve a compact 44 px trailing control slot in the title row,
including server HTML before overflow measurement. The measured three-line
disclosure uses an accessible Show full name/Show less button with a title hint;
adding that control must not shift following record content. Names that fit
leave no focusable control. Expansion retains the same heading and native title
identity; it does not reserve a separate empty row under short names.

Effective motion reduction suppresses/cancels native snapshots synchronously.
The protected provider cancels on null/different Supabase actor, permitted logout
submission, actor replacement and unmount (including access-denied redirects).
Logout invokes the cancellation helper directly inside its existing submit
handler after unresolved-save confirmation permits exit, before cleanup/action
dispatch. A prevented native submit cannot distinguish the guard from React's
server-action interception; document-level submit listeners do not decide this.
Stale callbacks cannot restore invalidated intent or suppress a new provider.
This hook grants no access and replaces no server membership/RLS checks. It stores
only ephemeral record/URL metadata, never titles, private DOM or credentials.
Existing structured inventory, custody, configuration and metadata action results
are observed at their client await boundaries. Explicit `forbidden`, `P1001`,
`42501` or `actor_changed` results synchronously cancel snapshots and clear intent
for the provider that was mounted when the action started. Later callbacks cannot
restart motion; results from a retired provider cannot suppress its replacement.
This conservative presentation suppression does not prove membership revocation
(`P1001` also covers insufficient staff permission), change authentication, sign
out, or clear drafts/receipts. Generic messages, transport failures and successful
results are not denial signals. Action paths without structured access codes and
revocation without an observed response remain lifecycle limitations pending
security review.
Unsupported browsers retain instant ordinary navigation. Task/panel, review,
receipt and disclosure motion remains pending U406 integration. W09 is an unfinished
draft: Link pending, tracked imperative router operations, real action promises and
mounted local fallback/request UI contribute registrations. A 150 ms timer only
reveals pending work; it never declares completion. Reduced motion makes pending
static and completion immediate. Required protected auth/title/primary data resolve
in the same reveal boundary. A stable unkeyed Suspense boundary sits inside the
canonical privacy content wrapper around pathname-keyed PageArrival; privacy,
progress and provider controllers remain outside it. Inventory/list/detail loading
fallbacks suspend into that stable boundary only for a current accepted paired
navigation with the exact destination, opaque title/navigation owner, provider and
pending generation, a fresh original-binding grant and supported Full motion.
That navigation allocates one cached promise before rendering. React retains the
actual outgoing content until the authorized incoming title/primary data reveals;
the gate stores no private children, titles or DOM. Direct, unpaired, Reduced and
unsupported loading shows the ordinary shape-matched skeleton. All intermediate
inventory loading boundaries honor the gate. Server-issued actor/full-query ready markers acknowledge
only connected visible matching content, and only close native history tokens.
Refresh completion remains tied to real React work. Activity reactivation runs the
marker layout effect again; presentation epochs alone never fabricate readiness.
Room query history instead uses its accepted selection and validated current contents
or visibly committed current error, preserving the independent camera/renderer.
Per-mounted caller cleanup withdraws presentation, never cancels a backend request.
Async task promises are tracked per invocation outside React async transitions:
the retained actual-React regression reproduced shared async-action entanglement,
then passed after separating task promises from synchronous route transitions.
Owner incarnation keeps local busy until actual settlement or caller retirement,
independently of presentation epochs. History cancellation cannot enable resubmit
on a still-mounted request. Provider epochs suppress stale global presentation
and private denial callbacks, while the same live caller can finish its local busy.
Completion releases presentation after its UI commit; it never completes another
owner's task or a route refresh. Synchronous router errors still reach the original
caller, including existing Retry recovery. Actual browser readiness and native
overlap remain required before W09 acceptance.

The partial W08 route port uses decorative content-shaped skeletons for Inventory,
record pages, History/events, Labels, new inventory records and category-form routes.
One polite nonvisual fallback status sits outside the busy geometry. Mounted
fallbacks register only their own real Suspense lifetime with W09; an opaque
fallback owner elects one announcement and suppresses the duplicate top status.
Fallback retirement neither acknowledges route readiness nor finishes another
request. Shimmer is static until hydration and suppressed in Reduced motion or a
hidden page. The optional local-content reveal never delays data/focus/errors;
hidden-page reveals are canceled without replay. No feature request uses that
primitive in this route-only port.

The paired-loading gate withdraws on supersede, Back cancellation, error, privacy
revocation, reduction and provider retirement. Only the existing visible authorized
readiness protocol releases a matching completed destination; animation completion
and timers cannot declare readiness. Cancellation retires presentation rather than
resolving a request, discarding drafts or changing retry identity. Canonical privacy
fencing outside Suspense immediately hides/inerts retained content. A same-page
recheck preserves the existing draft owner. An explicitly accepted route exit may
relinquish its outgoing owner normally, including while its replacement remains
hidden; this is not a request acknowledgement or permission to reveal late content.

The isolated native Next experiment established the retention/pairing mechanism,
not product acceptance. The application integration still needs real delayed-primary
forward/Back, privacy, room/canvas and production-runtime proof.
Room, files, contents, occupancy, inspection and label-result waits remain a
separate port. Populated desktop/390 px Full/Reduced inspection, layout-shift
measurements and native route proof are still required; unit geometry does not
certify the final visual match or D303.2.

The 13 existing imperative router modules are scan-panel, settings-panel,
custody management-form, custody activity-filter, custody-change-form,
label-designer, inventory mutation-form, archive-quantity-form, refresh-button,
search-form, room-workspace, metadata-form and metadata-settings. Their supported
push/replace/refresh calls use the tracked router; existing local transitions use
the tracked transition hook. refresh-button currently has no mounted product caller.
The one history Next Form became a progressive ordinary GET form: native validation,
successful controls/submitter, repeated values, overrides/modifiers and existing
prevented submissions retain their semantics. Signed-in internal Links, including
server-rendered navigation, report public descendant useLinkStatus. Export/download
anchors, external links, modified/new-tab navigation, no-JavaScript document loads,
authentication forms outside the protected shell and API/file requests without an
owned presentation boundary remain native; they do not fabricate global route pending.

Native view-transition DOM capture briefly disables and inerts conventional page
content through a display-contents fieldset. Release follows the actual
`updateCallbackDone` settlement, including rejection; it never waits for animation
completion or acknowledges a backend request. Domain-disabled controls stay
disabled. Effect-driven focus, dialog entry, designer placement and primary route
readiness retain cancellable intent until capture releases. Superseded effects,
Activity retirement and unmount cancel their own queued intent. The prior focused
control returns only while the boundary still owns focus: outside focus, outside
pointer input and history/page exit retire restoration even if focus later moves
to the document body. Subscriber failures are isolated and reported with a bounded
generic error; they cannot replace the native API's result/error or strand another
capture owner. No native focus method or React/router implementation is patched.

React/DOM/types 19.3 and Fiber 9.8.1 replace the previous canary type reference;
Drei/Three are unchanged. Fiber's [React 19.3 compatibility release](https://github.com/pmndrs/react-three-fiber/releases/tag/v9.8.0)
and Activity/Canvas lifecycle fix require real WebGL/cache-Back/camera regression
before acceptance. A jsdom children adapter is only an environment fallback.

---

## 8. Forms and controls

- Pickers and popovers are at least as wide as their trigger, anchor below it and never cover their own label.
- File inputs use one styled drop zone with a browse button and show the selected file name and thumbnail. Do not render the native "Choose File" control.
- File selection explains **Nothing uploads until you choose Upload and review.**
- Drop and Browse share local type/size/name validation. Image previews use revocable local object URLs; PDFs show a filename/document marker and are never embedded before review. Selection grants no publication or inspection trust. Existing upload, inspection, review, replacement and cleanup boundaries remain authoritative.
- Long option lists use a themed scrollbar and keep the search field in view.
- Destructive confirmations follow §3. Free-text reasons may offer preset chips that fill the field.
- Touch targets are at least 44 × 44 px (the existing `min-h-11` button base meets this).

---

## 9. Room view

Follows the 2.5D interaction rules in `AGENTS.md`. In addition:

- **Toolbar:** one compact row of icon buttons with tooltips and accessible names at every width. Fit, Center selected, zoom, Interact and More stay visible with 44px targets at 375px; labels, counts and grouped camera controls go in a compact anchored nonmodal popover. The toolbar never covers the selected object after a camera focus.
- **Labels:** every visible label goes through the shared `layoutLabels` pass, including section markers. A label shifted from its anchor gets a leader line. Selected readable text has first priority, then one occupied marker per exposed occupied location; optional full text may not displace these actions. Measure wrapped text and compact 44px footprints. Opaque occlusion is preserved; crowded unsupported views explicitly list affected locations.
- **Selection:** outline or glow in the accent color, with unselected geometry slightly dimmed. Clearing the selection restores it.
- **Information:** occupied locations may show count badges, which follow the same collision rules.
- **Look:** low-poly and measured, grounded with soft contact shadows and a subtle floor grid. Keep `frameloop="demand"`. No continuous idle motion under Reduced motion.
- Performance claims follow playbook §24.3 (state the SHA, browser, renderer and method). SwiftShader timings are not GPU frame rates.

---

## 10. Empty, loading and error states

Route titles describe the task or resource type, never a private record name. Root
metadata supplies the IT Inventory suffix. `/room` uses Spaces & maps and
`/auth/confirm` uses Confirm email link without selected space names, location
codes or confirmation tokens. Root
and inventory not-found views provide Overview and inventory-search recovery without
assuming deletion or revealing authorization state. Site-opening forms override
the site-details ancestor with the private-safe Record existing quantity item or
Record existing individual asset task title, matching the opening workflow.
Anonymous Overview recovery preserves only the exact `/dashboard` login return;
it does not allow arbitrary path prefixes or expand printed-label destinations.
Failed password-session recovery offers separate touch-sized sign-in/reset controls.
In installed Next.js 16.3.6,
an unstreamed not-found response can return HTTP 404; a response already committed
by streaming can retain HTTP 200 with the not-found UI. A rendered 404 screen alone
does not prove transport status. Preserve existing loading boundaries and verify
both direct HTTP and client navigation on the deployed candidate. See the
[Next.js not-found contract](https://nextjs.org/docs/app/api-reference/file-conventions/not-found).

History summaries collapse an unchanged endpoint to **At** using custody snapshot
identity, retaining immutable recorded labels. Quantity moves and receipts derive
their amount and locations from the immutable signed ledger lines. Technical event
details identify current reference labels and current record names; ordinary summaries
omit the provenance suffix and repeated title copy, following Audit 4.2's explicit
history decision. Asset detail shows custody once in its recent inventory timeline.
Recorded-event links open the exact event independently of list pagination; the event
page retains navigation to all record history and custom snapshots.
Relative times refresh the shared clock when a timestamp mounts and tolerate at most
two minutes of future clock skew as **Just now**; genuinely future instants stay distinct.
They use one shared 30-second browser clock, paused when hidden and stopped without subscribers. Server/first hydration
uses exact UTC; focus/click opens the exact readable display timestamp and timezone; Copy technical
details preserves the original recorded instant with its precision. Date-only controls and export formats are unchanged.

- **Empty** (nothing exists yet): say so and offer the create action.
- **Filtered-empty** (filters exclude everything): name the active filters and offer "Clear filters".
- **Loading:** use skeletons shaped like the content, not "Loading…" text, for anything slower than about 300 ms.
- **Errors** stay inside the affected region. A page-wide error is only for when the shell itself cannot render.

---

## 11. Visual acceptance

User-visible changes are class V1 or higher (playbook §13). Tests prove behavior, not appearance. Before requesting review on a user-visible change:

- [ ] Inspect real populated screens of the affected surfaces at desktop width and at 390 px.
- [ ] Check Full and Reduced motion where motion changed.
- [ ] Check keyboard focus order and visible focus on the changed controls.
- [ ] Confirm no raw identifiers, no text below 12 px and no new ad hoc colors or fonts.
- [ ] Read every new or changed string aloud. Rewrite it if it sounds like a log message.
- [ ] Attach before/after captures to the PR description. They are transient evidence (playbook §7.4), not committed docs.

Scale this to the change. A copy fix needs one capture, not a multi-route session.

---

## 12. Executable checks (proposed)

Per playbook §7.1, contracts that can be enforced should live in tests. Candidates, in order of value:

1. A component or E2E assertion that rendered text on the inventory list, detail, history and room panels does not match a UUID pattern.
2. A stylesheet check that rejects `transition: all` and font sizes below 12 px outside an allowlist.
3. Playwright visual baselines for a few stable, critical surfaces (Overview, inventory list, asset detail, room default view), following playbook §9.9: inspect diffs, and never update a baseline just to make CI green.

Add these as each surface is brought up to standard, not as a single big-bang gate.

---

## 13. Maintaining this document

- When a review or audit finds the same interface problem twice, add or tighten a rule here (playbook §28.2), and add a vocabulary row when a phrase recurs.
- Keep this document under about 300 lines. Merge rules instead of appending variants (playbook §29.1).
- Cross-project interface lessons go to the playbook, not here.
