import type { JWTPayload } from 'jose'

import { createTokenModule } from './signed-token'

export interface ReviewTokenPayload extends JWTPayload {
  bookingId: string
  guestName: string
  guestEmail: string
}

const reviewToken = createTokenModule<ReviewTokenPayload>('review-submit', '14d')

/**
 * Sign a JWT token for review submission with 14-day expiration
 * Used to grant temporary review access to guests after checkout
 */
export const signReviewToken = reviewToken.sign

/**
 * Verify a JWT token for review submission
 * Returns the payload if valid, throws if invalid or expired
 */
export const verifyReviewToken = reviewToken.verify
