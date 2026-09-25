# Integrated capability evidence

This ledger records the September 25 integrated milestone against its
[approved design](integrated-capabilities.md). It distinguishes the exact tested
code from a later documentation-only revision. PR20 remains unmerged; no
production migration, secret, account, or deployment was changed for this goal.

## Exact candidate and validation

The tested code is `1b3997a66dec92cc1253b10482c14ec83fd6dbeb` on
`feat/integrated-inventory-capabilities`, based on main `281a0f2`. Its latest
forward migration is `20260925190018_inventory_history_assignments.sql`.

| Gate                | Result on the tested code                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local application   | Fresh `npm ci`; `npm run validate:app` passed TypeScript, zero-warning lint, formatting, 540 Vitest tests, 27 preview-access checks, 27 real file-inspection worker cases, the bounded export-memory check, E2E discovery and a production build. The quote-heavy CSV sample used 38,685,557 bytes of its 64 MiB sampled incremental budget.                              |
| Local database      | Clean migration replay, 481 pgTAP assertions, generated-type comparison, custody/history integration across 54 real transfers and three history pages, and 78 file-completion checks passed. The complete `validate:db` gate remains **red** at the real Storage transport case described below.                                                                          |
| Local browser       | The complete canonical E2E run finished **64 passed, 1 failed**. The sole failure was the existing denial-followed-by-near-20 MiB Storage journey. Normal quantity-photo and asset-PDF journeys each passed separately on the same code. A 390-pixel history check of a persisted site label over 180 characters measured document width 390 with no horizontal overflow. |
| Linux CI and review | Exact-SHA CI run `36178526583` succeeded. The fresh Codex review completed clean and all 11 actionable PR20 threads were resolved after fix evidence. These results apply to `1b3997a`, not automatically to a documentation-only successor.                                                                                                                              |
| Isolated preview    | Vercel deployment `dpl_7qJ7SnohadNE7xNJbupcSAXY9CAo` at `it-inventory-system-qn2ul9d27-phead2002.vercel.app` was bound to nondefault Supabase child `bojqpqdsmjyrxlgfgqux`, not parent `dndqydmuqoduwaoujfki`. The child had the latest migration before the signed-in journeys below.                                                                                    |

The local failure is specific: an unreserved 2 MiB upload was denied by Storage
(HTTP 400 with provider-body code 403), and reservation of the subsequent
authorized 20,971,519-byte PDF succeeded. Its Storage POST then received no
response; the browser never called `/api/inventory-files/validate` and timed out
at 60 seconds. A direct-Storage same-socket discriminator also reproduced the
post-denial stall, while a fresh-socket control succeeded. Neither the test nor
the product timeout, file-size limit, authorization policy, or required journey
was waived. The retained local evidence is
`test-results/final-e2e-1b3997a.log` and its Playwright failure trace. Passing
Linux CI and the isolated-preview journey do not make this local gate green.
On September 25, 2026, the owner briefly accepted a narrow exception for this
local Supabase Storage denial/reused-connection failure, then explicitly
withdrew it later the same day. Green Linux CI and signed-in isolated-preview
proof do not substitute for the failing local gate. The local gate remains red
and is again an acceptance blocker until fixed and verified green.

### Local runtime repair checkpoint

Supabase Storage [v1.77.9](https://github.com/supabase/storage/releases/tag/v1.77.9)
contains the vendor fix for rejected requests with unread bodies. On the local
CLI 2.116.0 stack, the same-agent discriminator now observes the denial closing
its connection, the next authorized upload completing in 75 ms, and a subsequent
download reusing the healthy connection with an exact 2 MiB hash match. The
unchanged three-test Files browser suite passed in 19 seconds; the formerly
failing denial-to-near-20 MiB journey passed in 5.7 seconds.

The repository local-start helper now materializes and verifies this version
pin; reset and database tests reject a mismatched runtime. Hosted/production
delivery is unchanged. Artifacts are `test-results/files-fixed-provider-1779.log`
and `test-results/files-browser-1779.log`. This focused repair proof does not
replace the complete local gate, exact-SHA CI and fresh review for the successor.
The successor also validates designer defaults and supported currency codes
before publication review, including exact microsecond datetime comparisons.

## Signed-in isolated-preview journeys

Three distinct temporary actors exercised staff, viewer and configuration
maintainer permissions. The core runner's fixture ledger is
`test-results/pr20-hosted-fixtures.json`; Files evidence is in
`test-results/pr20-hosted-files-ledger.json`. Captures are under the ignored
`test-results/pr20-hosted-captures/` and
`test-results/pr20-hosted-files-captures/` directories. The lead verified the
candidate, deployment, child, migrations and actor membership before writes.

| Journey                 | Hosted result on `1b3997a`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — Published metadata  | A maintainer used the visual designer to save and publish a form. A stale second editor retained entered changes and required refresh. Staff created quantity and asset records using published fields; staff/viewer configuration writes were denied in the UI and RPC. Desktop designer capture retained.                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2 — Private files       | Real quantity photo and asset PDF flows covered validation, viewer read without write permission, private exact-byte PDF download, rename, replacement, removal, event history, invalid-content replacement preserving the old photo, and continuity through asset site assignment/return. The valid PDF was 20,971,519 bytes with a matching downloaded SHA-256; 20,971,521 bytes was rejected before upload and at the database boundary. Direct Storage overwrite, move, copy, unreserved upload and private-read attempts were denied without changing ready-file identity or display bytes. The final runner completed its stages; its ledger retains an earlier locator-failure field as diagnostic history. |
| 3 — Unmodeled office    | A maintainer created fictional office storage. Staff placed an asset there; picker, search, inventory CSV and stable QR agreed on the office code. The location page explained that no room model exists. Phone capture retained.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4 — Quantity custody    | From 10 recorded units and threshold 7, issuing 3 gave 7 available and 3 assigned with low-stock active. Returning 1 gave 8 available and 2 assigned with low-stock clear. Transferring 1 between sites preserved the item-wide total and available count. An over-return was rejected.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5 — Serialized custody  | An asset moved to a site and back with one current destination, readable linked history, and the same asset QR bytes before and after. Its file panel remained available. Phone label capture retained.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6 — Opening and closure | Opening quantity and asset records at a site did not fabricate prior closet movement. Outstanding holdings blocked archive; a reasoned write-off and site retirement closed custody. Viewer mutation controls remained absent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7 — Integrated reads    | Signed-in viewer smoke rendered the room canvas and selected `ITC-S1A`. A mocked camera stream was stopped; an external label URL was rejected. The archived fictional quantity and retired asset UUIDs remained identifiable in manual scan and opened only after explicit link clicks. Search, labels, export, history, mobile and preview-access regressions also have local/CI evidence above. Desktop room and phone scan captures retained.                                                                                                                                                                                                                                                                  |

Earlier hosted photo inspection reported no file-card response within five
seconds after validation. That **was a harness diagnosis error**: its response
predicate required a Vercel origin even though the card RPC responded directly
from Supabase. A later capture measured validation at 2.691 seconds and cleanup
399 ms later. The runner predicate was corrected, and the final Files journey
passed its actual ready-card bound. The earlier timeout is not evidence of an
application latency defect.

## Cleanup and limits

The final Files cleanup deleted and confirmed absence of all 27 registered
fictional Storage objects. The core cleanup left its three quantity definitions
archived, three assets retired, two sites and one office location inactive, and
its category removed or retained only as required by immutable history. A
separate read-only child query confirmed these states with no pending creates or
cleanup errors. All three temporary `app_members` were then made inactive and
their Auth users banned by the authorized child-only procedure. The standing
preview account was untouched. Inventory/file audit history and required
tombstones remain; cleanup is not a history rewrite or hosted reset.

The browser smoke used a simulated camera stream. A physical camera, physical
phone, printer, barcode scanner and real-world device placement were not
tested. Worker IPC and hosted PDF/image handling do not by themselves prove a
total native-process memory ceiling. The local Storage transport failure
remains an explicit acceptance blocker despite green Linux CI and hosted
preview evidence. No provider patch or timeout waiver was applied to the
recorded test run.

Production remains untouched and unverified. Before a production release, the
owner must complete the normal PR merge and protected-main delivery, provision
the environment-specific server-only file validation key and database key,
verify private Storage and migration readiness, and use the documented
owner-only maintainer procedure. See [deployment](deployment.md),
[validation](validation.md) and the [private-files contract](inventory-files.md).
