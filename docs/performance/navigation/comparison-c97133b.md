# Final matched local navigation at c97133b

Both captures measured clean commit `c97133b3a177209b9a236eaea42f05a43220a964`, application source tree `1c67559b80ba73f9e4df8823f29cf54c197d4a1b`. Canonical validate:app passed 927 Vitest tests in 94 files, configured Node checks, file/export checks, discovery of 111 E2E tests and the production build. The full E2E run is separately recorded in the acceptance ledger. No DB gate was repeated because schema inputs were unchanged.

Canonical disposable resets preceded both datasets. Observed densities were 0/0/0 and 30 quantity definitions/30 assets/8 sites. Each matrix contains three samples for ten destinations in three modes (90 records), plus three room requests. Empty data used a fresh backend-bound production build; populated data reused its verified manifest and BUILD_ID `rxD8jPbyfi-TV4L69xpYQ`. Browser, viewport, normal motion, OS no-preference and usability conditions match the frozen baseline. Local server/backend were warm; cold functions were not established.

Values are median (minimum–maximum), milliseconds, baseline → final. Conventional usability includes two painted frames and loaded Labels search results, not completion of every client island or WebGL renderer. Baseline category clicks are incomparable because its selector could not switch; final captures use the actual selector. Direct-link feedback is unavailable after document replacement; document TTFB is separate. A click record's documentTtfbMs belongs to its source document, so use classified target request timings for click responses.

## empty fixture

| Route         |               Unvisited click |                  Repeat click |                     Deep link | Final unvisited feedback |
| ------------- | ----------------------------: | ----------------------------: | ----------------------------: | -----------------------: |
| overview      | 151 (138–209) → 167 (164–176) | 157 (148–174) → 164 (150–168) | 525 (514–573) → 540 (515–551) |               33 (30–36) |
| inventory     | 198 (183–206) → 195 (185–197) | 185 (167–194) → 166 (165–170) | 582 (538–612) → 559 (552–599) |               35 (35–40) |
| scan          |  102 (100–110) → 112 (93–120) |       83 (77–84) → 83 (82–86) | 519 (506–531) → 520 (514–529) |               33 (32–42) |
| labels        | 373 (278–386) → 279 (275–351) | 369 (351–371) → 346 (250–350) | 712 (638–723) → 716 (633–743) |               36 (32–39) |
| spaces        | 170 (160–173) → 186 (168–194) | 277 (277–295) → 284 (274–311) | 566 (548–576) → 564 (561–591) |               17 (14–30) |
| locations     | 148 (142–179) → 153 (143–161) | 142 (113–153) → 150 (142–170) | 535 (528–542) → 543 (517–543) |               35 (33–43) |
| sites         | 136 (128–146) → 136 (130–142) | 135 (129–155) → 152 (136–152) | 510 (505–514) → 509 (503–519) |               36 (31–42) |
| history       | 161 (156–166) → 160 (146–160) | 142 (129–144) → 159 (151–173) | 519 (503–534) → 540 (539–548) |               32 (31–33) |
| settings      |    100 (89–101) → 93 (89–101) |       84 (81–93) → 86 (85–92) | 495 (493–506) → 517 (503–524) |               30 (27–38) |
| category-form |  incomparable → 347 (339–360) |  incomparable → 333 (329–359) | 583 (578–590) → 586 (562–616) |               16 (16–18) |

Room requests: 565 (563–611) → 414 (411–447) ms. Auth/member/location calls changed 4/4/2 → 1/1/1 in all samples. Caller-authorized search and populated metadata enrichment remain.

## populated fixture

| Route         |               Unvisited click |                  Repeat click |                     Deep link | Final unvisited feedback |
| ------------- | ----------------------------: | ----------------------------: | ----------------------------: | -----------------------: |
| overview      | 183 (171–209) → 160 (158–201) | 158 (146–164) → 160 (159–180) | 545 (537–550) → 542 (520–561) |               31 (29–39) |
| inventory     | 223 (216–229) → 225 (214–260) | 200 (192–208) → 203 (181–216) | 577 (574–634) → 601 (597–639) |               32 (30–35) |
| scan          |    96 (95–118) → 121 (98–121) |       89 (80–91) → 86 (85–92) | 509 (492–523) → 503 (500–509) |               43 (36–43) |
| labels        | 400 (269–400) → 404 (397–404) | 354 (353–376) → 349 (239–368) | 650 (639–742) → 722 (716–770) |               44 (37–44) |
| spaces        | 173 (172–200) → 175 (172–181) | 294 (281–295) → 298 (285–310) | 554 (546–555) → 559 (555–569) |               22 (18–24) |
| locations     | 142 (139–153) → 161 (141–185) | 155 (150–158) → 158 (141–163) | 514 (510–555) → 516 (514–533) |               36 (33–39) |
| sites         | 142 (138–145) → 160 (128–185) | 154 (129–175) → 146 (141–148) | 500 (490–509) → 501 (497–539) |               34 (30–39) |
| history       | 195 (187–195) → 217 (194–230) | 162 (158–169) → 168 (151–169) | 539 (532–574) → 556 (540–576) |               37 (32–38) |
| settings      |    88 (87–100) → 102 (97–119) |       87 (81–90) → 80 (79–81) | 499 (494–508) → 497 (493–498) |               40 (35–40) |
| category-form |  incomparable → 320 (304–330) |  incomparable → 320 (314–333) | 580 (571–586) → 589 (578–601) |               16 (16–18) |

Room requests: 572 (565–585) → 430 (411–460) ms. Auth/member/location calls changed 4/4/2 → 1/1/1 in all samples. Caller-authorized search and populated metadata enrichment remain.

## Populated direct-link network evidence

Resource transfer totals include framework resources and bounded prefetch, not just route script bodies.

| Route         | Document TTFB ms, baseline → final | Resource bytes median, baseline → final | Final Auth/member/total server fetches, each sample |
| ------------- | ---------------------------------: | --------------------------------------: | --------------------------------------------------- |
| overview      |            60 (59–63) → 62 (50–70) |                       380,769 → 382,634 | 1/1/3, 1/1/3, 1/1/3                                 |
| inventory     |         85 (76–127) → 101 (92–127) |                       393,126 → 399,440 | 1/1/8, 1/1/8, 1/1/8                                 |
| scan          |            52 (51–52) → 53 (53–67) |                       312,693 → 310,164 | 1/1/2, 1/1/2, 1/1/2                                 |
| labels        |            69 (59–73) → 59 (59–80) |                       362,561 → 334,091 | 2/2/8, 2/2/8, 2/2/8                                 |
| spaces        |            58 (58–62) → 69 (62–76) |                       593,801 → 594,314 | 1/1/3, 1/1/3, 1/1/3                                 |
| locations     |            57 (56–83) → 57 (56–72) |                       311,867 → 311,658 | 1/1/3, 1/1/3, 1/1/3                                 |
| sites         |            56 (42–56) → 55 (55–72) |                       380,252 → 380,610 | 1/1/3, 1/1/3, 1/1/3                                 |
| history       |            62 (61–78) → 65 (64–86) |                       383,518 → 388,676 | 1/1/5, 1/1/5, 1/1/5                                 |
| settings      |            51 (51–53) → 52 (51–52) |                       310,067 → 309,857 | 1/1/2, 1/1/2, 1/1/2                                 |
| category-form |            68 (68–74) → 69 (68–83) |                       467,032 → 473,873 | 1/1/4, 1/1/4, 1/1/4                                 |

## Findings and limits

The rejected broad loading fallback at `51ed5b4` delayed usable content across several routes. Populated final unvisited medians are Overview 160, Inventory 225, Spaces 175, Sites 160 and History 217 ms, versus 406/410/533/393/427 at that checkpoint. Sidebar feedback remains immediate (populated medians 22–44 ms; category 16 ms) with normal motion.

Labels makes one initial search RPC in all 18 final visits. Restored-filter repeats previously made two; final repeats have two Auth/member pairs including the RSC render, versus three previously. Populated repeat median changed from 457 ms at `5c6e0b4` to 349 ms, near frozen baseline 354 ms. Unvisited encoded Labels script bodies remain 19,531 bytes versus baseline 39,291 in every sample; QR/barcode work is deferred until needed.

Results are mixed, not a blanket route-speed improvement. Populated Labels direct-link median is 722 ms versus baseline 650; ranges overlap (716–770 versus 639–742). Target document TTFB is 59–80 ms; search RPC spans are 38–42 ms versus baseline 11–18 ms. These observations do not establish application causality. Populated Scan/Locations/Sites/History/Settings first medians increased 25/19/18/22/14 ms, and Inventory direct links increased 24 ms. Most relevant ranges overlap; three samples cannot establish tails or durable causes. These differences remain visible.

Spaces still requests about 218 KB encoded route scripts. No long task was observed in final unvisited Spaces samples, versus one per sample at the rejected fallback checkpoint; short windows do not certify full hydration/renderer completion. Category switching retains failure-preserving target reads and fresh identity checks; its click medians around 320–347 ms have no working baseline-selector comparison.

The local baseline did not reproduce the owner's multi-second hosted delay. Hosted route/device/backend timing and representative traffic remain separate evidence. These results do not claim a Speed Insights score or cold-function improvement. Physical printing/camera behavior and complete renderer readiness remain hardware/visual acceptance limits. Raw JSON and redacted fetch traces retain request timings, bytes, Auth/data counts and long tasks. Server spans overlap and must not be summed into navigation duration.

## Runtime release

After capture the harness closed its browser and Next process. Canonical `npm run db:stop` succeeded for project `it-inventory`; no project container or port-3000 listener remained. Windows free-RAM observations were 6.84 GiB before stop and 3.58 GiB afterward amid other host workloads, so this was not a measured RAM increase. After separate root authorization and a fresh zero-container check, Rancher was gracefully shut down with supported `rdctl shutdown --wait` to restore its initial stopped state. The command exited successfully and one fresh available-RAM reading was 8.68 GiB; this does not certify an unrelated runner's health or satisfy its separate memory guard. No WSL termination or unrelated app cleanup was performed.
