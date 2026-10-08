---
status: accepted
---

# Hold is created at payment-method selection, not before the modal

`docs/plans/booking-fix-plan.md` Fix 3 specified a `POST /api/booking/reserve`
step that creates the PENDING booking with server-computed pricing _before_ the
payment-method modal opens. That plan predates the off-platform-payments design
in [ADR 0001](./0001-alt-payments-and-holds.md) and is **superseded by it**:
the two documents described different moments for the same reservation event,
and ADR 0001's is the one that shipped.

In the current flow, clicking "Reserve & Pay" on `/book` opens the
payment-method modal client-side with no network call. The PENDING Hold — with
server-computed pricing, availability revalidation, and the exclusion
constraint — is created by `POST /api/booking/alt-payment` only when the guest
picks a payment tile.

## Why this is acceptable

- Everything Fix 3 wanted from the server (price lock, availability check,
  owner-dashboard record, ignoring client-supplied totals) happens in the
  alt-payment route; Fix 3 would only move it a few seconds earlier.
- The window between modal-open and tile-click holds nothing: no email is sent
  and no payment instructions are shown until the Hold row exists, so a guest
  cannot be told to send money for dates that were never server-validated.
- A pre-modal reserve would create Holds for guests who open the modal and
  walk away, consuming the date range for up to 24h (or until the hourly
  sweep) with no payment intent at all.

## Consequences

- The totals shown _inside_ the modal before a tile is clicked are
  client-computed and advisory; the authoritative amount is returned by the
  alt-payment route and displayed on the confirmation/instructions step.
- If the dates were taken between page load and tile click, the guest learns
  at tile click (409 from the route), not at modal open. Acceptable at
  single-cabin volume.
- Fix 3 of `booking-fix-plan.md` should not be implemented; treat this ADR as
  its closure.
