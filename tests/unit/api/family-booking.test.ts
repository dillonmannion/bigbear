import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockReset } from 'vitest-mock-extended'
import { prismaMock } from '../../__mocks__/prisma'
import { env as mockEnv } from '../../__mocks__/env'
import { createBookingFixture } from '../../fixtures/booking.factory'

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/env', () => ({
  env: mockEnv,
}))

const mockVerifyFamilyToken = vi.hoisted(() => vi.fn())

vi.mock('@/lib/family-token', () => ({
  verifyFamilyToken: mockVerifyFamilyToken,
}))

const mockSendFamilyBookingCreated = vi.hoisted(() => vi.fn())

vi.mock('@/lib/notifications-booking', () => ({
  sendFamilyBookingCreated: mockSendFamilyBookingCreated,
}))

const mockInvalidateBookings = vi.hoisted(() => vi.fn())
const mockInvalidateCalendar = vi.hoisted(() => vi.fn())

vi.mock('@/lib/cache/invalidation', () => ({
  invalidateBookings: mockInvalidateBookings,
  invalidateCalendar: mockInvalidateCalendar,
}))

const { POST } = await import('@/app/api/booking/family/route')

const futureDate = (daysFromNow: number) => {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString()
}

const pricingFixture = {
  id: 'pricing-1',
  baseNightlyRate: 250,
  cleaningFee: 100,
  depositPercentage: 20,
  minNights: 2,
  maxNights: 14,
  maxGuests: 8,
} as never

const validBody = () => ({
  token: 'family-token',
  checkIn: futureDate(7),
  checkOut: futureDate(10),
  guestName: 'Cousin Jane',
  guestEmail: 'jane@family.com',
  numberOfGuests: 2,
})

const createRequest = (body: unknown) =>
  new Request('http://localhost/api/booking/family', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as never

const familyUser = {
  id: 'user-family-1',
  email: 'jane@family.com',
  name: 'Cousin Jane',
  isFamilyMember: true,
} as never

const setupTransactionPassthrough = () => {
  prismaMock.$transaction.mockImplementation(async (fn) => {
    if (typeof fn === 'function') {
      return fn(prismaMock)
    }
    return Promise.all(fn)
  })
}

const setupAvailableRange = () => {
  prismaMock.booking.updateMany.mockResolvedValue({ count: 0 })
  prismaMock.booking.findFirst.mockResolvedValue(null)
  prismaMock.blockedDate.findFirst.mockResolvedValue(null)
}

describe('POST /api/booking/family', () => {
  beforeEach(() => {
    mockReset(prismaMock)
    vi.clearAllMocks()

    mockVerifyFamilyToken.mockResolvedValue({ email: 'jane@family.com', name: 'Cousin Jane' })
    mockSendFamilyBookingCreated.mockResolvedValue(undefined)
    setupTransactionPassthrough()
    setupAvailableRange()
    prismaMock.pricingConfig.findFirst.mockResolvedValue(pricingFixture)
    prismaMock.user.findUnique.mockResolvedValue(familyUser)
    prismaMock.booking.create.mockResolvedValue(
      createBookingFixture({
        guestEmail: 'jane@family.com',
        guestName: 'Cousin Jane',
        status: 'CONFIRMED',
      })
    )
  })

  it('returns 401 when the family token is invalid', async () => {
    mockVerifyFamilyToken.mockRejectedValue(new Error('bad token'))

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(401)
    expect(prismaMock.booking.create).not.toHaveBeenCalled()
  })

  it('returns 403 when the email does not match the token', async () => {
    mockVerifyFamilyToken.mockResolvedValue({ email: 'other@family.com', name: 'Other' })

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(403)
    expect(prismaMock.booking.create).not.toHaveBeenCalled()
  })

  it('returns 403 when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)

    const response = await POST(createRequest(validBody()))
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.error).toContain('Family access has been removed')
    expect(prismaMock.booking.create).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is no longer flagged as family', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...(familyUser as object),
      isFamilyMember: false,
    } as never)

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(403)
    expect(prismaMock.booking.create).not.toHaveBeenCalled()
  })

  it('never re-grants the family flag', async () => {
    await POST(createRequest(validBody()))

    expect(prismaMock.user.update).not.toHaveBeenCalled()
    expect(prismaMock.user.create).not.toHaveBeenCalled()
    expect(prismaMock.user.upsert).not.toHaveBeenCalled()
  })

  it('returns 409 when the dates are unavailable', async () => {
    prismaMock.booking.findFirst.mockResolvedValue({ id: 'booking-conflict' } as never)

    const response = await POST(createRequest(validBody()))
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error).toContain('no longer available')
    expect(prismaMock.booking.create).not.toHaveBeenCalled()
  })

  it('creates an auto-confirmed $0 booking inside a transaction', async () => {
    const response = await POST(createRequest(validBody()))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({ success: true })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        guestId: 'user-family-1',
        guestEmail: 'jane@family.com',
        status: 'CONFIRMED',
        basePrice: 0,
        addonsTotal: 0,
        depositAmount: 0,
        totalAmount: 0,
      }),
    })
  })

  it('sweeps expired overlapping holds before checking availability', async () => {
    await POST(createRequest(validBody()))

    expect(prismaMock.booking.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: 'PENDING',
        holdExpiresAt: { lt: expect.any(Date) },
      }),
      data: expect.objectContaining({ status: 'CANCELLED' }),
    })
  })

  it('fires the owner notification without blocking on failure', async () => {
    mockSendFamilyBookingCreated.mockRejectedValue(new Error('resend down'))

    const response = await POST(createRequest(validBody()))

    expect(response.status).toBe(200)
    expect(mockSendFamilyBookingCreated).toHaveBeenCalledTimes(1)
  })

  it('invalidates booking and calendar caches on success', async () => {
    await POST(createRequest(validBody()))

    expect(mockInvalidateBookings).toHaveBeenCalled()
    expect(mockInvalidateCalendar).toHaveBeenCalled()
  })

  it('returns 400 for invalid input', async () => {
    const response = await POST(createRequest({ token: '' }))

    expect(response.status).toBe(400)
  })

  it('returns 400 when check-in is in the past', async () => {
    const response = await POST(createRequest({ ...validBody(), checkIn: '2020-01-01' }))

    expect(response.status).toBe(400)
  })

  it('returns 400 when stay is shorter than minNights', async () => {
    const response = await POST(
      createRequest({ ...validBody(), checkIn: futureDate(7), checkOut: futureDate(8) })
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toContain('Minimum stay is 2 nights')
    expect(prismaMock.booking.create).not.toHaveBeenCalled()
  })

  it('returns 400 when stay is longer than maxNights', async () => {
    const response = await POST(
      createRequest({ ...validBody(), checkIn: futureDate(7), checkOut: futureDate(30) })
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toContain('Maximum stay is 14 nights')
    expect(prismaMock.booking.create).not.toHaveBeenCalled()
  })

  it('returns 400 when guest count exceeds maxGuests', async () => {
    const response = await POST(createRequest({ ...validBody(), numberOfGuests: 12 }))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toContain('Maximum 8 guests allowed')
    expect(prismaMock.booking.create).not.toHaveBeenCalled()
  })

  it('returns 500 when pricing config is missing', async () => {
    prismaMock.pricingConfig.findFirst.mockResolvedValue(null)

    const response = await POST(createRequest(validBody()))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json.error).toContain('Pricing not configured')
    expect(prismaMock.booking.create).not.toHaveBeenCalled()
  })

  it('accepts exactly minNights stay', async () => {
    const response = await POST(
      createRequest({ ...validBody(), checkIn: futureDate(7), checkOut: futureDate(9) })
    )

    expect(response.status).toBe(200)
  })

  it('accepts exactly maxGuests count', async () => {
    const response = await POST(createRequest({ ...validBody(), numberOfGuests: 8 }))

    expect(response.status).toBe(200)
  })
})
