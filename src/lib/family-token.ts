import type { JWTPayload } from 'jose'

import { createTokenModule } from './signed-token'

export interface FamilyTokenPayload extends JWTPayload {
  email: string
  name: string
}

const familyToken = createTokenModule<FamilyTokenPayload>('family-booking', '365d')

/**
 * Sign a JWT token for family booking access. Sent via email to family
 * members for payment-free booking. Effectively non-expiring (365d) —
 * revocation is DB-gated: the booking route checks the live isFamilyMember
 * flag, so clearing it invalidates every outstanding link immediately.
 * @see docs/adr/0003-family-revocation-db-flag.md
 */
export const signFamilyToken = familyToken.sign

/**
 * Verify a family booking JWT token.
 * Returns the payload if valid, throws if invalid or expired.
 */
export const verifyFamilyToken = familyToken.verify
