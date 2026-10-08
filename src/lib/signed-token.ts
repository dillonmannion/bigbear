import { SignJWT, jwtVerify } from 'jose'
import type { JWTPayload } from 'jose'

import { env } from './env'

export interface TokenModule<TPayload extends JWTPayload> {
  sign: (payload: Omit<TPayload, keyof JWTPayload>) => Promise<string>
  verify: (token: string) => Promise<TPayload>
}

/**
 * Create a reusable HS256 JWT sign/verify module keyed on AUTH_SECRET.
 *
 * @param issuer - JWT `iss` claim used for signing and verification
 * @param expiresIn - Expiration time string accepted by jose (e.g. '14d', '25h', '365d')
 */
export function createTokenModule<TPayload extends JWTPayload>(
  issuer: string,
  expiresIn: string
): TokenModule<TPayload> {
  return {
    sign: async (payload) => {
      const key = new TextEncoder().encode(env().AUTH_SECRET)

      return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setIssuer(issuer)
        .setExpirationTime(expiresIn)
        .sign(key)
    },

    verify: async (token) => {
      const key = new TextEncoder().encode(env().AUTH_SECRET)

      const { payload } = await jwtVerify<TPayload>(token, key, {
        issuer,
      })

      return payload
    },
  }
}
