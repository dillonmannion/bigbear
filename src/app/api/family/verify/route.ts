import { NextResponse, type NextRequest } from 'next/server'
import { verifyFamilyToken } from '@/lib/family-token'
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const clientId = getClientIdentifier(req)
  const rateLimitResult = await checkRateLimit(
    `family-verify:${clientId}`,
    RATE_LIMITS.familyVerify
  )

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { valid: false, error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(RATE_LIMITS.familyVerify.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimitResult.resetTime),
        },
      }
    )
  }

  try {
    const { token } = (await req.json()) as { token?: string }

    if (!token) {
      return NextResponse.json({ valid: false }, { status: 400 })
    }

    const payload = await verifyFamilyToken(token)
    return NextResponse.json({
      valid: true,
      name: payload.name,
      email: payload.email,
    })
  } catch {
    return NextResponse.json({ valid: false }, { status: 401 })
  }
}
