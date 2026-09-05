# Room navigation

The room is a client-loaded navigation surface over the existing protected Inventory Core. PostgreSQL owns locations, inventory and history; `data/rooms/it-closet.json` owns geometry. The scene receives validated geometry, stable location codes, descendant highlight codes and focus requests. It emits a selected code and graphics lifecycle notifications. It never fetches Supabase data or performs inventory mutations.

## Selection and reads

`/room?location=ITC-S1A` is the durable selection. The server validates the code, resolves it against authenticated `getLocations()`, and calls the existing `getInventory({location, page})` read contract. Selection and the inventory panel arrive together in the server response. Navigation shows a pending state and preserves the prior coherent selection/panel until that response arrives. There is no optimistic second selection store.

The conventional picker and scene use the same navigation callback. Back, forward, reload and Show in room use the same URL contract. Quantity definitions without stock have no fabricated room link. Unknown or unmodeled codes retain conventional navigation and an explanatory message. Pagination retains the selected location.

An aggregate remains the selected location. Highlighted inventory-bearing descendants come from database parent IDs and `can_hold_inventory`, including inactive locations for discovery. Scene ancestry never determines inventory scope or valid mutation destinations.

`ShowInRoom` is a small ordinary link component, independent of the renderer. Search, quantity balances, asset locations and location details link by code. The existing detail workflows remain the sole mutation UI.

## Geometry and camera

The strict Zod room contract is validated without a database at build/test/load time. Binding-to-seeded-location validation stays in the local Supabase integration gate. The production build needs no live Supabase.

`buildRoomBindings` resolves parent translations and Z rotations into world room XYZ inches. Interaction focus points are parent-local; optional hitbox centers and label anchors are node-local. Camera focus prefers a location's primary binding regardless of node order, falling back to a non-primary binding for aggregates. Aggregate focus defaults to descendant geometry bounds. Groups have logical bindings but no scene interaction targets: select aggregates through the conventional picker. The schema rejects selectable group targets instead of accepting targets the renderer cannot handle. Nonselectable group focus metadata remains supported. The renderer alone converts through `coordinates.ts`: room [X,Y,Z] becomes Three [X,Z,-Y].

Measured room/opening, rack, shelf-section and drawer dimensions remain unchanged. Shelf thickness, container XY positions, hinge side, cutaway walls, visual furniture details and label placement are presentation defaults, not new measurements. Drawer ordering remains the documented assumption. Furniture styling adds no inventory identity.

The orthographic camera uses the room's azimuth/elevation/zoom limits. Pan and zoom are available through pointer/touch controls and ordinary buttons. Fit room resets the view without clearing selection. Location focus is brief, cancellable by new focus or manual input, and snaps under reduced motion. Focus request identity is separate from the selected code, so Focus selected works again after manually moving the camera. Highlight persists after animation ends.

## Accessibility, failure and performance

Normal location selection and inventory links stay available outside the canvas. Controls have readable names and touch-sized targets. Selection is announced as text, not color alone. Passive scene labels do not intercept pointer events; selection uses the actual canvas geometry. Occluded storage remains available through the picker. The room can be hidden on any screen, and phone workflows do not require precise pointing.

The renderer is dynamically imported with server rendering disabled. Loading, unavailable graphics, initialization errors and context loss keep the conventional UI usable. Retry recreates the graphics surface. Hide/show clears readiness until the remounted scene actually renders.

Use simple reusable geometry and restrained lighting, a capped device pixel ratio and demand rendering. Only controls and bounded focus transitions request extra frames. No external fonts, heavy postprocessing or persistent animation is needed.

## Validation

Pure tests prove transforms, canonical bindings, database-derived descendants, strict URL selection and camera limits. Component tests prove the scene/application contract, coherent pending navigation, aggregate selection, repeated focus, missing bindings, retry/failure and located/unlocated links.

Real local Supabase Playwright tests cover authentication, actual WebGL rendering/raycast selection, shelf and drawer stock, search-to-room, aggregates, history navigation, repeated focus, viewer access, phone usability and forced graphics failure. A passing mocked scene is not evidence that WebGL works. Inspect actual screenshots for clipping, label overlap and proportions; avoid pixel-perfect assertions.

For focused browser iteration use `npm run test:e2e -- tests/e2e/room.spec.ts`. This still builds with the local public backend environment. Final certification remains fresh `npm ci` followed by the complete `npm run validate`, exact-head CI, fresh Codex review and the configured nonproduction preview smoke.
