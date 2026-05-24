import { NextResponse } from 'next/server'
import { callGas } from '@/lib/gas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const wave = Number(url.searchParams.get('wave'))
  try {
    const data = await callGas({
      action: 'readEventStatus',
      wave,
      includeSolutionImage: false,
    })
    const { solutionImage: _solutionImage, questionImage: _questionImage, ...safeData } = data ?? {}
    return NextResponse.json(safeData, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ status: 'error', message }, { status: 500 })
  }
}
