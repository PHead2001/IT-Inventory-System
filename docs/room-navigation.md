# Room navigation

The room is a client-loaded navigation surface over the existing protected Inventory Core. PostgreSQL owns locations, inventory and history; `data/rooms/it-closet.json` owns geometry. The scene receives validated geometry, stable location codes, descendant highlight codes and focus requests. It emits a selected code and graphics lifecycle notifications. It never fetches Supabase data or performs inventory mutations.

## Selection and reads

`/room?location=ITC-S1A` is the durable selection. The server validates the code, resolves it against authenticated `getLocations()`, and calls the existing `getInventory({location, page})` read contract. Selection and the inventory panel arrive together in the server response. Navigation shows a pending state and preserves the prior coherent selection/panel until that response arrives. There is no optimistic second selection store.

The conventional picker and scene use the same navigation callback. The picker is titled “Choose location” and presents locations as an accessible indented, collapsible tree with chevrons; opening it expands the selected location's ancestors. Browse mode permits aggregate selection for navigation. In inventory forms, ineligible ancestor rows navigate and expand; eligible ancestors remain valid choices, and server eligibility remains authoritative. Search results are flat and show the full breadcrumb, while stable codes remain visually quiet. Back, forward, reload and Show in room use the same URL contract. Quantity definitions without stock have no fabricated room link. Unknown or unmodeled codes retain conventional navigation and an explanatory message. Pagination retains the selected location. The picker remains usable on phones without precise scene pointing.

An aggregate remains the selected location. Highlighted inventory-bearing descendants come from database parent IDs and `can_hold_inventory`, including inactive locations for discovery. Scene ancestry never determines inventory scope or valid mutation destinations.

`ShowInRoom` is a small ordinary link component, independent of the renderer. Search, quantity balances, asset locations and location details link by code. The existing detail workflows remain the sole mutation UI.

## Geometry and camera

The strict Zod room contract is validated without a database at build/test/load time. Binding-to-seeded-location validation stays in the local Supabase integration gate. The production build needs no live Supabase.

`buildRoomBindings` resolves parent translations and Z rotations into world room XYZ inches. Interaction focus points are parent-local; optional hitbox centers and label anchors are node-local. Camera focus prefers a location's primary binding regardless of node order, falling back to a non-primary binding for aggregates. Aggregate focus defaults to descendant geometry bounds. Groups have logical bindings but no scene interaction targets: select aggregates through the conventional picker. The schema rejects selectable group targets instead of accepting targets the renderer cannot handle. Nonselectable group focus metadata remains supported. The renderer alone converts through `coordinates.ts`: room [X,Y,Z] becomes Three [X,Z,-Y].

Measured room/opening, rack, shelf-section and drawer dimensions remain unchanged. Shelf thickness, container XY positions, hinge side, cutaway walls, visual furniture details and label placement are presentation defaults, not new measurements. Drawer ordering remains the documented assumption. Furniture styling adds no inventory identity.

The orthographic camera has two explicit modes. Guided applies the room's finite azimuth and elevation limits. Free Orbit permits unrestricted horizontal rotation and elevation above or below the room, retaining a small epsilon from the vertical poles to avoid the numerical singularity; camera roll remains disabled. Returning to Guided clamps both azimuth and elevation to the nearest allowed values. Both modes preserve upright orientation and selection. The preference is local with a Guided server-rendering fallback. No infinite value enters room JSON or its strict finite-number schema.

Recenter translates the camera and orbit pivot to `room.camera.target` while preserving angle, elevation, zoom and selection. Double-clicking exposed floor invokes that same action; dragging or double-clicking furniture and labels does not. A recent manual camera movement also suppresses an accidental floor double-click. Opaque envelope and furniture geometry stop raycast clicks behind them. Side-anchored labels move to the camera-facing box face and remain single, upright, occlusion-aware selection buttons. Fit room projects the validated room and binding bounds at the current orientation and sizes them against the actual canvas viewport, so its framing differs from Recenter and responds to sidebar/viewport changes. Center selected preserves the primary binding's focus point and sizes the selected bounds around it in the canvas viewport; small locations retain a useful zoom cap while aggregates stay in frame. Repeated requests for the same selection work. Any camera command or manual control input interrupts an older focus animation; reduced motion snaps immediately. Initial Fit waits for a positive canvas size and applies only while the view is pristine. Restored views, manual input and camera commands end that state; later resizing never reframes over user intent. The primary toolbar keeps Fit room, Center selected, zoom, Interact and More in one row with 44 px targets. More is a compact nonmodal anchored overlay with internally scrollable Recenter, orbit mode, grouped pan/rotate/tilt, Show labels, counts and help. It leaves the canvas size unchanged and map controls operable. Its rectangle is reserved in label placement. Opening focuses its first control; Tab remains free. Escape closes it, disarms an active map, announces that state and restores Interact focus; a passive Escape restores More. Outside dismissal does not steal focus. Fit room and Center selected close More and help before revealing the requested view, retain focus on the invoking primary button, and preserve interaction mode and logical selection. Recenter also dismisses the panel and restores the surviving More trigger; repeated Pan, Rotate and Tilt commands keep the panel open.

## Selected-location reveal

The shared spatial controller owns presentation phases (`idle`, `flying`,
`revealing`, `settled`, `cancelled`), never inventory selection. Each request has an
immutable actor/environment/space scope, generation, request ID and stable code.
The same token follows camera completion, cancellation and reveal; an older
A→B→A completion cannot act on the newer A. Clear, missing bindings, graphics
failure and unmount clear the old flight before any later callback. Camera input,
mode changes and Fit/Recenter cancel pending flight/opening. Input after opening
has started settles the currently selected open endpoint immediately. Cancelled
requests remain cancelled when Reduced motion is subsequently enabled.

After a real committed scene frame and positive viewport, direct arrival and Show
in room start at Fit and fly for 750 ms, followed by a 400 ms reveal. In-room
selection uses the current view. Back and restored per-space context preserve the
camera unless the user explicitly requests fresh focus. Reduced motion centers,
labels and opens the valid target immediately, including a preference change
during flight. Repeated focus on the same code retains its open visual endpoint.

The optional additive v1 `visual.reveal.offset` tuple uses node-local room XYZ
inches; each finite component is bounded to −24…24. These are code-managed visual
defaults, not measurements. Six left drawers move +X and six right drawers −X by
`min(6, local X depth × 0.35)` (5.6 inches for the measured 16-inch boxes). Red
Container moves +X four inches; Black and Clear move −X four inches as whole
boxes. Shelf sections rise one inch. Rack and aggregate selection retain existing
focus/highlight treatment; they never open descendant drawers or receive invented
aggregate count badges.

Measured outer transforms, hierarchy and `buildRoomBindings` resting coordinates
remain unchanged. Stationary transparent logical hitboxes are separate from the
animated body, decorations, exposed-face samples and label/badge origins. Pointer
down and click both validate the first actual visible surface, including opaque
unbound blockers; vacated hitbox volume cannot select, and a moved exposed face
outside its old bounds still owns its original stable code. A separate rest/open
union envelope frames camera focus without mutating logical bindings. World
matrices update before hover/label sampling. Reveal and flight invalidate demand
frames while running plus bounded endpoint settling, then stop.

Selected reveals demand the existing scoped occupancy snapshot even with Show
item counts off. Only that exact selected location receives its real products /
units / individual assets triple; known eligible zero is explicit, while missing,
inactive, unsupported, loading and error counts remain unknown. Decimal text
retains precision beyond JavaScript's safe integer range. This does not change
the endpoint, inventory scope, mutation authorization or aggregate semantics.

Controller, schema, framing, camera supersession and selected-count regressions
are authored locally. Browser pointer tests use real transformed opaque triangles
and read-only scene observation at oblique, overhead, underside and panned poses,
including both drawer sides, containers, shelves, rack/aggregate behavior,
stationary hover, moving down/up, interruption past old deadlines, Reduced motion
and settled real draw counts. Authored tests are not evidence of a browser pass;
recordings, viewport/theme checks and independent review remain required before
acceptance.

## Accessibility, failure and performance

Location names and codes occupy separate lines. Ordinary codes remain intact; codes longer than 24 characters have a bounded horizontal scroll region with the complete code and a keyboard focus target outside selection buttons. Search results retain full path context, while group-detail child links use short names with full accessible breadcrumbs and existing capability labels. A single parent map/Spaces action supplies the secondary navigation.

The contents panel names active-only scope, distinguishes each row's local holding from item-wide totals, and labels distinct counts as “On this page”; the full matching count remains rows. Empty destinations explain “No active inventory here” and link to all-status location contents, without an empty pager. Out-of-range contents pages replace the page parameter and retain selection while a new authorized response loads. Request identity/generation checks continue to reject stale results. No-selection guidance names the map only when registered, visible and available; unmodeled, hidden and failed surfaces direct users to the location browser.

Normal location selection and inventory links stay available outside the canvas. Controls have readable names and touch-sized targets. Selection is announced as text, not color alone. Ordinary labels appear on hover or while Show labels is enabled. An exposed selected object always retains its readable label, even with labels and counts off; visible labels are keyboard-operable buttons, while mesh clicks remain a separate canvas raycast path. Touch users may tap exposed objects, and the conventional location panel remains the dependable path for occluded or crowded destinations. Occluded storage remains available through the picker. The room can be hidden on any screen, and phone workflows do not require precise pointing.

The renderer is dynamically imported with server rendering disabled. Loading, unavailable graphics, initialization errors and context loss keep the conventional UI usable. Retry recreates the graphics surface. Hide/show clears readiness until the remounted scene actually renders.

Hover labels follow the nearest visible scene mesh under the pointer, resolving child furniture through its logical storage owner. Opaque floor and furniture surfaces block targets behind them; invisible convenience hitboxes cannot create a hover label. The hover label is a screen-space button near the pointer, so camera-facing 3D anchor occlusion and label collisions cannot hide an exposed storage target. Camera motion rechecks the same pointer position. The brief mesh-to-button handoff preserves the label without changing selection. Drei Html creates independent DOM roots, so each label explicitly captures the scene's per-room registry before that boundary and provides it inside the new root. One screen-space registry lays out projected labels, shelf/section text, decorative door text, hover labels and count text together. Selected readable text takes first priority, followed by one recognizable occupied marker per exposed occupied location, then optional hover/full labels and decoration. Duplicate location actions are suppressed. Selected names wrap within a bounded width. Visibility comes from frustum-tested exposed face samples and opaque scene raycasts through the actual transformed target, rather than whether its preferred HTML anchor happens to be visible. Transparent convenience hitboxes do not count; partly exposed targets may use another exposed sample. Overlay-covered samples are excluded while uncovered samples remain eligible. Offset labels receive noninteractive leader lines to that exposed anchor. Previous valid placements are reused, then nearby positions, then a deterministic viewport rail for mandatory actions. Full text and compact 44 px footprints are measured together. Focus/hover text expands only after reserving every mandatory action; when it cannot fit, a readable conventional summary supplies identity and accurate counts without changing selection or resizing the canvas. A view with insufficient capacity states the limitation and supplies the affected location list; that fallback does not establish acceptance of the current room at 375px. Resizing and loaded fonts schedule bounded remeasurement; layout does not request an endless render loop. When its label is already exposed and clickable, that label serves the hover; otherwise the screen-space button appears. Hidden labels neither receive clicks nor remain keyboard-focusable. Door decoration is not a logical inventory target.

The map starts passive: plain wheel scrolling and one-finger swipes belong to the page, while deliberate taps still select. Interact with map enables one-finger/left-button rotation and two-finger pinch; right-drag and the button controls pan. Done, Escape, focus leaving the surface or a pointer press outside it disarms manipulation. Ordinary wheel events reach OrbitControls only while active; passive wheel remains page scrolling. Ctrl/Command+wheel always bypasses OrbitControls without preventing the browser default, including trackpad pinch represented by Ctrl-wheel. Direct pointer pinch is owned by an explicitly active canvas with touch-action:none; passive touch-action:auto preserves vertical page scrolling. Browser keyboard zoom is untouched. A passive drag briefly explains activation without capture or preventDefault. Pointer cancellation, lost capture and disarming clear owned gestures. Drag, pinch and cancelled swipe gestures cannot become accidental mesh selections. Pointer affordance follows the nearest visible selectable surface and clears during dragging, on leave and on cleanup.

Optional Show item counts is off by default. The renderer receives locationOccupancy keyed by stable location code; it never fetches per mesh. Each triple separately names active quantity products, quantity units and individual assets. Products count distinct nonarchived definitions with positive holdings; units sum those holdings; assets count active physically stored records, excluding site assignments. No mixed total is invented. Known eligible zero is explicit, while missing/ineligible/loading/error remains unknown. Occupied targets use one non-color-only compact badge when needed, with accurate counts in its accessible name and deliberate focus/hover/selected presentation. No aggregate parent badges are shown.

SpacesWorkspace enables one uncached /api/room/occupancy request with space and fresh generation when counts are on or a selected modeled eligible leaf needs a reveal badge. The endpoint derives modeled active inventory-capable leaf codes from authenticated locations and Git geometry and invokes the additive caller-scoped inventory_location_occupancy(text[]) read. The legacy active-entry RPC remains unchanged. New counts are canonical decimal text bounded to PostgreSQL signed bigint; BigInt is used only for exact display formatting. Response identity binds actor, application origin, independently derived public backend origin, space, active-only filter and a fresh request UUID. Every transition owns a new generation, including off/on and A→B→A. Old counts disappear before the next committed paint. No private cache is shared or persisted. The RPC application deadline is five seconds and the browser deadline eight seconds; timeout produces unavailable counts, never zero. Cleanup aborts are quiet. SQL retains its five-second statement_timeout; actual REST elapsed-time enforcement still needs runtime proof.

Navigation, page return, window focus and visibility restoration refresh enabled counts and selected contents; returning from an inventory operation reloads both. Refresh inventory provides an explicit retry. These are snapshots, not realtime occupancy: another session's changes appear on refresh/return. The contents row total remains active holding/asset entries, whereas the badge distinguishes products, units and assets; the reads may observe separate concurrent commits.

Use simple reusable geometry and restrained lighting, a capped device pixel ratio and demand rendering. Physical material colors are retained; accent edges/emissive feedback mark selection and other geometry dims slightly until clearing it. Full motion permits one bounded selection pulse; Reduced motion uses a static highlight. Nonessential pulses stop offscreen or in a hidden document. The canvas exposes passive camera telemetry for real-interaction browser assertions; it cannot set camera state.

## Scene effects and cached grounding

One scene-session effects owner tracks actual furniture mesh and light references,
caster motion, selection, quality and capture revisions. Each mesh registration
contains the scene generation, scene node ID and stable logical location code.
Hitboxes, labels, edges, the room envelope, floor and effect helpers are excluded.
Registry identity prevents stale cleanup from removing a newer registration.

Fine-pointer Full motion lifts only the visual child by 0.1 inch in local Z over
120 ms and brightens its edge. The measured parent, logical child hierarchy and
stationary logical hitboxes remain unchanged. Body decorations and label origins
follow the lift. Reduced motion keeps the static edge cue. A separate visual hover
latch survives the object's own lift; actual pointer movement, camera changes,
selection or other geometry refresh it. It never supplies click eligibility or
tooltip visibility, which still use the nearest actual visible surface.

Selected-only bloom is lazy-loaded inside the existing Canvas through pinned
`@react-three/postprocessing` 3.1.3 and `postprocessing` 6.39.5. The isolated
Suspense/error boundary and actual composer render guard retain ordinary selection,
labels and picking after import, allocation, shader, framebuffer or render failure.
Only exact selected mesh references or the existing authorized aggregate descendant
representation enter its reserved layer; hover does not. The composer uses zero
multisampling, no normal pass, a depth buffer and half-resolution non-mipmap bloom.
The core selective effect retains full-scene depth masking. The wrapper runs at
priority 1 with `autoRenderToScreen=false`; it never draws a composed base image to
the screen. At priority 2, exactly one ordinary scene draw uses the raw ACES,
exposure and output color configuration captured before the wrapper mounts. A
separate fullscreen overlay then adds only the selected bloom effect's texture
from the same successful frame. It encodes the bloom contribution alone, applies
intensity once and preserves destination alpha. Zero intensity, missing textures,
failed or skipped composer frames cannot add stale glow. There is no fullscreen
ToneMapping effect, base-image sampling or base-color transformation. Actual
effects-off/on color equivalence still requires GPU visual proof.

Composer success and failure restore target/cube face/mip, viewport/scissor/test,
clear color/alpha and all auto-clear flags, tone mapping/exposure/output space,
camera layers, scene background/override material, shadow enabled/auto-update and
XR state in a finally block before the raw draw. The raw draw/overlay also restore
their frame-entry wrapper state afterward. If the package's global material-swap
workaround is unexpectedly enabled, bloom fails gracefully without changing that
global setting. The wrapper owns the composer, effect and bloom texture; the
overlay owns and disposes only its geometry/material/isolated scene.

The contact adapter owns a 512-square floor capture, one intermediate target,
depth material and separable blur resources. It copies actual caster world matrices
into an isolated capture scene and shares source geometry without disposing it.
Capture consists of one depth render and two blur passes. A finally block restores
the renderer target, viewport, scissor, clear state and XR state after success or
failure. Failure disposes owned resources and stops retrying. Room replacement and
unmount dispose the resources as well.

The contact cache key contains scene generation, geometry registration revision,
settled caster revision, palette revision and shadow quality. Any caster motion,
including the previous selection closing or a hover lift, immediately hides the
old map. A single capture follows all settled transforms; motion frames do not
capture. Camera, counts, label packing and bloom changes do not dirty floor-space
contacts. Resting container alpha footprints have been removed, so moving bodies
cannot leave those shadows behind. Small static corner patches remain during the
dirty interval; there is no SSAO pass or continuous shadow light.

Palette updates reread the existing supported hex/rgb root tokens after coalesced
`documentElement` class/style/data-theme mutations or System color-scheme changes.
Only changed color values advance the revision. Unsupported updates retain the last
supported palette; cleanup discards queued reads and removes observers/listeners.
W12 must commit root palette tokens before invalidating the scene. Theme changes do
not replace the Canvas, and a change during motion captures only the latest settled
geometry and palette. Integrated Light/Dark visual tuning remains required.

The narrow `effectsQuality` input accepts standard, low or off. Low disables bloom;
off also disables contact captures. Measured fallback samples only adjacent frames
actually requested by camera or body/pulse activity, excludes idle gaps, capture
frames and startup/lazy-composer warmup, and latches bloom off after two consecutive
60-frame windows with p95 above 25 ms. This initial threshold needs reference-runtime
tuning. Renderer names do not infer capability. `SCENE_EFFECTS.intensity` centrally
scales reveal, hover, selection and grounding. Effects consume demand frames and
request only bounded initialization/change/settling frames; none owns an idle loop.

## Validation

Pure tests prove transforms, canonical bindings, database-derived descendants, strict URL selection and camera limits. Component tests prove the scene/application contract, coherent pending navigation, aggregate selection, repeated focus, missing bindings, retry/failure and located/unlocated links.

Real local Supabase Playwright tests cover authentication, actual WebGL rendering/raycast selection, shelf and drawer stock, search-to-room, aggregates, history navigation, repeated focus, viewer access, phone usability and forced graphics failure. A passing mocked scene is not evidence that WebGL works. Inspect actual screenshots for clipping, label overlap and proportions; avoid pixel-perfect assertions.

Hover regression tests move the pointer over actual visible geometry at oblique, overhead, underside and panned Free Orbit views, then verify the resolved location, projected binding intersection and tooltip; each angle is captured for visual review. With a stationary pointer, UI pan commands move a known shelf off its independently computed ray, and the old hover label must clear or change. Tests also cover opaque occluders, invisible hitboxes, DOM label handoff, hover without selection, and Show labels accessibility. Camera telemetry is read-only and does not replace pointer interaction.

Input regression tests must exercise actual browser event ownership: passive page scroll and active ordinary-wheel zoom, browser-owned Ctrl/Command-wheel, passive touch swipe without selection, activated rotate/pinch, exit controls and keyboard alternatives. Label checks measure every visible text rectangle together, including count/decorative text, across Fit/focused views and viewport/font changes. Pure placement tests and mocked components do not establish these browser behaviors.

Spatial performance acceptance compares baseline and candidate with matching browser/renderer, build mode, viewport, DPR and active interactions. Record graphics readiness, real draw-bearing frames or browser traces, interaction frame intervals and settled idle work; requestAnimationFrame callbacks alone are not rendered frames or GPU timing. Software rendering and emulated touch do not certify hardware frame rates or a physical phone. The general navigation performance gate does not by itself prove renderer readiness.

For focused browser iteration use `npm run test:e2e -- tests/e2e/room.spec.ts`. This still builds with the local public backend environment. Final certification remains fresh `npm ci` followed by the complete `npm run validate`, exact-head CI, fresh Codex review and the configured nonproduction preview smoke.

W15/W16 focused pure/component tests cover actual registry filtering, supersession,
hover pre-frame reversal, Reduced/coarse endpoints, cache coalescing across old/new
body motion, renderer-state restoration after failed blur, owned disposal and
latched composer failures. Authored browser journeys use independent exposed
triangles and passive actual mesh/resource/render counters to check hover ownership,
selected/aggregate bloom, live palette updates, camera/count cache reuse, settled
idle and resource plateaus. These journeys are not a browser pass until executed.
Acceptance additionally requires blocked-object bloom/occlusion inspection, both
themes, quality/failure controls, room/mount cycles and matched warmed effects-off/on
camera/reveal traces on recorded reference hardware. Record active median/p95,
capture spikes separately, viewport/DPR, exposure/output and actual renderer/runtime.
Software rendering can prove behavior but cannot establish GPU performance or a
claim of no measurable frame-time regression.

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
