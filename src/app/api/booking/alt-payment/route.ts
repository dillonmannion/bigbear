import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit'
import {
  cancelExpiredOverlappingHolds,
  isDateOverlapError,
  isRangeAvailable,
} from '@/lib/booking/availability'
import { validateBookingPolicy } from '@/lib/booking/validation'
import { HOLD_DURATION_MS, PAYMENT_METHOD_INFO } from '@/lib/payment-methods'
import { sendHoldCreatedGuest, sendHoldCreatedOwner } from '@/lib/notifications-booking'
import { invalidateBookings, invalidateCalendar } from '@/lib/cache/invalidation'

const AddonSchema = z.object({
  id: z.string().min(1, 'Addon ID is required'),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
})

const AltPaymentRequestSchema = z
  .object({
    checkIn: z.string().refine((date) => !isNaN(Date.parse(date)), 'Invalid check-in date format'),
    checkOut: z
      .string()
      .refine((date) => !isNaN(Date.parse(date)), 'Invalid check-out date format'),
    guestName: z.string().min(1, 'Guest name is required').max(100, 'Guest name too long'),
    guestEmail: z.email('Invalid email address'),
    guestPhone: z
      .string()
      .regex(/^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/, 'Invalid phone number format')
      .optional()
      .or(z.literal('')),
    addons: z.array(AddonSchema).default([]),
    paymentMethod: z.enum(['VENMO', 'CASHAPP', 'PAYPAL', 'ZELLE', 'CONTACT_OWNER']),
    message: z.string().max(2000, 'Message too long').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.paymentMethod === 'CONTACT_OWNER' && !data.message?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['message'],
        message: 'A message is required when contacting the owner',
      })
    }
  })

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  const clientId = getClientIdentifier(request)
  const rateLimitResult = await checkRateLimit(`alt-payment:${clientId}`, RATE_LIMITS.checkout)

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(RATE_LIMITS.checkout.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimitResult.resetTime),
        },
      }
    )
  }

  try {
    const rawBody: unknown = await request.json()

    const parseResult = AltPaymentRequestSchema.safeParse(rawBody)
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }))
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const { checkIn, checkOut, guestName, guestEmail, guestPhone, addons, paymentMethod, message } =
      parseResult.data

    const checkInDate = new Date(checkIn)
    const checkOutDate = new Date(checkOut)

    const policy = await validateBookingPolicy(checkInDate, checkOutDate)
    if (!policy.ok) {
      return NextResponse.json({ error: policy.error }, { status: policy.status })
    }

    const { pricing, nights } = policy

    // Server-side pricing — never trust client amounts. Addons priced from
    // the DB; unknown addon ids are ignored. Deposit is informational and is
    // NOT folded into totalAmount (matches the Stripe webhook convention).
    const basePrice = Number(pricing.baseNightlyRate) * nights + Number(pricing.cleaningFee)

    let addonsTotal = 0
    const addonItems = await prisma.addon.findMany({
      where: { id: { in: addons.map((a) => a.id) } },
    })
    for (const addon of addons) {
      const addonData = addonItems.find((a) => a.id === addon.id)
      if (addonData) {
        addonsTotal += Number(addonData.price) * addon.quantity
      }
    }

    const totalAmount = basePrice + addonsTotal
    const depositAmount = totalAmount * (pricing.depositPercentage / 100)

    // Sweep + availability + insert run atomically; the exclusion constraint
    // is the backstop for races.
    let booking
    try {
      booking = await prisma.$transaction(async (tx) => {
        await cancelExpiredOverlappingHolds(tx, checkInDate, checkOutDate)

        const available = await isRangeAvailable(tx, checkInDate, checkOutDate)
        if (!available) throw new Error('DATES_UNAVAILABLE')

        let user = await tx.user.findUnique({ where: { email: guestEmail } })
        user ??= await tx.user.create({
          data: {
            email: guestEmail,
            name: guestName,
            phone: guestPhone !== undefined && guestPhone !== '' ? guestPhone : null,
            role: 'GUEST',
          },
        })

        const newBooking = await tx.booking.create({
          data: {
            guestId: user.id,
            checkIn: checkInDate,
            checkOut: checkOutDate,
            guestName,
            guestEmail,
            guestPhone: guestPhone !== undefined && guestPhone !== '' ? guestPhone : null,
            basePrice,
            addonsTotal,
            depositAmount,
            totalAmount,
            status: 'PENDING',
            paymentMethod,
            holdExpiresAt: new Date(Date.now() + HOLD_DURATION_MS),
          },
        })

        for (const addon of addons) {
          const addonData = addonItems.find((a) => a.id === addon.id)
          if (addonData) {
            await tx.bookingAddon.create({
              data: {
                bookingId: newBooking.id,
                addonId: addon.id,
                quantity: addon.quantity,
                price: addonData.price,
              },
            })
          }
        }

        if (paymentMethod === 'CONTACT_OWNER' && message) {
          await tx.message.create({
            data: {
              senderId: user.id,
              bookingId: newBooking.id,
              content: message,
            },
          })
        }

        return newBooking
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

    sendHoldCreatedGuest(booking).catch(() => {
      // Notification failure should not affect hold creation
    })
    sendHoldCreatedOwner(booking, message).catch(() => {
      // Notification failure should not affect hold creation
    })

    invalidateBookings()
    invalidateCalendar()

    return NextResponse.json({
      bookingId: booking.id,
      holdExpiresAt: booking.holdExpiresAt ? new Date(booking.holdExpiresAt).toISOString() : null,
      paymentMethod,
      methodInfo: PAYMENT_METHOD_INFO[paymentMethod],
      amountDue: totalAmount,
    })
  } catch (error) {
    console.error('Alt-payment booking error:', error)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
