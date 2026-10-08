import { Resend } from 'resend'
import { env } from './env'

let _resend: Resend | null = null

/**
 * Lazy-loaded Resend client — avoids module-scope env() crash when the
 * environment hasn't been validated yet (mirrors Stripe/Twilio pattern).
 */
export const getResend = () => {
  _resend ??= new Resend(env().AUTH_RESEND_KEY)
  return _resend
}
