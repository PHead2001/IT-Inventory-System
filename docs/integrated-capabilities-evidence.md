# Integrated capability evidence

Acceptance ledger for the September 25 milestone. Requirements come from the
authorized integrated-capabilities goal; design contracts are recorded in
[integrated-capabilities.md](integrated-capabilities.md). This ledger records
proof, not implementation promises. Historical PR reviews and test results do not
certify the integrated candidate.

## Verified starting facts

| Fact                  | Evidence and boundary                                                                                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration baseline  | Verified main `98ae22e71cf24ca38dcd91de143020f8ee0b1ac5`. Recheck main before final delivery; this is not the final candidate SHA.                                                                                                                                                                                     |
| Designer recovery gap | The baseline lacks the intended visual designer; PR16 merged into the former metadata feature branch. Recovery from merge `3912a5faab1e969ed68b8d10921865359ac896cd` is recorded at `681432c9c4472eadf12f8549fae7db1e65219e5e`, with partial local proof below. Final integrated and hosted acceptance remain pending. |
| Design checkpoint     | `000984b` records the reviewed custody, availability, topology, attachment and compatibility decisions. Independent design review is complete; implementation review and runtime acceptance remain pending.                                                                                                            |
| Integration PR        | Draft PR20 targets main. Its integration baseline includes owner-merged PR19; this is not final-candidate certification.                                                                                                                                                                                               |

## Partial recovery evidence

Recovery checkpoint `681432c9c4472eadf12f8549fae7db1e65219e5e` has lead-verified
local evidence: fresh `npm ci` before the later file dependencies, 58 focused unit
tests, 442 pgTAP tests plus integration checks and generated-type verification,
and four scoped production-build browser tests. Browser coverage includes using
the published form for quantity and asset creation, editing and reload. The lead
inspected the screenshots. These checks certify only the recovery checkpoint and
tested scope; they do not certify later files/custody changes or the full milestone.

Independent source review found no actionable permission, version or provenance
issue in the recovered designer boundary: actor and configuration permission are
checked server-side; recovery retains original draft UUID/version and published
pointer; returned review identity must match; advanced JSON applies locally and
invalidates review without rebasing. The legacy-history correction and its moved/
removed-field integration assertions were also reviewed. Runtime results above
are worker evidence verified by the lead, not a second reviewer runtime execution.

## Integration checkpoint (not final certification)

- Custody/location foundation `9fc517e` passed 475 pgTAP assertions and the
  existing integration suites, including independent-connection custody races.
  An upgrade from the prior schema preserved stock and assets at inactive storage
  and allowed evacuation to the office. Later shared-read, file and UI changes
  are outside that checkpoint's proof.
- Independent custody and file source reviews produced fixes before acceptance.
  The shared-read review subsequently found a two-snapshot low-stock dashboard;
  the pending dashboard migration now returns status and all custody totals in
  one statement. Focused independent source re-review is clean; runtime proof
  remains pending.
- Codex reviewed `681432c` and `4504e74`. Its three findings concern obsolete
  recovery after undo, stale recovery after an oversized write, and datetime
  offset comparison. Fixes are in `4504e74` and local `8aad7ef`, with focused
  regressions. All three remote threads remain open pending pushed fix evidence,
  green exact-HEAD checks and fresh review. This is not a clean final review.
- At `4504e74`, the remote database/browser job passed; the app job stopped at
  evidence-document formatting. Formatting is corrected in `8aad7ef`; later
  integrated `npm run validate:app` passed typecheck, zero-warning lint,
  formatting, 510 Vitest tests, 27 preview-access tests, export-memory checks,
  discovery of 63 browser tests and the production build. This is local source
  checkpoint evidence, not final exact-SHA remote certification.
- Focused custody-read integration passed after the dashboard migration applied.
  The first custody browser run failed with missing Next build manifests while
  another worker also built the shared `.next` output. Exclusive build/runtime
  ownership was established for the rerun. Subsequent real browser tests found
  site-held label lookup failures, ambiguous opening-RPC identifiers and narrow
  label-search overflow. Forward migrations `20260925160200`, `20260925160300`
  and `20260925162250` plus the responsive label fix now pass focused low-stock,
  custody and custody-read integration, generated-type checking and all three
  custody browser journeys. The lead inspected the desktop site and mobile
  label/assigned-asset captures in ignored `test-results/custody-review/`.
  Full integrated and hosted certification remain pending.
- Codex review of pushed checkpoint `39c48f1` independently reported the site-held
  label lookup problem. Four threads remain open. CI at that checkpoint passed
  475 pgTAP assertions and the foundation/inventory integration tests, then failed
  the old no-repeated-total export assertion; the app job failed formatting of
  the concurrently edited custody browser test. The forward export fix preserves
  the old assertion and puts explicitly named item-wide totals only on the first
  filtered holding row. Focused local proof above covers that repair.
- Real local Storage acceptance remains incomplete: a near-20 MiB upload after
  the upload/cancel/cleanup sequence reproducibly times out at Kong. Isolated
  large uploads succeeded, and raw versus multipart bodies and graceful helper
  shutdown did not remove the failure. A controlled classifier then proved both
  false-size and honest-size near-20 MiB baseline uploads succeed, while a genuine
  unreserved upload denial precedes the next large-upload timeout. Connection/
  provider-body handling remains under investigation; no complete Storage gate
  is claimed.
- A separate high-risk source review confirmed that Storage's preflight RLS test
  rolls back before streaming and its final metadata upsert uses elevated access.
  RLS locks alone do not establish completion-time immutability. A bucket-scoped
  completion guard and deterministic post-preflight race tests are in progress;
  the Files boundary is not accepted until real local and hosted proof pass.
- Read-only provider inspection confirmed PR20's nondefault Supabase child
  `bojqpqdsmjyrxlgfgqux` under `dndqydmuqoduwaoujfki`, with the integration branch
  name and PR20 association. Its latest observed migration is
  `20260925003000`. The Vercel preview `dpl_6HWPo347roSGEmWurLASMfSpiPjx` is READY
  at `4504e74`; it does not yet contain the pending custody/files work. Reverify
  the eventual candidate and child identity before hosted writes.

## Capability coverage

| Goal                                  | Proof required on the integrated candidate                                                                                                                                                                                                                                                                                                                                            | Prerequisites and important boundaries                                                                                                                                                                                                                                                                                     | State                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A — Designer and configuration access | Recovered visual editor; supported field/rule/default/applicability and option-tree limits; real pointer drag/resize and keyboard operations; renderer preview; undo/save/discard/review/publish; identity-bound recovery and stale-baseline denial; published form used by normal inventory workflows. Maintainer configuration writes and clear staff/viewer read-only explanation. | Preserve actor, draft UUID/version, published pointer, review token, stable IDs and immutable value provenance. Owner provisioning procedure must be read-first against a verified Auth UUID; no fixture promotion or self-grant.                                                                                          | Partial local proof at `681432c9c4472eadf12f8549fae7db1e65219e5e`; see recovery evidence. Final integrated and hosted proof pending |
| B — Private supporting files          | Real asset PDF/photo and quantity recognition-photo upload, validation, read/download, rename, replacement, removal and retry. Direct RPC/Storage bypass denials; quotas and concurrent finalization; failed replacement retains previous file; archived/retired parents remain manageable; attachment events/revisions do not churn stock versions.                                  | Private bucket, matching environment-specific server/DB validation keys, authenticated Storage access, real byte cleanup. Direct Storage transport supports the planned 20 MiB limit; prove Linux worker/native dependencies and native-memory behavior, not only JS old-space limits. See deployment prerequisites below. | Pending                                                                                                                             |
| C — Locations and IT Office           | Maintainer creation/rename/reparent/order/deactivate/reactivate; immutable codes; cycle/kind/capability/ancestor-active checks; audited versions; real deactivation/reparent races; inactive-source evacuation. Office appears in every picker/read/filter/label/export path.                                                                                                         | Preserve required 35 closet bindings as a subset, statement hierarchy guard and placement lock ordering. No stock erasure or fake movement history. Unmodeled destinations cannot resolve to closet geometry.                                                                                                              | Pending                                                                                                                             |
| D — Sites and custody                 | Site maintenance and holdings/history filters; serialized issue/return/transfer; positive integer quantity issue/partial return/transfer; opening records; reasoned correction/write-off/site retirement; explicit restore; archival guards; unique linked inventory/assignment events, receipts and versions.                                                                        | One current-state authority; enforce legacy-entry-point denials and same-entity event links. Real multi-connection races and history-insertion failure rollback. Separate gross issues, transfers, openings and unique assets.                                                                                             | Pending                                                                                                                             |
| E — Shared accounting and integration | Shared available/assigned/owned calculations across dashboard, detail, search, filters and exports; inactive-storage balances retained; null/zero/inclusive thresholds; no join multiplication; stable QR links; metadata and file continuity through custody/category changes.                                                                                                       | Preserve export snapshot, row/byte caps, formula protection, private access and provenance. Site-aware row identities; no attachment bytes/tokens in CSV. Mobile, keyboard, non-WebGL and existing room controls remain usable.                                                                                            | Pending                                                                                                                             |

## Required acceptance journeys

Each journey needs local evidence and signed-in evidence on the verified isolated
preview. Record the candidate SHA, actor role, fixture identities, assertions,
capture/test location and cleanup outcome; do not store credentials or bearer URLs.

| #   | Journey and decisive assertions                                                                                                                                                                                                                                | State / evidence                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Maintainer edits a category and visually publishes a representative form; staff saves real inventory using it. Revision/stale edits preserve input and require explicit review. Staff/viewer configuration denial holds below the UI.                          | Partial local proof at `681432c9c4472eadf12f8549fae7db1e65219e5e`: four scoped production-build browser tests, including published-form quantity/asset create, edit and reload; screenshots inspected by lead. Full journey on final local and hosted candidate pending |
| 2   | Staff uploads, views/downloads, renames, replaces and removes an asset document and quantity photo. Viewer reads ready files but cannot mutate. Failed replacement preserves the old file; removed-file and cleanup behavior are proven.                       | Pending                                                                                                                                                                                                                                                                 |
| 3   | Maintainer creates office storage; staff creates/moves a laptop there. Picker, search, stable labels and export agree; Show in room explains the missing model. No invented physical measurements or quantities.                                               | Pending                                                                                                                                                                                                                                                                 |
| 4   | Start with storage 10 and threshold 7. Issue 3: available 7, assigned 3, owned 10, low-stock true. Return 1: available 8, assigned 2, owned 10, low-stock false. Transfer 1 between sites: available unchanged, site balances correct.                         | Pending                                                                                                                                                                                                                                                                 |
| 5   | Assign/return a serialized switch. Exactly one active custody destination, permanent asset QR, readable documents and linked site/inventory history; no duplicate asset or stale drawer representation.                                                        | Pending                                                                                                                                                                                                                                                                 |
| 6   | Opening asset/quantity holdings invent no prior storage movement/date. Reasoned write-off/site retirement closes custody. Over-return and outstanding-holding site/location/archive operations fail. Restore selects storage and does not recreate assignment. | Pending                                                                                                                                                                                                                                                                 |
| 7   | Final ordinary inventory, custom fields, labels/scanning, low-stock, bounded exports, room/navigation and preview-access regressions pass together.                                                                                                            | Pending                                                                                                                                                                                                                                                                 |

## Deployment prerequisites

| Boundary            | Required setup or proof                                                                                                                                                                                                                                                                                                                                   | State                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| File transport      | Keep file bytes on browser-to-Supabase Storage paths; the Vercel validation request contains identifiers, not a 20 MiB body. Vercel documents a 4.5 MB function payload limit. Supabase supports standard uploads of this size but recommends resumable uploads above 6 MB; prove interruption/retry behavior.                                            | Pending hosted proof                                    |
| Bucket and policies | Apply the additive migration, then verify the private `inventory-files` bucket, 20 MiB limit, allowed MIME types and policies through actual Storage operations. Database migration success alone is insufficient service-readiness evidence.                                                                                                             | Pending                                                 |
| Validation keys     | Install a fresh child-specific key in the private DB key registry and the matching server-only `INVENTORY_FILE_KEYS_JSON` in the corresponding branch preview. Verify ID, activation and expiry without exposing values. No service-role client in ordinary requests. Use local `.env.*.local` material only after `git check-ignore` confirms exclusion. | Pending                                                 |
| Linux runtime       | Verify the deployed Node validation route loads its worker, Sharp native dependencies and PDF parser. A Windows build trace is not Linux execution proof. Confirm function bundle size and the configured 60-second invocation budget.                                                                                                                    | Pending                                                 |
| Resource bounds     | Exercise maximum-size/complexity supported image/PDF inputs and concurrent validation. Worker old-space limits do not cover ArrayBuffers or native image allocations; record process-memory and deadline behavior without claiming a total-memory sandbox.                                                                                                | Pending                                                 |
| Access and cleanup  | Use separate temporary staff/viewer/maintainer fixtures; preserve the standing preview fixture. Verify authenticated private downloads, deactivation/removal behavior and browser-cache limitations. Delete bytes through supported Storage APIs and confirm bounded cleanup retries.                                                                     | Pending                                                 |
| Independent PR19    | Owner merged PR19 into main `281a0f2`; integration merge `096ff10` includes it. Scheduled preview recovery is removed; delayed/reset previews require event-driven or manual reconciliation.                                                                                                                                                              | Merged and integrated; commit evidence verified by lead |

Platform references: [Vercel function limits](https://vercel.com/docs/functions/limitations),
[Supabase standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads),
[private downloads](https://supabase.com/docs/guides/storage/serving/downloads),
[Storage deletion](https://supabase.com/docs/guides/storage/management/delete-objects),
[Node worker resource limits](https://nodejs.org/api/worker_threads.html), and
[Next output tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).
These explain constraints; they are not evidence that this deployment passed.

## Final acceptance gates

| Gate                                   | Required recorded evidence                                                                                                                                                                                                                                                                                        | State   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Candidate identity and scope           | One integration PR targets main and contains recovered designer plus files, locations, custody and shared reads. Record branch, exact local/remote SHA, migrations and clean worktree. Preserve unrelated work; no merge or release.                                                                              | Pending |
| Local canonical validation             | Fresh final dependency installation and repository canonical app/database/browser gates on the integrated candidate; generated types, additive migration replay, production build, meaningful unit/integration/E2E tests. Record command, SHA and terminal result.                                                | Pending |
| Integrity and authorization            | Direct API/RPC/Storage bypass tests; inactive/viewer/staff/maintainer matrix; actor/draft/form/version staleness; real multi-connection stock/custody/topology/catalog races; retry receipts; forced history failure rolls back state. Independent high-risk implementation review.                               | Pending |
| Hosted acceptance                      | Verify PR SHA, Vercel deployment and exact nondefault Supabase child before writes. Complete journeys 1–7 through signed-in workflows, including real uploads and designer interaction. Record desktop/narrow-screen captures. Identify any physical-phone/camera/printing limits.                                | Pending |
| Hosted fixture cleanup                 | Resolve site holdings, zero/archive fictional stock, retire fictional assets, deactivate temporary sites/locations/accounts, and remove this run's file bytes through Storage APIs. Preserve histories, seeded references and standing test account; no hosted reset.                                             | Pending |
| Remote certification                   | Exact-candidate required CI and preview health; fresh Codex review; zero unresolved actionable threads, resolved only after fix evidence. Historical merged PRs do not satisfy this gate.                                                                                                                         | Pending |
| Release prerequisites and final report | Report Storage/key readiness, additive migration compatibility, owner-only production maintainer procedure, requirement evidence, cleanup and remaining limitations. Production settings/grants/migrations/deployment remain untouched by this goal. Distinguish review-ready from merged or production-verified. | Pending |

When updating this ledger, replace Pending only with a concrete evidence reference
and its tested revision. Carry forward unchanged evidence explicitly; if subsequent
changes affect its boundary, mark it pending again until appropriately verified.
