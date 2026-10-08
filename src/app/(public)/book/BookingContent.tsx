'use client'

import { toast } from 'sonner'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Calendar,
  GuestForm,
  AddonSelector,
  PriceSummary,
  PaymentOptionsModal,
} from '@/components/booking'
import { Button, Card, CardContent } from '@/components/ui'

interface Addon {
  id: string
  name: string
  description: string | null
  price: number
}

interface SelectedAddon {
  id: string
  quantity: number
}

interface PricingConfig {
  baseNightlyRate: number
  cleaningFee: number
  depositPercentage: number
  minNights: number
  maxNights: number
}

interface GuestInfo {
  name: string
  email: string
  phone: string
}

// Stripe checkout is currently disabled — payment handled via PaymentOptionsModal
// interface CheckoutResponse {
//   url?: string
//   error?: string
// }

function computeTotalWithDeposit(
  checkIn: Date,
  checkOut: Date,
  config: PricingConfig,
  selectedAddons: SelectedAddon[],
  addons: Addon[]
): number {
  const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24))
  const accommodationTotal = config.baseNightlyRate * nights
  const addonsTotal = selectedAddons.reduce((total, selected) => {
    const addon = addons.find((a) => a.id === selected.id)
    return total + (addon ? addon.price * selected.quantity : 0)
  }, 0)
  const subtotal = accommodationTotal + config.cleaningFee + addonsTotal
  const deposit = subtotal * (config.depositPercentage / 100)
  return subtotal + deposit
}

export const BookingContent = () => {
  const searchParams = useSearchParams()
  const cancelled = searchParams.get('cancelled')
  const familyToken = searchParams.get('family')

  const [checkIn, setCheckIn] = useState<Date | null>(null)
  const [checkOut, setCheckOut] = useState<Date | null>(null)
  const [guestInfo, setGuestInfo] = useState<GuestInfo>({ name: '', email: '', phone: '' })
  const [selectedAddons, setSelectedAddons] = useState<SelectedAddon[]>([])
  const [addons, setAddons] = useState<Addon[]>([])
  const [pricing, setPricing] = useState<PricingConfig | null>(null)
  const [blockedDates, setBlockedDates] = useState<Date[]>([])
  const [errors, setErrors] = useState<Partial<Record<keyof GuestInfo, string>>>({})
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [availabilityError, setAvailabilityError] = useState(false)
  const [isFamilyBooking, setIsFamilyBooking] = useState(false)
  const [familyConfirmed, setFamilyConfirmed] = useState(false)
  const [familySubmitting, setFamilySubmitting] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [addonsRes, pricingRes, blockedRes] = await Promise.all([
          fetch('/api/addons'),
          fetch('/api/pricing'),
          fetch('/api/availability'),
        ])

        if (addonsRes.ok) {
          const addonsData = (await addonsRes.json()) as Addon[]
          setAddons(addonsData)
        }

        if (pricingRes.ok) {
          const pricingData = (await pricingRes.json()) as PricingConfig
          setPricing(pricingData)
        }

        if (blockedRes.ok) {
          const blockedData = (await blockedRes.json()) as string[]
          setBlockedDates(blockedData.map((d) => new Date(d)))
          setAvailabilityError(false)
        } else {
          setAvailabilityError(true)
        }
      } catch (error) {
        console.error('Failed to fetch booking data:', error)
        setAvailabilityError(true)
      }
    }

    void fetchData()
  }, [])

  // Verify family token if present
  useEffect(() => {
    if (!familyToken) return

    const verifyFamily = async () => {
      try {
        const res = await fetch('/api/family/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: familyToken }),
        })
        if (res.ok) {
          const data = (await res.json()) as { valid: boolean; name: string; email: string }
          if (data.valid) {
            setIsFamilyBooking(true)
            setGuestInfo((prev) => ({
              ...prev,
              name: data.name,
              email: data.email,
            }))
          }
        }
      } catch {
        // Token invalid — continue as normal booking
      }
    }

    void verifyFamily()
  }, [familyToken])

  const handleDateSelect = (newCheckIn: Date | null, newCheckOut: Date | null) => {
    setCheckIn(newCheckIn)
    setCheckOut(newCheckOut)
  }

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof GuestInfo, string>> = {}

    if (!guestInfo.name.trim()) {
      newErrors.name = 'Name is required'
    }

    if (!guestInfo.email.trim()) {
      newErrors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestInfo.email)) {
      newErrors.email = 'Please enter a valid email'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleFamilyConfirm = async () => {
    if (!checkIn || !checkOut || !validateForm()) return

    setFamilySubmitting(true)
    try {
      const res = await fetch('/api/booking/family', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: familyToken,
          checkIn: checkIn.toISOString(),
          checkOut: checkOut.toISOString(),
          guestName: guestInfo.name,
          guestEmail: guestInfo.email,
          guestPhone: guestInfo.phone,
          numberOfGuests: 1,
          addons: selectedAddons,
        }),
      })

      if (res.ok) {
        setFamilyConfirmed(true)
      } else {
        const data = (await res.json()) as { error?: string }
        toast.error(data.error ?? 'Failed to create booking')
      }
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setFamilySubmitting(false)
    }
  }

  const handleReserve = () => {
    if (!checkIn || !checkOut) {
      toast.error('Please select your dates')
      return
    }

    if (!validateForm()) return

    if (isFamilyBooking) {
      void handleFamilyConfirm()
      return
    }

    setShowPaymentModal(true)
  }

  const defaultPricing: PricingConfig = {
    baseNightlyRate: 150,
    cleaningFee: 75,
    depositPercentage: 20,
    minNights: 2,
    maxNights: 14,
  }

  const config = pricing ?? defaultPricing

  const totalWithDeposit =
    checkIn && checkOut
      ? computeTotalWithDeposit(checkIn, checkOut, config, selectedAddons, addons)
      : null

  if (familyConfirmed) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-forest-100 text-forest-600 dark:bg-forest-900/40 dark:text-forest-400">
          <svg
            className="h-8 w-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-foreground">Booking Confirmed!</h2>
        <p className="text-muted-foreground">
          Thanks, {guestInfo.name}! Your family booking has been confirmed. You&apos;ll receive a
          confirmation email at {guestInfo.email} shortly.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4 text-foreground">Book Your Stay</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {isFamilyBooking
            ? 'Welcome, family! Select your dates and confirm — no payment needed.'
            : 'Select your dates, input your info, provide the deposit, and you\u0027ll receive a text/email confirming your booking! We are excited to host you!'}
        </p>
      </div>

      {isFamilyBooking && (
        <div className="mb-8 p-4 bg-forest-50 dark:bg-forest-900/20 border border-forest-200 dark:border-forest-800 rounded-lg text-forest-700 dark:text-forest-300">
          <p className="font-semibold">Family Booking</p>
          <p className="text-sm mt-1">
            You&apos;re booking as family — no payment required. Just pick your dates and confirm!
          </p>
        </div>
      )}

      {cancelled && (
        <div className="mb-8 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200">
          Your booking was cancelled. Feel free to start over when you&apos;re ready.
        </div>
      )}

      {availabilityError && (
        <div className="mb-8 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200">
          <p className="font-semibold mb-1">Unable to Load Availability</p>
          <p className="text-sm">
            We couldn&apos;t load the current availability calendar. Please refresh the page to try
            again.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card>
            <CardContent className="py-6">
              <h2 className="text-xl font-semibold mb-4 text-foreground">Select Dates</h2>
              <Calendar
                checkIn={checkIn}
                checkOut={checkOut}
                onDateSelect={handleDateSelect}
                blockedDates={blockedDates}
                minNights={config.minNights}
                maxNights={config.maxNights}
              />
              {checkIn && checkOut && (
                <div className="mt-4 p-3 bg-forest-50 dark:bg-forest-900/30 rounded-lg text-forest-700 dark:text-forest-300 text-sm">
                  {Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24))}{' '}
                  nights selected
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-6">
              <GuestForm guestInfo={guestInfo} onChange={setGuestInfo} errors={errors} />
            </CardContent>
          </Card>

          {addons.length > 0 && (
            <Card>
              <CardContent className="py-6">
                <AddonSelector
                  addons={addons}
                  selectedAddons={selectedAddons}
                  onChange={setSelectedAddons}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-24 space-y-6">
            <PriceSummary
              checkIn={checkIn}
              checkOut={checkOut}
              nightlyRate={config.baseNightlyRate}
              cleaningFee={config.cleaningFee}
              depositPercentage={config.depositPercentage}
              addons={addons}
              selectedAddons={selectedAddons}
            />
            <Button
              onClick={() => {
                handleReserve()
              }}
              disabled={!checkIn || !checkOut || availabilityError || familySubmitting}
              isLoading={familySubmitting}
              className="w-full hidden lg:flex"
              size="lg"
            >
              {isFamilyBooking ? 'Confirm Booking' : 'Reserve & Pay'}
            </Button>
            {!isFamilyBooking && (
              <p className="text-xs text-muted-foreground text-center hidden lg:block">
                Choose from Venmo, Cash App, PayPal, Zelle, or contact the owner.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Mobile sticky bottom bar — visible only below lg breakpoint */}
      <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-card border-t border-border px-4 py-3 safe-area-pb">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="text-sm">
            {totalWithDeposit !== null ? (
              <span className="font-semibold text-foreground">
                ${totalWithDeposit.toFixed(2)}{' '}
                <span className="font-normal text-muted-foreground">total</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Select dates</span>
            )}
          </div>
          <Button
            onClick={() => {
              handleReserve()
            }}
            disabled={!checkIn || !checkOut || availabilityError || familySubmitting}
            isLoading={familySubmitting}
            size="md"
          >
            {isFamilyBooking ? 'Confirm' : 'Reserve & Pay'}
          </Button>
        </div>
      </div>

      {/* Payment options modal */}
      {checkIn && checkOut && (
        <PaymentOptionsModal
          isOpen={showPaymentModal}
          onClose={() => {
            setShowPaymentModal(false)
          }}
          booking={{
            checkIn,
            checkOut,
            guestName: guestInfo.name,
            guestEmail: guestInfo.email,
            guestPhone: guestInfo.phone,
            addons: selectedAddons,
            totalAmount: totalWithDeposit ?? 0,
          }}
        />
      )}
    </div>
  )
}
