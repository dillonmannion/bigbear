import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockReset } from 'vitest-mock-extended'
import { prismaMock } from '../../__mocks__/prisma'
import { mockSend, resetResendMocks } from '../../__mocks__/resend'

vi.mock('@/lib/prisma', () => import('../../__mocks__/prisma'))
vi.mock('@/lib/env', () => import('../../__mocks__/env'))
vi.mock('resend', () => import('../../__mocks__/resend'))
vi.mock('@/lib/auth/secure-action', () => ({
  secureAction: (
    _config: unknown,
    handler: (ctx: { session: unknown; data: unknown }) => unknown
  ) => {
    return (input: unknown) => {
      const config = _config as {
        schema?: {
          safeParse: (input: unknown) => {
            success: boolean
            error?: unknown
            data?: unknown
          }
        }
      }
      if (config.schema) {
        const validated = config.schema.safeParse(input)
        if (!validated.success) {
          const error = validated.error as { errors?: unknown[] }
          return Promise.resolve({
            success: false,
            error: error?.errors?.[0] ?? 'Invalid input',
          })
        }
        return handler({
          session: { user: { id: 'owner', role: 'OWNER', email: 'owner@test.com' } },
          data: validated.data,
        })
      }
      return handler({
        session: { user: { id: 'owner', role: 'OWNER', email: 'owner@test.com' } },
        data: input,
      })
    }
  },
}))
vi.mock('@/lib/cache/invalidation', () => ({
  invalidateFamily: vi.fn(),
}))
vi.mock('@/lib/family-token', () => ({
  signFamilyToken: vi.fn().mockResolvedValue('mock-family-token'),
}))

const { addFamilyMember, removeFamilyMember, resendFamilyInvite } = await import('@/actions/family')

describe('Family Actions', () => {
  beforeEach(() => {
    mockReset(prismaMock)
    resetResendMocks()
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // addFamilyMember
  // ---------------------------------------------------------------------------

  describe('addFamilyMember', () => {
    it('should create the user with isFamilyMember=true when they do not exist yet', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)

      const result = await addFamilyMember({
        email: 'family@example.com',
        name: 'John Smith',
      })

      expect(result.success).toBe(true)
      expect(result.data?.emailSent).toBe(true)
      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: {
          email: 'family@example.com',
          name: 'John Smith',
          role: 'GUEST',
          isFamilyMember: true,
        },
      })
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'family@example.com',
          subject: expect.stringContaining('invited'),
        })
      )
    })

    it('should return emailSent: false when Resend throws (network error)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)
      mockSend.mockRejectedValue(new Error('Resend outage'))

      const result = await addFamilyMember({
        email: 'family@example.com',
        name: 'John Smith',
      })

      expect(result.success).toBe(true)
      expect(result.data?.emailSent).toBe(false)
      // DB write should still have happened
      expect(prismaMock.user.create).toHaveBeenCalled()
    })

    it('should return emailSent: false when Resend resolves with an API error', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)
      // The SDK does not throw on API errors — it resolves { data: null, error }
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'Invalid `to` address', name: 'validation_error' },
      })

      const result = await addFamilyMember({
        email: 'family@example.com',
        name: 'John Smith',
      })

      expect(result.success).toBe(true)
      expect(result.data?.emailSent).toBe(false)
      expect(prismaMock.user.create).toHaveBeenCalled()
    })

    it('should describe the link as non-expiring in the invite email', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)

      await addFamilyMember({ email: 'family@example.com', name: 'John' })

      const callArgs = mockSend.mock.calls[0]?.[0] as { html?: string } | undefined
      expect(callArgs?.html).toContain('stays valid as long as your family access is active')
      expect(callArgs?.html).not.toMatch(/expires? in \d+ days/i)
    })

    it('should set isFamilyMember=true when user already exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isFamilyMember: false,
      } as any)
      prismaMock.user.update.mockResolvedValue({} as any)

      await addFamilyMember({ email: 'family@example.com', name: 'John' })

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isFamilyMember: true },
      })
    })

    it('should return error when user is already a family member', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isFamilyMember: true,
      } as any)

      const result = await addFamilyMember({ email: 'family@example.com', name: 'John' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('This person is already a family member')
      expect(prismaMock.user.update).not.toHaveBeenCalled()
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should escape HTML special characters in name to prevent XSS', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)

      await addFamilyMember({
        email: 'attacker@example.com',
        name: '<script>alert(1)</script>',
      })

      const callArgs = mockSend.mock.calls[0]?.[0] as { html?: string } | undefined
      expect(callArgs?.html).not.toContain('<script>')
      expect(callArgs?.html).toContain('&lt;script&gt;')
    })

    it('should escape ampersands and quotes in name', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)

      await addFamilyMember({
        email: 'test@example.com',
        name: 'John & "Jane"',
      })

      const callArgs = mockSend.mock.calls[0]?.[0] as { html?: string } | undefined
      expect(callArgs?.html).toContain('&amp;')
      expect(callArgs?.html).toContain('&quot;')
    })

    it('should call invalidateFamily after sending invite', async () => {
      const { invalidateFamily } = await import('@/lib/cache/invalidation')
      prismaMock.user.findUnique.mockResolvedValue(null)

      await addFamilyMember({ email: 'family@example.com', name: 'John' })

      expect(invalidateFamily).toHaveBeenCalled()
    })

    it('should include booking URL with family token in email', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)

      await addFamilyMember({ email: 'family@example.com', name: 'John' })

      const callArgs = mockSend.mock.calls[0]?.[0] as { html?: string } | undefined
      expect(callArgs?.html).toContain('mock-family-token')
    })

    it('should return error for invalid email', async () => {
      const result = await addFamilyMember({ email: 'not-an-email', name: 'John' })

      expect(result.success).toBe(false)
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
    })

    it('should return error for empty name', async () => {
      const result = await addFamilyMember({ email: 'test@example.com', name: '' })

      expect(result.success).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // removeFamilyMember
  // ---------------------------------------------------------------------------

  describe('removeFamilyMember', () => {
    it('should remove family member when they exist and are a member', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isFamilyMember: true,
      } as any)
      prismaMock.user.update.mockResolvedValue({} as any)

      const result = await removeFamilyMember({ userId: 'user-1' })

      expect(result.success).toBe(true)
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isFamilyMember: false },
      })
    })

    it('should return error when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)

      const result = await removeFamilyMember({ userId: 'nonexistent' })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    })

    it('should return error when user is not a family member', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isFamilyMember: false,
      } as any)

      const result = await removeFamilyMember({ userId: 'user-1' })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    })

    it('should call invalidateFamily after removal', async () => {
      const { invalidateFamily } = await import('@/lib/cache/invalidation')
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isFamilyMember: true,
      } as any)
      prismaMock.user.update.mockResolvedValue({} as any)

      await removeFamilyMember({ userId: 'user-1' })

      expect(invalidateFamily).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // resendFamilyInvite
  // ---------------------------------------------------------------------------

  describe('resendFamilyInvite', () => {
    it('should resend invite email to existing family member', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        isFamilyMember: true,
      } as any)

      const result = await resendFamilyInvite({ userId: 'user-1' })

      expect(result.success).toBe(true)
      expect(result.data?.emailSent).toBe(true)
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com' }))
    })

    it('should return emailSent: false when Resend throws (network error)', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        isFamilyMember: true,
      } as any)
      mockSend.mockRejectedValue(new Error('Resend outage'))

      const result = await resendFamilyInvite({ userId: 'user-1' })

      expect(result.success).toBe(true)
      expect(result.data?.emailSent).toBe(false)
    })

    it('should return emailSent: false when Resend resolves with an API error', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        isFamilyMember: true,
      } as any)
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'Domain not verified', name: 'validation_error' },
      })

      const result = await resendFamilyInvite({ userId: 'user-1' })

      expect(result.success).toBe(true)
      expect(result.data?.emailSent).toBe(false)
    })

    it('should return error when user is not a family member', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        isFamilyMember: false,
      } as any)

      const result = await resendFamilyInvite({ userId: 'user-1' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('User is not a family member')
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should return error when user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)

      const result = await resendFamilyInvite({ userId: 'nonexistent' })

      expect(result.success).toBe(false)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should escape HTML special characters in user name to prevent XSS', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: '<img src=x onerror=alert(1)>',
        email: 'jane@example.com',
        isFamilyMember: true,
      } as any)

      await resendFamilyInvite({ userId: 'user-1' })

      const callArgs = mockSend.mock.calls[0]?.[0] as { html?: string } | undefined
      expect(callArgs?.html).not.toContain('<img')
      expect(callArgs?.html).toContain('&lt;img')
    })

    it('should use "there" as fallback when user name is null', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: null,
        email: 'jane@example.com',
        isFamilyMember: true,
      } as any)

      await resendFamilyInvite({ userId: 'user-1' })

      const callArgs = mockSend.mock.calls[0]?.[0] as { html?: string } | undefined
      expect(callArgs?.html).toContain('Hello there')
    })

    it('should include booking URL with family token in email', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        name: 'Jane',
        email: 'jane@example.com',
        isFamilyMember: true,
      } as any)

      await resendFamilyInvite({ userId: 'user-1' })

      const callArgs = mockSend.mock.calls[0]?.[0] as { html?: string } | undefined
      expect(callArgs?.html).toContain('mock-family-token')
    })
  })
})
