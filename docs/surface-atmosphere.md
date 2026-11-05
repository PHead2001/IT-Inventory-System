# Shared surface atmosphere

Audit 4.2 W01–W04 is implemented as shared screen decoration. The explicit owner
request extends atmosphere across signed-in pages and supersedes the earlier
Overview/Spaces-only and no-ambient-behind-forms preferences. Opaque work surfaces,
inventory identity, mutation timing and the WebGL renderer remain authoritative.

`ShellAtmosphere` owns one `AmbientLight` with two aurora shapes and one blueprint
span. It replaces the former Overview/Spaces local ambient instances. The existing
intersection/visibility/effective-motion hook controls `data-active`; CSS uses that
hook for the 24-second aurora and 60-second grid pan. Reduced motion and coarse/touch
pointers show static decoration. The `/room` shell derives grid ink from the existing
`--room-grid`; it does not change the physical room scene.

`experience-spotlight` opts a card/row/receipt into the shared delegated pointer
controller. Fine-hover Full motion alone updates `--x`/`--y`, once per requested frame.
Bounds are captured on entry and cached until resize/scroll invalidates them; invalid
bounds are refreshed once on the next frame. There is no pointer-driven React state,
hit-target transform or idle frame loop. Inputs, editable regions, dense tables and
canvas are excluded even inside an opted-in card. Leave, removal, teardown, hidden
tabs and motion/pointer preference changes release the decoration and pending frame.
New grouped inventory cards and Overview stat/action-queue cards must use the same
opt-in class; the effect is not inferred from arbitrary borders or form containers.
The current Overview stat tiles/action rows and outer custody/assignment completion
panels already opt in, including their confirmed-result fallback paths. The nested
loaded custody receipt also remains eligible; delegated selection decorates only
the nearest eligible ancestor, so the same pointer does not paint both layers.

Only exact empty-background targets (`experience-app`, `experience-main`,
`experience-workspace`, `experience-page-arrival`, or an explicit
`data-atmosphere-background` gap) can ripple.
Matching primary pointer-down/up with the same pointer identity and at most 5px
movement is required. Small jitter preserves the candidate; crossing 5px cancels
it permanently even when the pointer returns before release. Hover cleanup does
not erase the independent background click candidate. A card,
input, control, link, canvas or text descendant cannot acquire background ownership.
One decorative ring and one cancelable 150ms animation bound the resource cost.

`surface-atmosphere.css` has one central intensity per effect: spotlight, aurora,
grain, blueprint and ripple. All ink derives from semantic palette tokens. Dark
uses spotlight .12, aurora .5, grain .29, blueprint .65 and ripple .18. Light
overrides those same five tokens to .055, .2, .12, .5 and .1 respectively: the
glow becomes a restrained accent tint, with quieter grain on pale workspaces.
The grain's .24 texture alpha multiplied by .29 screen alpha is 6.96% effective
opacity in Dark; Light is intentionally subtler at 2.88%. The grain is fixed/static;
print removes grain and all other decoration. These proposed starting intensities
require the whole-screen contrast/visual review below, not numerical acceptance.
Dark defaults are owned by `surface-atmosphere.css`; Light overrides are owned
only by `theme-palette.css`, retaining that palette's settled values. The actual
relative-import cascade is regression-tested through CSSOM, including one owner
per theme/token, so duplicated equal-specificity definitions cannot silently
replace the documented intensities.

This integration is based on PR62 `15bd370678c42443179fb93e81f668051d075194`.
It preserves the current private workspace, route/task and theme providers, current
operational screens and all canonical business fields. The older prepared W01–W04
slice contributes only the shared decoration and additive surface opt-ins. No
Overview snapshot/migration or W10 magnetic/tilt activation is carried into it.
Existing Overview and Spaces local ambient instances are removed to prevent
double painting; the sign-in ambient remains separate. The obsolete settings-tree
row implementation is not restored. Location detail rows and the current browser's
existing location content own the W01 opt-ins.

## Verification contract

W01–W04 remain **in progress**, not accepted. Source-only implementation is not
animation, contrast, layout stability or performance evidence.

- `surface-effects.test.ts` defines coalescing/bounds invalidation, excluded targets,
  touch/coarse/reduced/hidden cleanup, removed surfaces, bounded ripple and drag/control
  exclusion regressions. `ambient-light.test.tsx` defines offscreen/hidden/reduced
  pause and teardown behavior.
- `surface-atmosphere.spec.ts` defines a viewer journey through Inventory, Settings,
  Sites, Labels, Locations and Spaces, one shared host/grid, stationary spotlight
  targets, effective Reduced motion and print suppression. This read-only journey
  requires the existing disposable-local login fixture and real application build.
  It also checks actual Light/Dark theme controls, the running 60-second grid,
  target stability and coarse-pointer static decoration at 390px with real tap input.
  Defining those checks is not a claim that they have run or that a physical phone
  has been tested.
- Final runtime inspection must also exercise populated inventory/grouped cards,
  location child/result rows, Labels search cards, every receipt type and Overview
  stat/action-queue cards after integration. Toggle local and OS motion preferences,
  enter inputs inside cards, use keyboard, switch tabs, resize and scroll, and click
  empty space versus controls/links/cards and drags. Coarse-pointer/390px gets static
  decoration. Record hidden-tab pause/resume, cursor tracking and grid drift.
- Review Overview, Inventory, a record and Spaces as whole screens in both themes
  with W10/W15 and all normal effects enabled; inspect grain at normal distance for
  shimmer/banding, muted text/focus contrast and opaque working surfaces. Capture
  before/after and actual recordings on the exact integrated candidate.
- Record equivalent before/after production-build main-thread/scroll samples and
  layout stability with SHA, browser, hardware, renderer/DPR and method limits.
  Confirm no effect-driven idle WebGL renders. Unit mocks and screenshots alone
  do not establish smooth GPU frames, zero CLS, screen-reader or physical-device proof.

## Current W10 magnetic surfaces

Add item and Print labels use MagneticVisual inside a stationary native owner;
Start camera uses the same wrapper in the scanner port. Only decorative,
pointer-transparent children translate, bounded radially to 4 px. The shared
controller retains current privacy/route vetoes, permanent original-owner
retirement, cached bounds and one demand frame. Coarse/touch, Reduced motion,
withdrawal, hidden/inert/detached or disabled targets neutralize effects immediately.
Current control-marker exclusions and primary-pointer ripple guards are preserved.
Central magnetic/tilt intensity tokens allow calm combined-screen tuning.
Overview hero/stat tilt remains an explicit extension gap, not W10 acceptance.
Fresh source review, focused regressions and populated native Full/Reduced both-
theme desktop/390px hit-area, motion and performance proof remain pending.
