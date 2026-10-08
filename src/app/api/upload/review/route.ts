import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { verifyReviewToken } from '@/lib/review-token'

export const POST = async (request: Request): Promise<NextResponse> => {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        if (!clientPayload) {
          throw new Error('Unauthorized')
        }

        try {
          await verifyReviewToken(clientPayload)
        } catch {
          throw new Error('Unauthorized')
        }

        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
          maximumSizeInBytes: 10 * 1024 * 1024, // 10MB
          addRandomSuffix: true,
        }
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('Review photo uploaded:', blob.url)
        await Promise.resolve()
      },
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
