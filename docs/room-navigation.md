# Room navigation

The room is a client-loaded navigation surface over the existing protected Inventory Core. PostgreSQL owns locations, inventory and history; `data/rooms/it-closet.json` owns geometry. The scene receives validated geometry, stable location codes, descendant highlight codes and focus requests. It emits a selected code and graphics lifecycle notifications. It never fetches Supabase data or performs inventory mutations.

## Selection and reads

`/room?location=ITC-S1A` is the durable selection. The server validates the code, resolves it against authenticated `getLocations()`, and calls the existing `getInventory({location, page})` read contract. Selection and the inventory panel arrive together in the server response. Navigation shows a pending state and preserves the prior coherent selection/panel until that response arrives. There is no optimistic second selection store.

The conventional picker and scene use the same navigation callback. The picker is titled “Choose location” and presents locations as an accessible indented, collapsible tree with chevrons; opening it expands the selected location's ancestors. Browse mode permits aggregate selection for navigation. In inventory forms, ineligible ancestor rows navigate and expand; eligible ancestors remain valid choices, and server eligibility remains authoritative. Search results are flat and show the full breadcrumb, while stable codes remain visually quiet. Back, forward, reload and Show in room use the same URL contract. Quantity definitions without stock have no fabricated room link. Unknown or unmodeled codes retain conventional navigation and an explanatory message. Pagination retains the selected location. The picker remains usable on phones without precise scene pointing.

An aggregate remains the selected location. Highlighted inventory-bearing descendants come from database parent IDs and `can_hold_inventory`, including inactive locations for discovery. Scene ancestry never determines inventory scope or valid mutation destinations.

`ShowInRoom` is a small ordinary link component, independent of the renderer. Search, quantity balances, asset locations and location details link by code. The existing detail workflows remain the sole mutation UI.

## Geometry and camera

A new camera waits for the layout snapshot's authorized read and committed writer
before consuming its first measured frame. Pending verification is distinct from
an authorized empty snapshot: saved pans restore exactly, while an empty snapshot
uses canonical framing. An explicit selected-location focus request runs only
after applying that saved baseline and the scene's confirmed render. History
restoration preserves camera intent. Readiness requires an
initialized room under its original current renderer session; a withheld snapshot
or replacement context wrapper cannot trigger the ready callback. A same-session
recheck preserves an already initialized camera;
the snapshot provider continues to deny writes and retire stale owners as before.
Reactivating a bare `/room` page reapplies its optional saved-space preference
without creating another focus request when the space and location are unchanged.
This preserves the manual camera pose and completed focus state; a genuinely
different saved space still restores normally, and explicit URL selection wins.
Initialization belongs to the committed room, camera and controls resource tuple.
Replacing either graphics resource waits for the same authorized saved-view grant
and reapplies that baseline before explicit selection focus. Outgoing resource
cleanup and frames cannot publish through replacement resources, and consumed
camera commands do not replay when the saved pose already contains their result.
Camera resource cleanup retires its own animation without disposing the separate
reveal controller. Controls attachment and replacement preserve that controller's
lifetime; an outgoing frame cannot cancel or complete a replacement flight.

The strict Zod room contract is validated without a database at build/test/load time. Binding-to-seeded-location validation stays in the local Supabase integration gate. The production build needs no live Supabase.

`buildRoomBindings` resolves parent translations and Z rotations into world room XYZ inches. Interaction focus points are parent-local; optional hitbox centers and label anchors are node-local. Camera focus prefers a location's primary binding regardless of node order, falling back to a non-primary binding for aggregates. Aggregate focus defaults to descendant geometry bounds. Groups have logical bindings but no scene interaction targets: select aggregates through the conventional picker. The schema rejects selectable group targets instead of accepting targets the renderer cannot handle. Nonselectable group focus metadata remains supported. The renderer alone converts through `coordinates.ts`: room [X,Y,Z] becomes Three [X,Z,-Y].

Measured room/opening, rack, shelf-section and drawer dimensions remain unchanged. Shelf thickness, container XY positions, hinge side, cutaway walls, visual furniture details and label placement are presentation defaults, not new measurements. Drawer ordering remains the documented assumption. Furniture styling adds no inventory identity.

The orthographic camera has two explicit modes. Guided applies the room's finite azimuth and elevation limits. Free Orbit permits unrestricted horizontal rotation and elevation above or below the room, retaining a small epsilon from the vertical poles to avoid the numerical singularity; camera roll remains disabled. Returning to Guided clamps both azimuth and elevation to the nearest allowed values. Both modes preserve upright orientation and selection. The preference is local with a Guided server-rendering fallback. No infinite value enters room JSON or its strict finite-number schema.

Recenter translates the camera and orbit pivot to `room.camera.target` while preserving angle, elevation, zoom and selection. Double-clicking exposed floor invokes that same action; dragging or double-clicking furniture and labels does not. A recent manual camera movement also suppresses an accidental floor double-click. Opaque envelope and furniture geometry stop raycast clicks behind them. Side-anchored labels move to the camera-facing box face and remain single, upright, occlusion-aware selection buttons. Fit room projects the validated room and binding bounds at the current orientation and sizes them against the actual canvas viewport, so its framing differs from Recenter and responds to sidebar/viewport changes. Center selected preserves the primary binding's focus point and sizes the selected bounds around it in the canvas viewport; small locations retain a useful zoom cap while aggregates stay in frame. Repeated requests for the same selection work. Any camera command or manual control input interrupts an older focus animation; reduced motion snaps immediately. Initial Fit waits for a positive canvas size and applies only while the view is pristine. Restored views, manual input and camera commands end that state; later resizing never reframes over user intent. The primary toolbar keeps Fit room, Center selected, zoom, Interact and More in one row with 44 px targets. More is a compact nonmodal anchored overlay with internally scrollable Recenter, orbit mode, grouped pan/rotate/tilt, Show labels, counts and help. It leaves the canvas size unchanged and map controls operable. Its rectangle is reserved in label placement. Opening focuses its first control; Tab remains free. Escape closes it, disarms an active map, announces that state and restores Interact focus; a passive Escape restores More. Outside dismissal does not steal focus. Fit room and Center selected close More and help before revealing the requested view, retain focus on the invoking primary button, and preserve interaction mode and logical selection. Recenter also dismisses the panel and restores the surviving More trigger; repeated Pan, Rotate and Tilt commands keep the panel open.

## Accessibility, failure and performance

Location names and codes occupy separate lines. Ordinary codes remain intact; codes longer than 24 characters have a bounded horizontal scroll region with the complete code and a keyboard focus target outside selection buttons. Search results retain full path context, while group-detail child links use short names with full accessible breadcrumbs and existing capability labels. A single parent map/Spaces action supplies the secondary navigation.

The contents panel names active-only scope, distinguishes each row's local holding from item-wide totals, and labels distinct counts as “On this page”; the full matching count remains rows. Empty destinations explain “No active inventory here” and link to all-status location contents, without an empty pager. Out-of-range contents pages replace the page parameter and retain selection while a new authorized response loads. Request identity/generation checks continue to reject stale results. No-selection guidance names the map only when registered, visible and available; unmodeled, hidden and failed surfaces direct users to the location browser.

Normal location selection and inventory links stay available outside the canvas. Controls have readable names and touch-sized targets. Selection is announced as text, not color alone. Ordinary labels appear on hover or while Show labels is enabled. An exposed selected object always retains its readable label, even with labels and counts off; visible labels are keyboard-operable buttons, while mesh clicks remain a separate canvas raycast path. Touch users may tap exposed objects, and the conventional location panel remains the dependable path for occluded or crowded destinations. Occluded storage remains available through the picker. The room can be hidden on any screen, and phone workflows do not require precise pointing.

The renderer is dynamically imported with server rendering disabled. Loading, unavailable graphics, initialization errors and context loss keep the conventional UI usable. Retry recreates the graphics surface. Hide/show clears readiness until the remounted scene actually renders.

Camera snapshots live in the current protected-layout instance, so ordinary Room → Inventory → browser Back can restore the compatible view even when the configured Next router unmounts the room page. The provider retains at most eight cloned, validated camera poses (position, target, zoom and mode), using the existing actor/application-origin/space/geometry key and an additional canonical backend and privacy-grant binding. There is no module-global cache, browser-storage persistence, inventory snapshot or retained renderer. Revocation, assignment invalidation, actor/backend/privacy-generation drift and layout disposal clear the poses and retire camera callbacks. An ordinary visible identity recheck retains stored data but denies new restoration and write grants until verified. Old callbacks cannot revive after same-actor reauthorization. Explicit location focus still takes priority. Standalone workspaces without this provider retain only their existing page-local Hide/Show restoration.

Hover labels follow the nearest visible scene mesh under the pointer, resolving child furniture through its logical storage owner. Opaque floor and furniture surfaces block targets behind them; invisible convenience hitboxes cannot create a hover label. The hover label is a screen-space button near the pointer, so camera-facing 3D anchor occlusion and label collisions cannot hide an exposed storage target. Camera motion rechecks the same pointer position. The brief mesh-to-button handoff preserves the label without changing selection. Drei Html creates independent DOM roots, so each label explicitly captures the scene's per-room registry before that boundary and provides it inside the new root. One screen-space registry lays out projected labels, shelf/section text, decorative door text, hover labels and count text together. Selected readable text takes first priority, followed by one recognizable occupied marker per exposed occupied location, then optional hover/full labels and decoration. Duplicate location actions are suppressed. Selected names wrap within a bounded width. Visibility distinguishes a verified exposed anchor, a completely hidden target, pending work and a terminal unfinished check. One projected-surface context per Canvas refreshes after camera/world motion and before every label query; all labels share its cooperative 8 ms allowance per demand frame and aggregate operation, triangle, fragment and authoritative-ray work accounting for one attempt. Fingerprint acquisition, triangle projection, clipping and query cursors preserve completed work across at most 64 continuation frames, including a no-progress frame. The existing 250,000 operation, 50,000 triangle and 10,000 fragment ceilings apply across the complete attempt; they do not reset on each continuation. Actual transformed triangles and opaque owner-confirmed scene rays establish visibility. Transparent convenience hitboxes do not count. The measured revision includes camera, geometry/material state, viewport position and visible DOM obstruction rectangles. Each frame synchronously checks a compact, exact structured guard over captured topology, owner/visibility ancestry, mesh transforms, camera, geometry buffer identities/versions, draw ranges/groups and material visibility/opacity/side before continuing or publishing any cached result. Three buffer edits must follow the `needsUpdate`/version contract; raw array edits without that notification are not detected. Label-anchor group transforms do not change physical geometry. An incomplete guard conceals all cached actions. Pending checks request another demand frame only while an active label has unfinished work. Time exhaustion yields pending work rather than hidden storage; resource/no-progress/frame-cap termination stays honestly unfinished until Retry label placement or a measured change. Terminal attempts request no frames. Externally demanded frames still run a separately bounded guard; a complete captured fingerprint can discover an actual changed scene. If fingerprint acquisition itself exceeds a structural limit, the result explicitly identifies unsupported fingerprint work and only retained fields can be checked. Changes confined to uncaptured fields may require Retry; this state never authorizes a label. Collection lengths and material-scan allowances are measured and reserved before copying or scanning elements, and growth invalidates a guard before its old reservation can reread the collection. Retry starts one new bounded attempt without an inventory mutation. Camera-facing location Html uses that shared authority instead of additional independent occlusion rays; decorative Html retains its own occlusion behavior. Offset labels receive noninteractive leader lines to that exposed anchor. The same current ray-verified anchor also reserves a 12 × 12 CSS-pixel keep-clear rectangle in the shared DOM label packer, so a location label or hover tooltip cannot cover the physical point used for mesh picking. The rectangle projects the resolved node-local anchor through its current parent transform, camera and canvas bounds; it is not derived from the displaced DOM label. Nonfinite, clipped, off-viewport and no-longer-visible anchors reserve nothing. Every exposed registered anchor participates before same-code action deduplication, including an anchor whose label yields to a tooltip. These reservations affect label placement only: they never become opaque/UI visibility masks or cause additional rays, so a label cannot hide its own physical visibility proof. Camera, viewport, parent/reveal and visibility changes refresh the reservation through demanded-frame layout; its current rectangle also invalidates an unchanged failed-packing measurement key. Focus pins, optional expansion, mandatory markers and fallback retain their existing obstruction checks, cooperative work budget and 128 combined label/reservation input cap. Previous valid placements are reused, then nearby positions, then a deterministic viewport rail for mandatory actions. Full text and compact 44 px footprints are measured together. Focus/hover text expands only after reserving every mandatory action; when it cannot fit, a readable conventional summary supplies identity and accurate counts without changing selection or resizing the canvas. The detailed packing result distinguishes a complete placement from candidate infeasibility and exhausted work; neither failure proves physical impossibility. The registry shares one cooperative 16 ms deadline and operation/candidate/node allowance across DOM measurement and at most four CSS reflow passes. Unverified actions are concealed only after blurring actual focus. Unchecked or unplaced locations appear as native keyboard/touch selection buttons with honest status and Retry label placement; retry restarts visibility and packing without inventory mutation. That fallback does not establish acceptance of the current room at 375px. Resizing and loaded fonts schedule bounded remeasurement; layout does not request an endless render loop. When its label is already exposed and clickable, that label serves the hover; otherwise the screen-space button appears. Hidden labels neither receive clicks nor remain keyboard-focusable. Door decoration is not a logical inventory target.

The map starts passive: plain wheel scrolling and one-finger swipes belong to the page, while deliberate taps still select. Interact with map enables one-finger/left-button rotation and two-finger pinch; right-drag and the button controls pan. Done, Escape, focus leaving the surface or a pointer press outside it disarms manipulation. Ordinary wheel events reach OrbitControls only while active; passive wheel remains page scrolling. Ctrl/Command+wheel always bypasses OrbitControls without preventing the browser default, including trackpad pinch represented by Ctrl-wheel. Direct pointer pinch is owned by an explicitly active canvas with touch-action:none; passive touch-action:auto preserves vertical page scrolling. Browser keyboard zoom is untouched. A passive drag briefly explains activation without capture or preventDefault. Pointer cancellation, lost capture and disarming clear owned gestures. Drag, pinch and cancelled swipe gestures cannot become accidental mesh selections. Pointer affordance follows the nearest visible selectable surface and clears during dragging, on leave and on cleanup.

Optional Show item counts is off by default. The renderer receives locationOccupancy keyed by stable location code; it never fetches per mesh. Each triple separately names active quantity products, quantity units and individual assets. Products count distinct nonarchived definitions with positive holdings; units sum those holdings; assets count active physically stored records, excluding site assignments. No mixed total is invented. Known eligible zero is explicit, while missing/ineligible/loading/error remains unknown. Occupied targets use one non-color-only compact badge when needed, with accurate counts in its accessible name and deliberate focus/hover/selected presentation. No aggregate parent badges are shown.

SpacesWorkspace enables one uncached /api/room/occupancy request with space and fresh generation when counts are on. The endpoint derives modeled active inventory-capable leaf codes from authenticated locations and Git geometry and invokes the additive caller-scoped inventory_location_occupancy(text[]) read. The legacy active-entry RPC remains unchanged. New counts are canonical decimal text bounded to PostgreSQL signed bigint; BigInt is used only for exact display formatting. Response identity binds actor, application origin, independently derived public backend origin, space, active-only filter and a fresh request UUID. Every transition owns a new generation, including off/on and A→B→A. Old counts disappear before the next committed paint. No private cache is shared or persisted. The RPC application deadline is five seconds and the browser deadline eight seconds; timeout produces unavailable counts, never zero. Cleanup aborts are quiet. SQL retains its five-second statement_timeout; actual REST elapsed-time enforcement still needs runtime proof.

Full-room occupancy also requires the protected layout's matching actor/backend scene authority and a current, visible privacy grant. Its request identity includes that authority's privacy generation, revocation revision and verified epoch. Revocation or assignment invalidation aborts pending reads; response adoption rechecks the live grant. A retained workspace clears accepted counts before recovery can paint, and same-owner privacy Retry requires a fresh request generation. Missing, retired or pending counts stay unknown rather than becoming zero; this does not change server authorization or inventory state.

Navigation, page return, window focus and visibility restoration refresh enabled counts and selected contents; returning from an inventory operation reloads both. Refresh inventory provides an explicit retry. These are snapshots, not realtime occupancy: another session's changes appear on refresh/return. The contents row total remains active holding/asset entries, whereas the badge distinguishes products, units and assets; the reads may observe separate concurrent commits.

The Spaces workspace reconciles the current `/room` URL when its history listener
attaches, including remounts and React Activity reactivation. Native Back/Forward
may restore the URL before that listener exists; cached initial props cannot
override the restored space, location, page, fallback notice or route-readiness key. Reconciliation
does not rewrite history. Changed locations receive a fresh focus/reveal token
while preserving the restored camera view; unchanged locations and page-only
restores keep the current camera intent and token. Explicit selection and Center
selected still request a camera flight. Existing
uncached contents requests and identity/generation checks retire interrupted reads.
Another route's history event never becomes room selection.

Use simple reusable geometry and restrained lighting, a capped device pixel ratio and demand rendering. Physical material colors are retained; accent edges/emissive feedback mark selection and other geometry dims slightly until clearing it. Full motion permits one bounded selection pulse; Reduced motion uses a static highlight. Standard adds cached contact shadows and lazy selective bloom; Low keeps contacts without bloom, and Off disables both. Static corner grounding and a clipped floor grid retain depth. Controls, relevant hover changes, bounded visibility/focus transitions, contact refreshes and the brief Full-motion pulse request finite extra frames. Nonessential pulses stop offscreen or in a hidden document; the camera stays idle at rest. The canvas exposes passive camera telemetry for real-interaction browser assertions; it cannot set camera state.

## Shared spatial composition and embedded maps

Modeled selection uses one immutable scope/generation/request/code token for a
750 ms camera flight followed by a 400 ms visual reveal. New selection, clear,
camera commands and manual input retire an older flight before it can open the
wrong location. Reduced motion applies the complete endpoint immediately.
Drawers and containers translate through bounded visual offsets; shelf sections
lift gently. Reveal metadata is valid only on box nodes, including zero offsets;
recursive groups cannot declare a reveal because the renderer moves box bodies.
Resting measurements, logical bindings and room coordinates stay
unchanged. Moving child geometry retains one verified logical pointer owner.
Selected labels and known selected counts follow the opened body. Rack and
aggregate selections use their existing focus/highlight rather than a fabricated
drawer. History restoration preserves camera intent; explicit selection and
Center selected still request focus. Existing label visibility transactions run
after camera and reveal transforms, with the same budgets and fallback actions.

Destination pickers offer **Pick on map** in addition to their conventional tree.
The optional modal portals outside whole-page transition capture. It stages a
stable code and commits only after **Use location** resolves the latest eligible
UUID using `pickerLocations`: active ancestor path, active/can-hold capability,
source exclusions and the parent form's pending state. It never submits a task or
moves inventory. Cancel, initialization failure and unmodeled locations retain
the form draft and keyboard tree. An eligible unmodeled candidate retains its
logical code and UUID beside the available modeled overview, with no selected
geometry or focus target and a notice explaining that it is not shown. A failed
map stays failed when the staged destination changes; only **Retry map** requests
another graphics attempt. **Use location** still explicitly commits the staged
candidate to the form. Without modeled alternatives the picker remains text-only;
unmodeled detail previews always retain their recorded text without a canvas.
Sites use their existing site picker, not map
destinations. Every mesh, label, hover and overflow action passes the same latest
permitted-code and private-session guard.
Initial verification defers modal opening; a successful same-owner recheck opens
the dialog. Cancel permanently retires that modal so a later recheck cannot reopen it.

Asset, quantity and location details have an independently lazy storage preview.
It initializes near the visible region, mounts one compact map, and owns a local
camera separate from Spaces snapshots. Several positive quantity balances require
an explicit choice. Site assignment, retired/archived context, inactive locations
and absent geometry have truthful text. A chunk, graphics or count failure stays
inside the optional region and cannot delay primary record readiness. Active
embeds reuse the existing bounded caller-authorized occupancy read after graphics
readiness; withdrawal aborts the read and conceals old/late counts. Selected reveal
counts are independent of the initially disabled optional all-location overlay.
Missing, loading and failed counts remain unknown rather than invented zero.
An authorized child beneath a modeled room still needs its own geometry binding:
an unmodeled child retains its recorded text path and Spaces link without an
embedded canvas, invented camera target or selected-count request.

The protected layout owns one graphics slot shared by Spaces, previews and picker
maps, including initialization and disposal. Explicit picker maps have priority;
withdrawn passive maps offer **Resume map**, and waiting never disables the tree.
Acquisition precedes `createRoot`/renderer initialization. Allocated slots release
only from the installed public Fiber `unmountComponentAtNode(canvas, callback)`
completion; requests that never allocate cancel immediately. There is no timeout
reclamation. The original actor/backend/privacy generation/revision/epoch binds
each scene session. Revocation synchronously hides/inerts the scene and independent
DOM portals, and late initialization/frame callbacks cannot publish private data.
Privacy and session context cross Fiber's separate root explicitly. An ordinary
visible verification recheck retains the allocated original renderer, scene,
controls and consumed camera commands. Its lifetime uses the original owner and
live retained presentation grant; current privacy context continues to propagate
into Fiber, so inventory selection remains fresh-grant gated. Request admission,
allocation, the first scene mount after configuration and explicit Resume map
require a fresh grant. Withheld queued or unallocated requests cancel immediately;
pending allocated configuration can finish but cannot first mount scene children
until fresh verification returns, even when viewport dimensions have not changed.
A different identity cannot rebind the original session.
Committed actor/backend/generation drift permanently retires each canvas, map
dialog and embedded-count owner even without a global invalidation event. Returning
to the original identity cannot revive its scene or staged confirmation. An ordinary
same-owner visible readiness recheck retains the mounted native dialog, its staged
candidate and camera. New selections, Use location, first modal opening and focus
handoff still require fresh verification. Cancel safely closes the retained dialog;
focus restoration is withheld until its original grant is fresh.

Fiber 9.8.1's public `unmountComponentAtNode(canvas, complete)` handles failed
and pending configuration, missing scenes and factory-owned async renderer
disposal, awaiting acquired-renderer disposal before completion. The
failed-configure adapter invokes that API without rendering the
rejected root or changing its store. The original lease remains occupied until
Fiber reports teardown completion. Successful configuration followed by another
error uses ordinary public teardown. Installed-Fiber regressions cover rejection
before renderer acquisition, later configuration failure with deferred disposal,
and pending factories that reject or return a renderer after teardown begins.
They prove disposal, context-loss request, completion and next-grant ordering;
they do not create WebGL or prove GPU release. Disposal APIs that throw and
allocations hidden inside a rejecting factory do not establish actual GPU release
even when Fiber reports completion, and remain browser/resource acceptance limits.
A factory that allocates resources and rejects without returning them must clean
up those allocations itself. SafeCanvas initiates public unmount immediately on
cleanup, even while configuration is pending, and fences later configure/render
work. Only Fiber's completion callback releases a created root's original lease;
a late configuration rejection cannot release it while disposal remains pending.
Production room callers provide a synchronous renderer configuration object. A
custom renderer factory that never settles can also prevent Fiber from completing
teardown; safely reclaiming its unknown resources is not established by a timeout.

A cold Pick on map request immediately announces loading and retains a cancellable
owner-controlled placeholder; cancelling cannot open a later-resolved dialog or
change the draft. Pending intent captures the original privacy generation and live
revocation/assignment epochs at activation. Invalidation permanently retires it;
late loading, selection or focus callbacks cannot adopt a reauthorized owner or
clear a successor intent. Ordinary same-authority rechecks retain intent, but a
fresh grant is required before first dialog mount, confirmation and focus transfer. Renderer startup uses loading feedback until a budget request
actually queues or is withdrawn; Resume is reserved for genuine paused/retry states.
Queued maps announce that they are waiting, remain busy and keep their queue
position without a Resume control. They allocate automatically after the occupied
renderer finishes disposal, subject to fresh verification.
Once an allocation is withdrawn by a higher-priority map, it stays paused through
ordinary privacy refresh and slot release. Only an explicit Resume map with a
fresh original grant can request a new lease. A queued request withheld before
allocation may resume automatically when fresh verification returns. Neither path
releases the disposing renderer's slot before Fiber completion.
The server detail wrapper derives compact per-choice capability flags from the
canonical room bindings and supplies server-rendered room links to the client.
The eager client region, including the links' client descendants, imports no room
geometry; its near-viewport dynamic chunk owns that load. Capability flags decide
whether a detail location has modeled geometry before any map footprint is reserved.
Inventory-only spaces and
unmodeled children use the same short recorded-context fallback.

Compact embedded maps use their own cold-chunk placeholder, rather than the full
room/browser skeleton. Offscreen reservation, both dynamic loading boundaries and
the ready scene share the toolbar, 280px canvas, gaps and status metrics. The
placeholder already renders the actual authorized selected label, so long labels
wrap before geometry loads. A permanent two-line count-status slot preserves
loading/error announcements without inserting a new block when counts arrive;
normal selected text and the two-line phone interaction note complete the minimum
status envelope. Long labels, inspections, additional notices and expanded controls
remain free to grow; this is not a zero-layout-shift claim for every optional state.

Whole-page `PageArrival` capture excludes `/room`, asset/quantity record details
and location details before their lazy previews load, including the preceding
canvas-bearing route when leaving. Root capture remains disabled. Detail pages
also suppress their former whole-body `RouteReady` capture with the explicit
`capture="regions"` capability under the unchanged canonical readiness/private
identity. Header, downstream record content, preview text/navigation and task/form
conventional controls have bounded sibling captures; preview section backgrounds,
map slots, cold placeholders and live canvases have no active capture ancestor.
LocationPicker keeps its existing inline loading surface and native dialog portal;
conventional controls are split around that surface before the lazy chunk loads.
No maps are cloned, cached, moved or remounted to create the effect. The independent
record-title pairing and all eligible conventional region fades run concurrently.
Real browser/WebGL, narrow-screen and Full/Reduced-motion acceptance is still
required; source regressions do not accept D303.2, W13 or A303.

## Validation

Reveal-capable selectable boxes retain a selection-only volume in their stationary
parent-local event group, alongside the moving visible body. Explicit interaction
hitboxes take precedence; otherwise the volume uses the centered node size.
Selection rays accept eligible stationary volumes or moved visible surfaces, stop
at nearer visible furniture, and prefer real surfaces at equal depth. Pointer down,
up and click use the same resolver and require matching pointer/logical ownership;
drag, cancellation and current authorization still prevent selection. These invisible
volumes never supply hover ownership, label visibility, bloom or shadow casters.

Detail maps explicitly use preview selection mode. They retain recorded-location
choice, focus, reveal, counts, Show in room, pan and zoom, while omitting selection
mesh handlers and presenting labels, hover details and fallback locations as text.
The central selection guard also rejects stale callbacks in preview mode. The
conventional tree and destination map remain selectable under their existing rules.

Pure tests prove transforms, canonical bindings, database-derived descendants, strict URL selection and camera limits. Deterministic fake-clock visibility tests exhaust the cold 8 ms fingerprint/projection/clipping/ray phases, prove same-revision completion without reprojecting triangles, invalidate processed buffer/material and DOM state between slices, conceal stale cached results during incomplete guards, and stop demand frames at completion or the 64-frame/resource ceiling. A canonical physical-geometry probe invokes the actual hook-free room JSX and checks that its guard leaves work allowance and all 28 location queries complete under unchanged aggregate ceilings. It uses deterministic synthetic checkpoint time to prove progress; elapsed samples from separate real-clock runs remain observations and never form a mandatory OS timing assertion. This does not establish browser rendering, frame rate, phone performance or the populated 375px placement acceptance. Component tests prove the scene/application contract, coherent pending navigation, aggregate selection, repeated focus, missing bindings, retry/failure and located/unlocated links.

Real local Supabase Playwright tests cover authentication, actual WebGL rendering/raycast selection, shelf and drawer stock, search-to-room, aggregates, history navigation, repeated focus, viewer access, phone usability and forced graphics failure. A passing mocked scene is not evidence that WebGL works. Inspect actual screenshots for clipping, label overlap and proportions; avoid pixel-perfect assertions.

Hover regression tests move the pointer over actual visible geometry at oblique, overhead, underside and panned Free Orbit views, then verify the resolved location, projected binding intersection and tooltip; each angle is captured for visual review. With a stationary pointer, UI pan commands move a known shelf off its independently computed ray, and the old hover label must clear or change. Tests also cover opaque occluders, invisible hitboxes, DOM label handoff, hover without selection, and Show labels accessibility. Camera telemetry is read-only and does not replace pointer interaction.

Input regression tests must exercise actual browser event ownership: passive page scroll and active ordinary-wheel zoom, browser-owned Ctrl/Command-wheel, passive touch swipe without selection, activated rotate/pinch, exit controls and keyboard alternatives. Label checks measure every visible text rectangle together, including count/decorative text, across Fit/focused views and viewport/font changes. Pure placement tests and mocked components do not establish these browser behaviors.

Spatial performance acceptance compares baseline and candidate with matching browser/renderer, build mode, viewport, DPR and active interactions. Record graphics readiness, real draw-bearing frames or browser traces, interaction frame intervals and settled idle work; requestAnimationFrame callbacks alone are not rendered frames or GPU timing. Software rendering and emulated touch do not certify hardware frame rates or a physical phone. The general navigation performance gate does not by itself prove renderer readiness.

For focused browser iteration use `npm run test:e2e -- tests/e2e/00-room.spec.ts`. This still builds with the local public backend environment. Final certification remains fresh `npm ci` followed by the complete `npm run validate`, exact-head CI, fresh Codex review and the configured nonproduction preview smoke.

The separate Settings Storage locations tree opens below the first level collapsed. Searching reveals matching ancestors with hierarchy and keyboard navigation intact. All locations from a location setting returns to the selected permanent code, revealing its ancestors. This does not change the inventory/room picker or room URL contracts.

The populated 375px browser harness explicitly opts into read-only label-layout
diagnostics before application loading. Ordinary sessions expose no snapshot.
Only the latest placement transaction is retained, with at most four exact packing
input/output passes, 96 labels and 32 reserved rectangles. The snapshot is deeply
copied and frozen; only checked-in scene IDs, exact renderer opening-coordinate
IDs, stable location codes, finite layout numbers and flags are allowed. It contains
no display names, inventory content, summaries, DOM nodes or callbacks. Invalid or
oversized captures fail explicitly with no partial fixture. On the selected Fit/open
More assertion failure, the harness emits bounded JSON (128 KiB including existing
layout telemetry) at `fit-open-selected-before-long-text` and rethrows the original
assertion. This supplies an observed replay fixture without changing placement,
visibility, scheduling or the ordinary user flow; it does not establish a repair.

## Session-owned glow and grounding

Fine-pointer hover lifts only the visual child by 0.1 inches and brightens its edge;
logical hit targets stay at their measured positions. Coarse pointers and Reduced
motion do not lift. Selected physical mesh references feed lazy selective bloom
through pinned `@react-three/postprocessing` 3.1.3 and `postprocessing` 6.39.5, with
Fiber 9.8.1 and React 19.3.0. The offscreen composer retains one raw screen render
with the original tone mapping, exposure and output color space, followed by an
additive bloom-only overlay. FBO, shader, allocation and render failures latch
bloom off and preserve labels and selection.

The actual pinned wrapper receives a narrow, attributed lifecycle patch through
the repository's `postinstall`. Its manifest verifies upstream, payload and
installed output SHA256 bytes; already-patched files are verified and unknown
versions or bytes fail installation. Composer and SelectiveBloom allocations
belong to committed, captured resource lifetimes. Their optional stable
`ownerCurrent` predicate guards allocation, resize/pass setup, renderer writes,
selection/light/default updates and frames. A fresh owner/store generation
recreates resources without authorizing prior callbacks. Unconditional cleanup
restores owned state and uses reference ownership tokens and captured overlay
resources so stale cleanup cannot clear a successor. See the attributed payload
in `patches/react-three-postprocessing-3.1.3`.

Settings → Appearance & preferences provides **Room appearance in this browser**.
The shared browser preference applies to the full room, detail previews and map
pickers. Standard enables bloom and cached contacts; Low disables bloom; Off also
disables contacts. Storage failure retains the choice in the current tab. Reduced
motion is independent. `SCENE_EFFECTS.intensity` controls decorative hover, glow,
selection and grounding only; reveal offsets remain 5.6/4/1 inches and
camera/reveal timing remains 750/400 ms.

Measured fallback excludes idle gaps, capture frames and startup/composer warmup;
only adjacent actively requested camera/body/pulse frames count. Two consecutive
60-frame windows with p95 above 25 ms latch bloom off. This initial threshold needs
reference-runtime tuning; GPU names do not decide quality. No effect owns a
continuous loop: the room retains demand rendering and stops at rest.

A cached contact capture owns two render targets, an orthographic camera, depth
material and separable blur resources. It copies actual caster world matrices
into an isolated scene and shares source geometry without disposing it. One depth
pass plus two blur passes produce floor contacts. Complete framebuffer, actual
shader-link and context-loss checks reject unsupported captures; finally blocks
restore renderer/debug state. Partial construction and failure release owned
resources. All registered furniture, drawers, containers and shelf bodies
contribute; static corner patches supplement those contacts while they are dirty.

Contact cache identity includes scene generation, geometry registration revision,
settled caster revision, palette revision and quality. Reveal/hover motion hides
the old receiver immediately and captures once after all transforms settle.
Camera/count/label/bloom updates do not dirty contacts. Theme token mutations and
System changes coalesce into a changed-palette revision; cleanup removes observers
and media listeners and fences already-queued reads. Resting furniture footprints
are removed to avoid ghost shadows behind opened bodies.

Each effect captures its original renderer session and original graphics lease.
Withdrawal fences callbacks synchronously, before React unmount or actual Fiber
disposal finishes. The lease remains occupied until Fiber reports completion.
Effects fence allocation-owning lazy composer rendering, overlay and contact
allocation, FBO/shader hooks, composed/raw/overlay draws, quality samples,
telemetry, readiness/failure callbacks, hover and reveal frames. A replacement
context wrapper cannot authorize an old owner. Cleanup removes listeners, restores
owned callbacks and releases resources regardless of current permission.

Layout cleanup immediately and irreversibly disposes the captured store. On
StrictMode or Activity reconnect, provider setup publishes one fresh context
generation only while the original renderer session remains current. Descendant
layout registrations and light refs then reconnect against that fresh store; the
provider itself stays mounted. No retirement cancellation, pause/resume or store
reopening path exists. Replay and room replacement cannot revive a retired
original actor/backend/lease session.

Focused regressions cover retirement/import races, actual public Fiber teardown,
contact cache/theme/motion invalidation, failure-state restoration and finite
scheduling. Authored browser journeys remain unrun in this bounded integration.
Real WebGL recordings at desktop and phone widths, both themes, Full/Reduced
motion, capability failures, and matched warmed effects-off/on traces on recorded
reference hardware remain acceptance requirements. Record median/p95 active costs
and capture spikes separately, viewport/DPR and actual renderer/runtime.
SwiftShader can prove behavior but does not establish real GPU performance.
