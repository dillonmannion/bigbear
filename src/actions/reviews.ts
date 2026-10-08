'use server'

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { secureAction } from '@/lib/auth/secure-action'
import { verifyReviewToken } from '@/lib/review-token'
import { signReviewToken } from '@/lib/review-token'
import { invalidateReviews } from '@/lib/cache/invalidation'
import { deleteBlob } from '@/lib/blob'
import { getResend } from '@/lib/resend'
import { escapeHtml } from '@/lib/security'
import { env } from '@/lib/env'

// ---------------------------------------------------------------------------
// Guest: submit a review (unauthenticated, token-gated)
// ---------------------------------------------------------------------------

const submitReviewSchema = z.object({
  token: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  body: z.string().min(1).max(5000),
  photoUrls: z.array(z.url()).max(3).default([]),
})

export const submitReview = async (input: z.infer<typeof submitReviewSchema>) => {
  const validated = submitReviewSchema.safeParse(input)
  if (!validated.success) {
    return { success: false, error: 'Invalid input' }
  }

  const { token, rating, body, photoUrls } = validated.data

  let payload
  try {
    payload = await verifyReviewToken(token)
  } catch {
    return { success: false, error: 'Invalid or expired review link' }
  }

  // Check if review already exists for this booking
  const existing = await prisma.review.findUnique({
    where: { bookingId: payload.bookingId },
  })

  if (existing) {
    // Update existing review
    await prisma.review.update({
      where: { bookingId: payload.bookingId },
      data: { rating, body, photoUrls },
    })
  } else {
    // Create new review
    await prisma.review.create({
      data: {
        bookingId: payload.bookingId,
        guestName: payload.guestName,
        rating,
        body,
        photoUrls,
      },
    })
  }

  invalidateReviews()
  return { success: true }
}

// ---------------------------------------------------------------------------
// Owner: toggle review published status
// ---------------------------------------------------------------------------

export const toggleReviewPublished = secureAction(
  {
    roles: 'OWNER',
    schema: z.object({ reviewId: z.string().min(1) }),
  },
  async ({ data }) => {
    const review = await prisma.review.findUnique({
      where: { id: data.reviewId },
    })

    if (!review) {
      return { success: false, error: 'Review not found' }
    }

    await prisma.review.update({
      where: { id: data.reviewId },
      data: { isPublished: !review.isPublished },
    })

    invalidateReviews()
    return { success: true }
  }
)

// ---------------------------------------------------------------------------
// Owner: send review invite email
// ---------------------------------------------------------------------------

export const sendReviewInvite = secureAction(
  {
    roles: 'OWNER',
    schema: z.object({ bookingId: z.string().min(1) }),
  },
  async ({ data }) => {
    const booking = await prisma.booking.findUnique({
      where: { id: data.bookingId },
      select: {
        id: true,
        guestName: true,
        guestEmail: true,
        checkIn: true,
        checkOut: true,
        status: true,
      },
    })

    if (!booking) {
      return { success: false, error: 'Booking not found' }
    }

    // Only real, finished stays may be invited — a PENDING hold or cancelled
    // booking never produced a stay to review.
    if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
      return {
        success: false,
        error: 'Review invites are only available for confirmed or completed stays',
      }
    }
    if (booking.checkOut > new Date()) {
      return { success: false, error: 'Review invites can only be sent after checkout' }
    }

    const token = await signReviewToken({
      bookingId: booking.id,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
    })

    const appUrl = env().NEXT_PUBLIC_APP_URL ?? ''
    const reviewUrl = `${appUrl}/review?token=${token}`

    const checkInDate = booking.checkIn.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    const checkOutDate = booking.checkOut.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

    const safeGuestName = escapeHtml(booking.guestName)

    void getResend()
      .emails.send({
        from: env().RESEND_FROM_EMAIL,
        to: booking.guestEmail,
        subject: 'How was your stay? Leave a review - Grizzly Getaway',
        html: `
        <h2>We hope you loved your stay!</h2>
        <p>Hello ${safeGuestName},</p>
        <p>Thank you for staying with us at Grizzly Getaway (${checkInDate} - ${checkOutDate}).
        We'd love to hear about your experience!</p>
        <p><a href="${reviewUrl}" style="display:inline-block; padding:12px 24px; background-color:#447a52; color:white; text-decoration:none; border-radius:8px; font-weight:bold;">
          Leave a Review
        </a></p>
        <p>You can also share up to 3 photos from your stay.</p>
        <p style="color:#666; font-size:12px;">This link expires in 14 days.</p>
        <p>Best regards,<br>Grizzly Getaway</p>
      `,
      })
      .catch(() => {
        // Non-blocking — review-invite email failure should not surface to the owner
      })

    return { success: true }
  }
)

// ---------------------------------------------------------------------------
// Owner: remove a single photo from a review
// ---------------------------------------------------------------------------

export const removeReviewPhoto = secureAction(
  {
    roles: 'OWNER',
    schema: z.object({
      reviewId: z.string().min(1),
      photoUrl: z.url(),
    }),
  },
  async ({ data }) => {
    const review = await prisma.review.findUnique({
      where: { id: data.reviewId },
    })

    if (!review) {
      return { success: false, error: 'Review not found' }
    }
    if (!review.photoUrls.includes(data.photoUrl)) {
      return { success: false, error: 'Photo not found on this review' }
    }

    // Owner moderation is limited to photos and publish state — the review's
    // body and rating belong to the guest and are never mutated here.
    await prisma.review.update({
      where: { id: data.reviewId },
      data: { photoUrls: review.photoUrls.filter((url) => url !== data.photoUrl) },
    })

    deleteBlob(data.photoUrl).catch(() => {
      // Blob cleanup failure should not block the photo removal
    })

    invalidateReviews()
    return { success: true }
  }
)
