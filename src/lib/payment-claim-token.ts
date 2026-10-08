import type { JWTPayload } from 'jose'

import { createTokenModule } from './signed-token'

export interface PaymentClaimTokenPayload extends JWTPayload {
  bookingId: string
  guestEmail: string
}

const paymentClaimToken = createTokenModule<PaymentClaimTokenPayload>('payment-claim', '25h')

/**
 * Sign a JWT token that lets a guest mark their Hold as "payment sent".
 * Lifetime is 25h -- slightly longer than the 24h Hold so the emailed link
 * never dies while the Hold is still live.
 */
export const signPaymentClaimToken = paymentClaimToken.sign

/**
 * Verify a payment-claim JWT token.
 * Returns the payload if valid, throws if invalid or expired.
 */
export const verifyPaymentClaimToken = paymentClaimToken.verify
