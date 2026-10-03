# Navigation measurement evidence

The frozen baseline is commit `b8bc0d2437d0204dd09c79ae1b69334540a2a62e`. Its tracked source was unchanged throughout both production-build measurements. The local disposable database was reset from that checkout's canonical migrations. Node 24.19.0, npm 11.11.0, Next 16.3.6 and the browser version are recorded in the raw JSON provenance. Neither dataset used production data or a hosted backend.

Each dataset has three samples for each of ten destinations in three conditions: unvisited route click, repeat route click and authenticated deep link in a fresh browser context. Ordinary motion remained enabled, with OS reduced motion set to no preference. Authentication returns to one supported location detail page before the first measured route click; no warm-up tour occurs. Category navigation starts at the first category's actual designer. The backend and local production server are warm; a fresh browser context is not evidence of a cold function.

Usable means the expected route, heading and conventional control are visible, followed by two painted frames. Labels additionally waits for the current search results to load. This does not certify completion of every client island, animation or WebGL renderer. Feedback is separately observed when a pending indicator, loading boundary or destination heading appears. A deep link replaces the document and its observer, so `feedbackMs` is unavailable; the document's `documentTtfbMs` remains separately recorded. A null feedback value is unavailable, never zero. Request TTFB, encoded response body bytes, resource transfer bytes and observed long tasks remain in the raw records. Server fetch spans overlap; their durations must not be added into a navigation total.

The original category selector had one option and could not switch. Its baseline click samples use a route link to the selected category and are not comparable to a working candidate selector. Its direct deep links remain comparable. The provenance records this limitation.

## Baseline conventional content

Values below are medians in milliseconds, with three samples per cell. These are small local samples, not tail estimates or hosted latency claims.

| Route                          |      Empty unvisited |  Populated unvisited |     Populated repeat | Populated deep link |
| ------------------------------ | -------------------: | -------------------: | -------------------: | ------------------: |
| Overview                       |                  151 |                  183 |                  158 |                 545 |
| Inventory                      |                  198 |                  223 |                  200 |                 577 |
| Scan                           |                  102 |                   96 |                   89 |                 509 |
| Labels (search results loaded) |                  373 |                  400 |                  354 |                 650 |
| Spaces                         |                  170 |                  173 |                  294 |                 554 |
| Locations                      |                  148 |                  142 |                  155 |                 514 |
| Properties/sites               |                  136 |                  142 |                  154 |                 500 |
| History                        |                  161 |                  195 |                  162 |                 539 |
| Settings                       |                  100 |                   88 |                   87 |                 499 |
| Category form                  | unavailable selector | unavailable selector | unavailable selector |                 580 |

The populated fixture contains 30 quantity definitions, 30 serialized assets and eight sites. Canonical locations/categories remain present in the empty fixture. The fictional population uses authorized inventory/site RPCs and existing local fictional Auth fixtures. It is intentionally not a maximum-scale dataset.

Each raw JSON also contains three authenticated room-content request measurements. The baseline handler made four Auth user requests, four membership reads and two location reads per request. Its populated total duration median was 572 ms; the empty median was 565 ms. A fresh handler-local scope is the targeted fix. By comparison, ordinary React Server Component navigation already coalesced membership reads, so source-level helper duplication there is not proof of duplicate backend traffic.

## Reproduction and pending candidate evidence

`npm run test:performance -- --workspace="C:\Coding Projects\IT Inventory Navigation Baseline" --label=baseline --dataset=empty --samples=3` builds the selected checkout with guarded local public backend inputs and measures it with Playwright Chromium. Use the canonical `db:start` and `db:reset` beforehand and verify ownership of the disposable local stack. Both datasets require empty inventory, site, file and audit tables before fixture creation. Existing populated or partial fixtures are rejected; reset again before another populated run. The harness validates the final 30/30/8 entity density and records actual numeric table counts. It rejects changed or untracked source files, so candidate measurement requires a committed checkpoint. `--build=false` requires the private local build manifest written by an earlier fresh harness build: the committed source SHA, public/backend and relevant server build inputs, environment-file hashes, toolchain versions and actual Next `BUILD_ID` must match. Missing, corrupt or mismatched manifests refuse reuse and require a fresh build. Only digests are recorded; environment values and file contents are excluded. `--output` selects the raw output destination. The script never accepts a hosted database or writes cloud settings. The canonical `validate:app` sequence includes `test:performance:contract` so CI exercises these guards.

The retained baseline predates these stricter provenance guards. It was captured under exclusive disposable DB ownership after a canonical frozen-checkout reset, with one successful complete 30/30/8 creation loop and no intervening fixture writers. A repeat populated capture reused that controlled fixture to correct Labels readiness. Its original JSON provenance contains declared entity counts rather than a post-creation table-count snapshot; this historical limitation is retained rather than retroactively fabricating observed counts. Candidate captures use the stricter guard and actual counts.

The complete fetch trace files contain only epoch times, endpoint classes, HTTP status and elapsed durations. They exclude query strings, headers, bodies, identifiers, field contents and credentials. The JSON records include navigation-window fetches and browser request timings/bytes; the complete trace additionally retains authentication/source-page traffic for auditing the measurement scope.

## First candidate checkpoint: a rejected loading tradeoff

The revision-stamped `candidate-51ed5b4-empty.json` and `candidate-51ed5b4-populated.json` retain both complete matrices (90 route records and three room-content requests each) at commit `51ed5b4fd4361353d2f219f4058709c64fb82882`. A fresh harness build bound to this source and the guarded local backend was used for empty data; populated data reused that verified build after another canonical reset. Both captures record observed table counts. They use the same browser, viewport, motion and readiness conditions as the baseline.

The first candidate improved feedback but regressed usable navigation. These populated unvisited values are medians with observed ranges, in milliseconds:

| Route            |       Baseline usable | Candidate usable | Candidate feedback |
| ---------------- | --------------------: | ---------------: | -----------------: |
| Overview         |         183 (171–209) |    406 (403–416) |                 40 |
| Inventory        |         223 (216–229) |    410 (406–412) |                 33 |
| Scan             |           96 (95–118) |    404 (118–413) |                 40 |
| Labels           |         400 (269–400) |    618 (612–896) |                 33 |
| Spaces           |         173 (172–200) |    533 (526–880) |                 19 |
| Locations        |         142 (139–153) |    163 (158–166) |                 35 |
| Properties/sites |         142 (138–145) |    393 (393–875) |                 33 |
| History          |         195 (187–195) |    427 (399–869) |                 38 |
| Settings         |           88 (87–100) |     107 (97–111) |                 32 |
| Category form    | incomparable selector |    314 (309–342) |        unavailable |

Category feedback is null in these captures because the original observer did not inspect the designer's existing “Loading selected category…” status. The corrected observer measures that status in later captures and rejects idle status messages. Original records remain untouched. The populated category deep-link medians were 580 ms baseline and 573 ms candidate; the candidate selector also performs a failure-preserving target read and fresh identity check before navigation.

The broad protected loading boundary is the measured regression hypothesis: for example, the first empty Overview RSC response finished in 84 ms while usable content took 404 ms. The installed React production renderer delays suspended retries until 300 ms after its latest fallback (`react-dom-client.production.js`, `globalMostRecentFallbackTime`). Removing that broad boundary is a bounded A/B correction; its effect is provisional until a new committed capture. Immediate Link pending feedback and intent-based framework prefetch remain enabled, as do ordinary animations.

Other evidence at this checkpoint is narrower: room-content empty median fell from 565 to 413 ms and populated median from 572 to 424 ms (candidate populated range 411–464 ms), with Auth/member/location calls changing from 4/4/2 to 1/1/1 in every sample. Labels unvisited encoded script bodies fell from 39,291 to 19,531 bytes in both datasets. Neither observation cancels the route regressions. Spaces still loads roughly 218 KB of encoded route scripts and had one observed long task per populated unvisited sample; renderer completion remains outside the conventional-content definition.

The subsequent committed `5c6e0b4` capture confirms removal of the broad-fallback regression while preserving immediate feedback. Both datasets again contain 90 records and three room requests. [The route comparison](comparison-5c6e0b4.md) records medians/ranges for every condition, the remaining Labels repeat/deep-link slowdown and its observed duplicate restored-filter search work. That narrow Labels correction follows these captures and requires later measurement at its committed revision.

Final revised-source matched timings, hosted preview timing, normal-visual browser acceptance and exact final-SHA certification are pending. The local baseline does not reproduce the owner's reported multi-second hosted delay. A loading indicator alone must not be reported as a performance fix or as attainment of a Speed Insights score.
