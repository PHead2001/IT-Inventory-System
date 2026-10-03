# Matched local navigation at 5c6e0b4

These captures measured clean committed source `5c6e0b48cfd5d10eed6110d4ac821be483897913`, after canonical disposable resets, with three samples per route/mode/dataset and ordinary motion enabled. Next BUILD_ID `HODdNq1W8sYRDcrYBnkTw` and backend-input digest are recorded in both raw files. The empty capture used a fresh backend-bound production build; populated capture reused that guarded build. Counts were observed after fixture creation (empty 0/0/0, populated 30 quantity definitions/30 assets/8 sites). Server and backend were warm; cold functions were not established.

Values are median (minimum–maximum) in milliseconds, baseline → candidate. Usable conventional content, feedback, bytes and server fetch spans use the definitions in README. A click record's documentTtfbMs belongs to its previously loaded document; use classified target request timing for route responses. Direct links record the target document TTFB separately; feedbackMs remains unavailable. Baseline category clicks used a route link because its selector could not switch, so those values are not comparable.

## empty fixture

| Route         |               Unvisited click |                  Repeat click |                     Deep link | Unvisited feedback |
| ------------- | ----------------------------: | ----------------------------: | ----------------------------: | -----------------: |
| overview      | 151 (138–209) → 153 (150–183) | 157 (148–174) → 171 (162–171) | 525 (514–573) → 527 (527–571) |         39 (30–41) |
| inventory     | 198 (183–206) → 195 (176–201) | 185 (167–194) → 169 (131–191) | 582 (538–612) → 568 (546–576) |         33 (32–39) |
| scan          |  102 (100–110) → 100 (94–102) |      83 (77–84) → 84 (83–101) | 519 (506–531) → 501 (499–511) |         38 (32–41) |
| labels        | 373 (278–386) → 283 (277–372) | 369 (351–371) → 359 (336–362) | 712 (638–723) → 642 (626–709) |         33 (28–37) |
| spaces        | 170 (160–173) → 177 (155–178) | 277 (277–295) → 299 (283–307) | 566 (548–576) → 552 (551–584) |         13 (10–17) |
| locations     | 148 (142–179) → 144 (139–178) | 142 (113–153) → 156 (130–161) | 535 (528–542) → 516 (505–517) |         34 (28–37) |
| sites         | 136 (128–146) → 137 (124–144) | 135 (129–155) → 147 (139–153) | 510 (505–514) → 518 (510–524) |         31 (27–40) |
| history       | 161 (156–166) → 155 (148–157) | 142 (129–144) → 151 (145–172) | 519 (503–534) → 522 (516–550) |         28 (25–36) |
| settings      |     100 (89–101) → 83 (76–93) |       84 (81–93) → 88 (78–90) | 495 (493–506) → 491 (486–525) |         31 (29–37) |
| category-form |  incomparable → 320 (296–328) |  incomparable → 305 (285–321) | 583 (578–590) → 587 (574–600) |         16 (15–17) |

Room-content request: 565 (563–611) → 424 (417–439) ms. Auth/member/location reads changed 4/4/2 → 1/1/1 in all samples; search and populated metadata enrichment remain caller-scoped.

## populated fixture

| Route         |               Unvisited click |                  Repeat click |                     Deep link | Unvisited feedback |
| ------------- | ----------------------------: | ----------------------------: | ----------------------------: | -----------------: |
| overview      | 183 (171–209) → 160 (154–190) | 158 (146–164) → 184 (160–198) | 545 (537–550) → 549 (534–553) |         27 (26–42) |
| inventory     | 223 (216–229) → 232 (218–240) | 200 (192–208) → 208 (204–228) | 577 (574–634) → 586 (580–633) |         37 (29–39) |
| scan          |      96 (95–118) → 92 (88–93) |       89 (80–91) → 88 (87–90) | 509 (492–523) → 503 (493–511) |         29 (27–30) |
| labels        | 400 (269–400) → 403 (303–404) | 354 (353–376) → 457 (355–471) | 650 (639–742) → 725 (599–751) |         42 (42–44) |
| spaces        | 173 (172–200) → 169 (160–190) | 294 (281–295) → 314 (290–319) | 554 (546–555) → 555 (541–569) |         23 (20–25) |
| locations     | 142 (139–153) → 158 (152–198) | 155 (150–158) → 150 (146–154) | 514 (510–555) → 521 (517–525) |         40 (31–42) |
| sites         | 142 (138–145) → 152 (131–175) | 154 (129–175) → 142 (138–158) | 500 (490–509) → 506 (495–513) |         30 (30–39) |
| history       | 195 (187–195) → 193 (183–240) | 162 (158–169) → 171 (144–194) | 539 (532–574) → 557 (552–607) |         39 (31–46) |
| settings      |      88 (87–100) → 91 (88–99) |       87 (81–90) → 88 (86–89) | 499 (494–508) → 506 (501–528) |         27 (27–36) |
| category-form |  incomparable → 336 (330–359) |  incomparable → 337 (328–339) | 580 (571–586) → 573 (573–575) |         16 (15–17) |

Room-content request: 572 (565–585) → 429 (428–461) ms. Auth/member/location reads changed 4/4/2 → 1/1/1 in all samples; search and populated metadata enrichment remain caller-scoped.

The broad-fallback regression at 51ed5b4 is removed: populated unvisited Overview 406→160, Inventory 410→232, Spaces 533→169, Sites 393→152, History 427→193 ms. Immediate Link feedback remains. No unvisited Spaces long task was observed in these final matrices, versus one per sample at 51ed5b4; these short windows do not certify complete WebGL hydration.

Labels encoded unvisited script bodies fell 39,291→19,531 bytes in all samples, but populated repeat usable median regressed 354→457 ms and deep-link 650→725 ms. The deep-link ranges overlap, and causality is not established. Both versions issue two search RPCs after restored-filter hydration on repeat visits; a narrow hydration/scope correction is being tested after these captures. Its effect requires a later committed capture. Populated Inventory/Locations/Sites first medians also increased 9/16/10 ms; small samples and overlapping ranges do not establish a durable cause. The heavier Spaces route still requests about 218 KB encoded scripts.

The local baseline did not reproduce multi-second hosted navigation. Hosted comparison, final revised-source timing, slow/failing/rapid navigation E2E, full normal-visual browser acceptance and physical printing/camera certification remain separate requirements.
