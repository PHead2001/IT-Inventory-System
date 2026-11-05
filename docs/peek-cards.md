# Private record peeks

W19 adds optional current-state cards to inventory, history, location, label and
scan record links. Fine-pointer hover waits 400 ms; deliberate keyboard focus
opens without moving focus. Escape closes the card, and touch keeps ordinary
navigation. Cards use the shared spring presentation and respect Reduced motion.
The record link and its existing navigation remain available during every read.

`GET /api/peek` authenticates membership once before validating the strict asset,
quantity or location target. It reuses that caller's RLS-bound client and returns
the server actor/backend with `private, no-store` headers. Reads have an original
five-second deadline and bounded holdings, totals, locations and file summaries.
Inventory parent versions are strings; a changed version retries the whole read
once inside that deadline. This fences versioned inventory changes and does not
claim an atomic snapshot of independently changing photos or location names.

The provider retains its workspace children and replaces only admission owners
when actor, backend, verification or route/query changes. Strict presentation and
the current route command boundary veto stale, hidden, inert and retired owners.
Terminal access denial withdraws a current card; a retired response cannot deny a
successor. This decorative boundary never replaces server authorization or clears
business drafts, pending mutations, receipts or retry identities.

The memory-only cache retains at most 50 successful summaries for 30 seconds and
revalidates every open. Expiry removes displayed private data. API bodies and
authenticated Storage downloads share two physical request slots across provider
replacement; cancellation retains its slot until the actual work settles. Photos
use the existing private `inventory-files` download/RLS path, never a public or
signed URL. Object URLs are revoked on close, replacement, expiry, withdrawal and
unmount. Missing photos are optional; actual authorization denial propagates.

Confirmed structured action success and acknowledged file publish/removal clear
peeks only for their captured current owner. Existing action denial tickets and
the exact business result/rejection are preserved.

## Integration and verification limits

The newer Overview and grouped custom-view modules from the donor are absent in
this checkout. Their W19 link integration and five donor consumer cases remain
pending with those host features; no replacement host is introduced here.
Focused mocked tests cover the present consumers and private lifecycle. They do
not certify live RLS, concurrent database reads, Storage authorization, native
keyboard/assistive technology, both-theme desktop/390 px appearance or browser
hover transfer. Those boundaries require the canonical integrated gates and
populated visual acceptance before W19 can be accepted in full.
