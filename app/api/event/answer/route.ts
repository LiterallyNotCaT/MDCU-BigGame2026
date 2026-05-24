import { NextResponse } from 'next/server'
import { callGas } from '@/lib/gas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  let payload: { wave?: number; baan?: number; answer?: string; token?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ status: 'error', message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const data = await callGas({
      action: 'submitEventAnswer',
      wave: payload.wave,
      baan: payload.baan,
      answer: payload.answer ?? '',
      token: payload.token ?? '',
    })
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ status: 'error', message }, { status: /busy|retry/i.test(message) ? 503 : 400 })
  }
}
