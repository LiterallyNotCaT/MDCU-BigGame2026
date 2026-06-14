import { NextResponse } from 'next/server'
import { mergeBiddingPendingIntoWaveInputs } from '@/lib/biddingLive'
import { fetchRawWaveInputs } from '@/lib/sheets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const RAW_WAVE_INPUT_CACHE_MS = 2500
const rawWaveInputsCache = new Map<number, { at: number; data: Awaited<ReturnType<typeof fetchRawWaveInputs>> }>()
const rawWaveInputsInFlight = new Map<number, Promise<Awaited<ReturnType<typeof fetchRawWaveInputs>>>>()

function normalizeWave(value: unknown) {
  const wave = Number(value)
  return Number.isInteger(wave) && wave >= 1 && wave <= 5 ? wave : null
}

async function readRawWaveInputs(wave: number) {
  const cached = rawWaveInputsCache.get(wave)
  if (cached && Date.now() - cached.at < RAW_WAVE_INPUT_CACHE_MS) return cached.data

  const existing = rawWaveInputsInFlight.get(wave)
  if (existing) return existing

  const request = fetchRawWaveInputs(wave)
    .then(data => {
      rawWaveInputsCache.set(wave, { at: Date.now(), data })
      return data
    })
    .finally(() => {
      rawWaveInputsInFlight.delete(wave)
    })

  rawWaveInputsInFlight.set(wave, request)
  return request
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const wave = normalizeWave(url.searchParams.get('wave'))
  if (!wave) {
    return NextResponse.json({ ok: false, message: 'Invalid wave' }, { status: 400 })
  }

  try {
    const sheetInputs = await readRawWaveInputs(wave)
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
