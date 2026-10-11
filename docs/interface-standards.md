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
- Until the browser preference is loaded, the motion control is a disabled ordinary button with loading help and no switch role or checked state. Once loaded, it exposes the saved choice as an enabled switch. The first styled paint remains reduced; an initial server value must not be treated as the saved choice.
- Under Reduced motion, replace movement with an instant state change or a fade of 120 ms or less. Static visual quality must remain.
- No motion that delays a request, replays on query-string updates, or runs continuously behind working forms.

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
uses exact UTC; focus/click opens the exact display timestamp, timezone and original
recorded instant with its precision. Date-only controls and export formats are unchanged.

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
