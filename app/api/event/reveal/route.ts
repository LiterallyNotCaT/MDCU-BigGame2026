import { NextResponse } from 'next/server'
import { callGas } from '@/lib/gas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let payload: { wave?: number; visible?: boolean; token?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ status: 'error', message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const data = await callGas({
      action: 'setEventSolutionVisible',
      wave: payload.wave,
      visible: payload.visible === true,
      token: payload.token ?? '',
    })
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ status: 'error', message }, { status: 401 })
  }
}
