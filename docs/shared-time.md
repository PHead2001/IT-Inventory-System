# Shared operational time and exports

Operational timestamps use one display policy across inventory history, custody history, site history, file cards/activity, and review expiry. The protected server layout supplies one `OperationalTimeProvider`; read components use `OperationalTimestamp` from `src/components/operational-time.tsx`. The pure formatter and zone validation live in `src/lib/operational-time.ts`.

Server rendering and the first hydration render explicitly use UTC. After hydration, the provider resolves the browser's IANA time zone once per application mount and shares it with every timestamp and export link. There is no stored application time-zone preference. The datetime field's existing display-zone/recovery choices belong to data entry and do not determine the application display zone. An unavailable or unsupported browser zone uses an explicitly labelled UTC fallback. Changing the operating-system zone during an open application mount requires a reload to resolve it again.

Displays use English day, abbreviated month, year, 24-hour hours/minutes/seconds, the offset at that instant, and the IANA zone. For example, `1 Nov 2026, 01:30:00 UTC-04:00 (America/New_York)` and `1 Nov 2026, 01:30:00 UTC-05:00 (America/New_York)` distinguish the repeated daylight-saving hour. UTC uses the label `UTC`; historical offsets retain seconds when IANA rules require them. Missing, invalid, date-only, and offset-less timestamp inputs display `Time unavailable` rather than an epoch or the current time.

The original explicit-offset ISO timestamp, including source subseconds, stays unchanged in each rendered `<time datetime>` and in persistence, event snapshots, RPCs, and CSV source columns. The readable display intentionally shows seconds. Typed custom `datetime` values use the same readable display, retaining the raw timestamp in value provenance or the history snapshot's raw JSON. Date-only custom values and ISO-shaped text stay literal. Datetime input parsing, defaults, filters, validation, and recovery semantics remain unchanged.

Relative timestamps share one browser clock in `src/lib/relative-clock.ts`. Every newly mounted subscriber refreshes the shared instant immediately, including when other timestamps are already mounted; visible subscribers then share one 30-second timer. Hidden tabs pause the timer, visibility resume refreshes once and restarts it, and the final unsubscribe stops it. Server and initial hydration use exact time until subscription. Elapsed values from two minutes ahead through less than one minute ago display `Just now`, allowing bounded server/browser clock skew. Instants more than two minutes ahead remain explicitly future. Focus/click on a relative timestamp discloses the readable exact time and original recorded instant; display-clock tolerance never edits persistence.

## CSV contract

Application export links use `ExportLink` to send resolved zones as `displayTimeZone` in `/api/exports/inventory` while preserving filter values, custom-field opt-in, and fragments. A resolved UTC zone is sent as `UTC`. When browser-zone resolution falls back, the link removes or omits any prior `displayTimeZone` override so the endpoint preserves explicit UTC fallback provenance in the CSV labels. The server accepts only a bounded zone string (at most 128 characters) supported by `Intl.DateTimeFormat`, canonicalizes its IANA name, and uses explicit UTC fallback for missing or invalid direct requests. This parameter changes presentation only; it is absent from the caller-scoped database snapshot RPC.

Both inventory and low-stock exports keep every existing column in its existing order, including optional `Custom Fields JSON`, custody/quantity fields, and `Item Code (SKU)`. They append these two columns after SKU:

| Column                     | Value                                                                      |
| -------------------------- | -------------------------------------------------------------------------- |
| Display timezone           | Validated IANA zone, or `UTC (UTC fallback)` for a missing/invalid request |
| Exported at (display zone) | The database snapshot's `exported_at` instant formatted in that zone       |

`Exported At (UTC)` retains the original database value. The download filename still derives from that same snapshot timestamp; neither metadata column uses the client clock or changes the source snapshot. Empty exports retain headers and the timestamped filename without adding artificial inventory rows.

The appended metadata shares the existing exact 3 MiB UTF-8 CSV budget, including BOM, quoting, formula neutralization and CRLF bytes, and the existing 10-second request deadline. It receives no additional byte or time allowance. Authentication, active membership, private/no-store responses, snapshot limits, custom-field opt-in and spreadsheet formula protection remain the existing export contracts.
