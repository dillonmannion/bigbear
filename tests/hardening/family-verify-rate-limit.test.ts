import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env as mockEnv } from '../__mocks__/env'

vi.mock('@/lib/env', () => ({
  env: mockEnv,
}))

const mockCheckRateLimit = vi.hoisted(() => vi.fn())

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIdentifier: vi.fn(() => 'test-client-ip'),
  RATE_LIMITS: {
    familyVerify: { limit: 5, windowSeconds: 15 * 60 },
  },
}))

const mockVerifyFamilyToken = vi.hoisted(() => vi.fn())

vi.mock('@/lib/family-token', () => ({
  verifyFamilyToken: mockVerifyFamilyToken,
}))

const { POST } = await import('@/app/api/family/verify/route')

const createRequest = (body: unknown) =>
  new Request('http://localhost/api/family/verify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as never

describe('POST /api/family/verify — rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({
      success: true,
      remaining: 4,
      resetTime: Date.now() + 60_000,
    })
    mockVerifyFamilyToken.mockResolvedValue({ email: 'fam@example.com', name: 'Family Member' })
  })

  it('calls checkRateLimit with the familyVerify preset keyed by IP', async () => {
    await POST(createRequest({ token: 'valid-token' }))

    expect(mockCheckRateLimit).toHaveBeenCalledWith('family-verify:test-client-ip', {
      limit: 5,
      windowSeconds: 15 * 60,
    })
  })

  it('returns 429 with rate-limit headers when over the limit', async () => {
    mockCheckRateLimit.mockResolvedValue({
      success: false,
      remaining: 0,
      resetTime: Date.now() + 60_000,
    })

    const response = await POST(createRequest({ token: 'valid-token' }))
    const json = await response.json()

    expect(response.status).toBe(429)
    expect(json.valid).toBe(false)
    expect(json.error).toContain('Too many requests')
    expect(response.headers.get('Retry-After')).toBeTruthy()
    expect(response.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy()
  })

  it('does not verify the token when rate-limited', async () => {
    mockCheckRateLimit.mockResolvedValue({
      success: false,
      remaining: 0,
      resetTime: Date.now() + 60_000,
    })

    await POST(createRequest({ token: 'any-token' }))

    expect(mockVerifyFamilyToken).not.toHaveBeenCalled()
  })

  it('proceeds to verify the token when under the limit', async () => {
    await POST(createRequest({ token: 'valid-token' }))

    expect(mockVerifyFamilyToken).toHaveBeenCalledWith('valid-token')
  })

  it('returns 400 for missing token after passing rate limit', async () => {
    const response = await POST(createRequest({}))

    expect(response.status).toBe(400)
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1)
  })

  it('returns 401 for invalid token after passing rate limit', async () => {
    mockVerifyFamilyToken.mockRejectedValue(new Error('invalid'))

    const response = await POST(createRequest({ token: 'bad-token' }))

    expect(response.status).toBe(401)
  })
})
