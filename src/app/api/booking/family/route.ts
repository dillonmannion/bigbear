import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyFamilyToken } from '@/lib/family-token'
import {
  cancelExpiredOverlappingHolds,
  isDateOverlapError,
  isRangeAvailable,
} from '@/lib/booking/availability'
import { validateBookingPolicy } from '@/lib/booking/validation'
import { sendFamilyBookingCreated } from '@/lib/notifications-booking'
import { invalidateBookings, invalidateCalendar } from '@/lib/cache/invalidation'

const schema = z.object({
  token: z.string().min(1),
  checkIn: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid check-in date'),
  checkOut: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid check-out date'),
  guestName: z.string().min(1),
  guestEmail: z.email(),
  guestPhone: z.string().optional(),
  numberOfGuests: z.number().int().min(1).default(1),
})

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const { token, checkIn, checkOut, guestName, guestEmail, guestPhone, numberOfGuests } =
      parsed.data

    // Verify family token
    let payload
    try {
      payload = await verifyFamilyToken(token)
    } catch {
      return NextResponse.json({ error: 'Invalid or expired family link' }, { status: 401 })
    }

    // Verify email matches token
    if (payload.email !== guestEmail) {
      return NextResponse.json({ error: 'Email does not match invitation' }, { status: 403 })
    }

    // The live DB flag is the trust signal — tokens are long-lived and the owner
    // revokes access by clearing isFamilyMember, which must invalidate old links.
    const user = await prisma.user.findUnique({ where: { email: guestEmail } })
    if (!user?.isFamilyMember) {
      return NextResponse.json(
        { error: 'Family access has been removed. Contact the owner for a new invitation.' },
        { status: 403 }
      )
    }

    const checkInDate = new Date(checkIn)
    const checkOutDate = new Date(checkOut)

    const policy = await validateBookingPolicy(checkInDate, checkOutDate, numberOfGuests)
    if (!policy.ok) {
      return NextResponse.json({ error: policy.error }, { status: policy.status })
    }

    // Create booking — family bookings are auto-confirmed with $0 amounts.
    // Sweep + availability + insert run atomically; the exclusion constraint
    // is the backstop for races.
    let booking
    try {
      booking = await prisma.$transaction(async (tx) => {
        await cancelExpiredOverlappingHolds(tx, checkInDate, checkOutDate)

        const available = await isRangeAvailable(tx, checkInDate, checkOutDate)
        if (!available) throw new Error('DATES_UNAVAILABLE')

        return tx.booking.create({
          data: {
            guestId: user.id,
            checkIn: checkInDate,
            checkOut: checkOutDate,
            guestName,
            guestEmail,
            guestPhone: guestPhone ?? null,
            numberOfGuests,
            basePrice: 0,
            addonsTotal: 0,
            depositAmount: 0,
            totalAmount: 0,
            status: 'CONFIRMED',
            notes: 'Family booking — no payment required',
          },
        })
      })
    } catch (err) {
      if (
        (err instanceof Error && err.message === 'DATES_UNAVAILABLE') ||
        isDateOverlapError(err)
      ) {
        return NextResponse.json(
          { error: 'Selected dates are no longer available' },
          { status: 409 }
        )
      }
      throw err
    }

    sendFamilyBookingCreated(booking).catch(() => {
      // Notification failure should not affect booking creation
    })

    invalidateBookings()
    invalidateCalendar()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Family booking error:', error)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
