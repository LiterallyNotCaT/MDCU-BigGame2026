import { NextResponse } from 'next/server'
import { mergeBiddingPendingIntoWaveInputs } from '@/lib/biddingLive'
import { fetchRawWaveInputs } from '@/lib/sheets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function normalizeWave(value: unknown) {
  const wave = Number(value)
  return Number.isInteger(wave) && wave >= 1 && wave <= 5 ? wave : null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const wave = normalizeWave(url.searchParams.get('wave'))
  if (!wave) {
    return NextResponse.json({ ok: false, message: 'Invalid wave' }, { status: 400 })
  }

  try {
    const sheetInputs = await fetchRawWaveInputs(wave)
    const merged = await mergeBiddingPendingIntoWaveInputs(wave, sheetInputs)
    return NextResponse.json({
      ok: true,
      ...merged,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}
