'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export interface PublicReview {
  id: string
  guestName: string
  rating: number
  body: string
  photoUrls: string[]
  createdAt: string
}

interface PublicReviewListProps {
  reviews: PublicReview[]
  page: number
  totalPages: number
}

const StarRow = ({ rating }: { rating: number }) => (
  <div className="flex gap-0.5" aria-label={`${String(rating)} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((star) => (
      <Star
        key={star}
        className={`h-4 w-4 ${
          star <= rating
            ? 'fill-amber-400 text-amber-400'
            : 'fill-none text-stone-300 dark:text-stone-600'
        }`}
      />
    ))}
  </div>
)

export const PublicReviewList = ({ reviews, page, totalPages }: PublicReviewListProps) => {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!lightboxUrl) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [lightboxUrl])

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6">
      {reviews.map((review) => (
        <article key={review.id} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-foreground">{review.guestName}</h3>
              <p className="text-sm text-muted-foreground">{formatDate(review.createdAt)}</p>
            </div>
            <StarRow rating={review.rating} />
          </div>

          <p className="mt-4 whitespace-pre-wrap leading-7 text-foreground">{review.body}</p>

          {review.photoUrls.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {review.photoUrls.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => {
                    setLightboxUrl(url)
                  }}
                  className="relative h-24 w-24 overflow-hidden rounded-lg border border-border transition-opacity hover:opacity-80"
                  aria-label={`View photo from ${review.guestName}'s stay`}
                >
                  <Image
                    src={url}
                    alt={`Photo from ${review.guestName}'s stay`}
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </article>
      ))}

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-4 pt-2" aria-label="Review pages">
          {page > 1 ? (
            <Link href={page === 2 ? '/reviews' : `/reviews?page=${String(page - 1)}`}>
              <Button variant="outline" size="sm">
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/reviews?page=${String(page + 1)}`}>
              <Button variant="outline" size="sm">
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </nav>
      )}

      {/* Photo lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => {
            setLightboxUrl(null)
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Review photo"
        >
          <button
            type="button"
            onClick={() => {
              setLightboxUrl(null)
            }}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Close photo"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="relative h-[80vh] w-full max-w-4xl">
            <Image
              src={lightboxUrl}
              alt="Guest review photo, enlarged"
              fill
              sizes="(max-width: 896px) 100vw, 896px"
              className="object-contain"
            />
          </div>
        </div>
      )}
    </div>
  )
}
