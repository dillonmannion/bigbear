/**
 * Rate limiting with Upstash Redis
 * Falls back to in-memory when Upstash is not configured (local development)
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { env } from './env'

// --- Types ---

interface RateLimitOptions {
  /** Maximum number of requests allowed in the window */
  limit: number
  /** Time window in seconds */
  windowSeconds: number
}

interface RateLimitResult {
  success: boolean
  remaining: number
  resetTime: number
}

// --- Upstash Redis Implementation ---

const isUpstashConfigured = (): boolean =>
  Boolean(env().UPSTASH_REDIS_REST_URL && env().UPSTASH_REDIS_REST_TOKEN)

// Lazy-initialized Redis client
let redis: Redis | null = null
const getRedis = (): Redis => {
  redis ??= Redis.fromEnv()
  return redis
}

// Cache of rate limiters by config key
const rateLimiters = new Map<string, Ratelimit>()

const getRateLimiter = (prefix: string, options: RateLimitOptions): Ratelimit => {
  const cacheKey = `${prefix}:${options.limit}:${options.windowSeconds}`

  let limiter = rateLimiters.get(cacheKey)
  if (!limiter) {
    limiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(options.limit, `${options.windowSeconds} s`),
      prefix: `@bigbear/ratelimit:${prefix}`,
      analytics: true,
    })
    rateLimiters.set(cacheKey, limiter)
  }

  return limiter
}

// --- In-Memory Fallback Implementation ---

interface RateLimitRecord {
  count: number
  resetTime: number
}

const rateLimitStore = new Map<string, RateLimitRecord>()
const CLEANUP_INTERVAL = 60 * 1000 // 1 minute
let lastCleanup = Date.now()

const cleanup = (): void => {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL) return

  lastCleanup = now
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}

const checkRateLimitInMemory = (identifier: string, options: RateLimitOptions): RateLimitResult => {
  cleanup()

  const now = Date.now()
  const windowMs = options.windowSeconds * 1000
  const existing = rateLimitStore.get(identifier)

  // If no existing record or window has expired, create new record
  if (!existing || now > existing.resetTime) {
    const resetTime = now + windowMs
    rateLimitStore.set(identifier, { count: 1, resetTime })
    return { success: true, remaining: options.limit - 1, resetTime }
  }

  // Increment count
  existing.count++
  rateLimitStore.set(identifier, existing)

  // Check if over limit
  if (existing.count > options.limit) {
    return { success: false, remaining: 0, resetTime: existing.resetTime }
  }

  return {
    success: true,
    remaining: options.limit - existing.count,
    resetTime: existing.resetTime,
  }
}

// --- Main Exports ---

/**
 * Check rate limit for a given identifier
 * Uses Upstash Redis in production, falls back to in-memory for local dev
 *
 * @param identifier - Unique identifier (e.g., "contact:192.168.1.1")
 * @param options - Rate limit configuration
 * @returns Promise<RateLimitResult>
 */
export const checkRateLimit = async (
  identifier: string,
  options: RateLimitOptions
): Promise<RateLimitResult> => {
  // Use Upstash if configured
  if (isUpstashConfigured()) {
    const prefix = identifier.split(':')[0] ?? 'default'
    const limiter = getRateLimiter(prefix, options)
    const result = await limiter.limit(identifier)

    return {
      success: result.success,
      remaining: result.remaining,
      resetTime: result.reset,
    }
  }

  // In production, require Upstash Redis for distributed rate limiting
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production for rate limiting. ' +
        'In-memory rate limiting is not reliable across serverless instances.'
    )
  }

  // Fallback to in-memory for development only
  console.warn('[Rate Limit] Using in-memory fallback (development only)')
  return checkRateLimitInMemory(identifier, options)
}

/**
 * Get client identifier from request for rate limiting
 * Prefers X-Forwarded-For for proxied requests, falls back to other headers
 */
export const getClientIdentifier = (request: Request): string => {
  // Try various headers that might contain the client IP
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    return forwardedFor.split(',')[0]?.trim() ?? 'unknown'
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp
  }

  // Vercel-specific header
  const vercelIp = request.headers.get('x-vercel-forwarded-for')
  if (vercelIp) {
    return vercelIp.split(',')[0]?.trim() ?? 'unknown'
  }

  return 'unknown'
}

// Predefined rate limit configurations
export const RATE_LIMITS = {
  /** Contact form: 5 requests per 15 minutes */
  contact: { limit: 5, windowSeconds: 15 * 60 },
  /** Checkout: 10 requests per 15 minutes */
  checkout: { limit: 10, windowSeconds: 15 * 60 },
  /** General API: 100 requests per minute */
  api: { limit: 100, windowSeconds: 60 },
  /** Availability API: 60 requests per minute */
  availability: { limit: 60, windowSeconds: 60 },
  /** Family token verification: 5 requests per 15 minutes */
  familyVerify: { limit: 5, windowSeconds: 15 * 60 },
} as const
