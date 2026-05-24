import { NextResponse } from 'next/server'
import { callGas } from '@/lib/gas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const wave = Number(url.searchParams.get('wave'))
  const type = url.searchParams.get('type') === 'solution' ? 'solution' : 'question'

  try {
    const data = await callGas({
      action: 'readEventStatus',
      wave,
      includeSolutionImage: type === 'solution',
    })
    if (!data || data.status === 'error') {
      return NextResponse.json({ status: 'error', message: data?.message || 'Event image not available' }, { status: 404, headers: noStoreHeaders })
    }

    const imageUrl = type === 'solution' ? data.solutionImage : data.questionImage
    if (type === 'solution' && !data.solutionVisible) {
      return NextResponse.json({ status: 'error', message: 'Solution is hidden' }, { status: 404, headers: noStoreHeaders })
    }
    if (!imageUrl || typeof imageUrl !== 'string') {
      return NextResponse.json({ status: 'error', message: 'Image is not configured' }, { status: 404, headers: noStoreHeaders })
    }

    const imageRes = await fetch(imageUrl, { cache: 'no-store', redirect: 'follow' })
    if (!imageRes.ok || !imageRes.body) {
      return NextResponse.json({ status: 'error', message: 'Image source failed' }, { status: 502, headers: noStoreHeaders })
    }

    const headers = new Headers(noStoreHeaders)
    headers.set('Content-Type', imageRes.headers.get('Content-Type') || 'image/jpeg')
    return new Response(imageRes.body, { status: 200, headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ status: 'error', message }, { status: 500, headers: noStoreHeaders })
  }
}
