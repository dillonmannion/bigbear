import type { PricingConfig } from '@prisma/client'
import { prisma } from '@/lib/prisma'

// --- Result types ---

interface BookingPolicySuccess {
  ok: true
  pricing: PricingConfig
  nights: number
}

interface BookingPolicyFailure {
  ok: false
  status: number
  error: string
}

export type BookingPolicyResult = BookingPolicySuccess | BookingPolicyFailure

// --- Validation ---

/**
 * Shared booking-policy validation used by both the alt-payment and family
 * booking routes.  Fetches PricingConfig from the DB and enforces:
 *
 * 1. Check-in must not be in the past
 * 2. Check-out must be after check-in
 * 3. Stay length within minNights / maxNights
 * 4. Guest count within maxGuests (when provided)
 *
 * Returns the PricingConfig and computed nights on success so callers can
 * derive pricing without a second DB lookup.
 */
export async function validateBookingPolicy(
  checkIn: Date,
  checkOut: Date,
  numberOfGuests?: number
): Promise<BookingPolicyResult> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (checkIn < today) {
    return { ok: false, status: 400, error: 'Check-in date cannot be in the past' }
  }

  if (checkOut <= checkIn) {
    return { ok: false, status: 400, error: 'Check-out date must be after check-in date' }
  }

  const pricing = await prisma.pricingConfig.findFirst()
  if (!pricing) {
    return { ok: false, status: 500, error: 'Pricing not configured' }
  }

  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24))

  if (nights < pricing.minNights) {
    return { ok: false, status: 400, error: `Minimum stay is ${pricing.minNights} nights` }
  }

  if (nights > pricing.maxNights) {
    return { ok: false, status: 400, error: `Maximum stay is ${pricing.maxNights} nights` }
  }

  if (numberOfGuests !== undefined && numberOfGuests > pricing.maxGuests) {
    return {
      ok: false,
      status: 400,
      error: `Maximum ${pricing.maxGuests} guests allowed`,
    }
  }

  return { ok: true, pricing, nights }
}
