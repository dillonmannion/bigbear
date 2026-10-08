import { Star } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { PublicReviewList, type PublicReview } from './PublicReviewList'

// Dynamic route — reading searchParams opts out of the Full Route Cache.
// invalidateReviews() still calls revalidatePath('/reviews') which is fine.

const PAGE_SIZE = 20

export const metadata = {
  title: 'Guest Reviews - Grizzly Getaway',
  description: 'Read what guests say about their stay at Grizzly Getaway.',
}

interface PublicReviewsPageProps {
  searchParams: Promise<{ page?: string }>
}

export default async function PublicReviewsPage({ searchParams }: PublicReviewsPageProps) {
  const { page: rawPage } = await searchParams
  const parsedPage = Number(rawPage)
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1

  const where = { isPublished: true } as const

  const [reviews, aggregation] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.review.aggregate({
      where,
      _count: true,
      _avg: { rating: true },
    }),
  ])

  const count = aggregation._count
  const average = aggregation._avg.rating ?? 0
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  // Clamp to valid page range — show empty list on last page if out of bounds
  const safePage = Math.min(page, totalPages)

  const reviewDtos: PublicReview[] = reviews.map((review) => ({
    id: review.id,
    guestName: review.guestName,
    rating: review.rating,
    body: review.body,
    photoUrls: review.photoUrls,
    createdAt: review.createdAt.toISOString(),
  }))

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-12 text-center">
        <h1 className="mb-4 text-4xl font-bold text-foreground">Guest Reviews</h1>
        {count > 0 ? (
          <div className="inline-flex items-center gap-3 rounded-full border border-forest-200 bg-forest-50 px-5 py-2.5 dark:border-forest-800 dark:bg-forest-950/40">
            <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
            <span className="text-lg font-semibold text-foreground">{average.toFixed(1)}</span>
            <span className="text-sm text-muted-foreground">
              from {count} review{count > 1 ? 's' : ''}
            </span>
          </div>
        ) : (
          <p className="mx-auto max-w-2xl text-muted-foreground">
            No reviews yet — be our next guest and the first to share your stay!
          </p>
        )}
      </div>

      {count > 0 && (
        <PublicReviewList reviews={reviewDtos} page={safePage} totalPages={totalPages} />
      )}
    </div>
  )
}
