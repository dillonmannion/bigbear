---
status: accepted
---

# Family invite revocation is gated by the live `isFamilyMember` flag

`docs/plans/booking-fix-plan.md` Fix 1 specified a persisted `FamilyInvite`
model with per-invite nonces so that removing a family member invalidates
already-sent links. That fix targeted a bug where the family booking route
_re-granted_ `isFamilyMember` from any signature-valid token. The re-grant
path no longer exists: `addFamilyMember` is the only writer of the flag, and
`src/app/api/booking/family/route.ts` requires a live `isFamilyMember = true`
on the User row and never sets it. The nonce model is **superseded** by this
simpler DB-flag gate.

A family token (`src/lib/family-token.ts`, HS256 JWT, 365-day expiry) is
therefore only a _claim of identity_ — it binds an email/name pair to a link.
Authorization is decided at booking time by the flag. `removeFamilyMember`
clears the flag, which immediately dead-ends every outstanding link for that
email; re-adding the member re-arms the same links.

## Consequences

- No `FamilyInvite` table, no nonce bookkeeping, no revoke-prior-invites step
  in `addFamilyMember`. One flag on User is the whole revocation surface.
- Old links for a _current_ family member keep working for 365 days. That is
  intended — links are convenience bookmarks, not capabilities.
- The public `/api/family/verify` endpoint answers "is this token
  signature-valid" only; a `valid: true` there does not imply booking
  authorization (the booking route re-checks the flag). UI built on verify
  must tolerate a later 403 from the booking route.
- If per-link revocation or single-use invites are ever needed (e.g. links
  shared beyond the family), resurrect Fix 1's nonce design; until then,
  `booking-fix-plan.md` Fix 1 is closed by this ADR.
