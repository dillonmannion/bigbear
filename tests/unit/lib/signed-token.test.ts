import { describe, it, expect, vi } from 'vitest'
import type { JWTPayload } from 'jose'

vi.mock('@/lib/env', () => ({
  env: () => ({ AUTH_SECRET: 'test-secret-at-least-32-characters-long' }),
}))

const { createTokenModule } = await import('@/lib/signed-token')

interface TestPayload extends JWTPayload {
  userId: string
  role: string
}

const testModule = createTokenModule<TestPayload>('test-issuer', '1h')

describe('createTokenModule', () => {
  it('sign returns a JWT string with 3 dot-separated parts', async () => {
    const token = await testModule.sign({ userId: 'u1', role: 'admin' })

    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)
  })

  it('verify round-trips the custom claims', async () => {
    const token = await testModule.sign({ userId: 'u1', role: 'admin' })
    const payload = await testModule.verify(token)

    expect(payload.userId).toBe('u1')
    expect(payload.role).toBe('admin')
    expect(payload.iss).toBe('test-issuer')
    expect(payload.iat).toEqual(expect.any(Number))
    expect(payload.exp).toEqual(expect.any(Number))
  })

  it('verify throws for a token with wrong issuer', async () => {
    const other = createTokenModule<TestPayload>('other-issuer', '1h')
    const token = await other.sign({ userId: 'u1', role: 'admin' })

    await expect(testModule.verify(token)).rejects.toThrow()
  })

  it('verify throws for an invalid token string', async () => {
    await expect(testModule.verify('garbage')).rejects.toThrow()
  })

  it('verify throws for an expired token', async () => {
    vi.useFakeTimers()
    try {
      const shortLived = createTokenModule<TestPayload>('test-issuer', '1s')
      const token = await shortLived.sign({ userId: 'u1', role: 'admin' })

      vi.advanceTimersByTime(5000)

      await expect(shortLived.verify(token)).rejects.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })
})
