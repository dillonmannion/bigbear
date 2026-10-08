import { vi } from 'vitest'

// Matches the real SDK contract: API failures resolve as { data: null, error },
// only network errors reject.
export const mockSend = vi.fn().mockResolvedValue({ data: { id: 'mock-email-id' }, error: null })

export class MockResend {
  emails = { send: mockSend }
}

export const resetResendMocks = () => {
  mockSend.mockReset()
  mockSend.mockResolvedValue({ data: { id: 'mock-email-id' }, error: null })
}

// Named export for vi.mock
export const Resend = MockResend
