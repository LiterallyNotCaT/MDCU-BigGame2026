import { NextResponse } from 'next/server'
import { callGas } from '@/lib/gas'
import type { ScoringFormState } from '@/lib/forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  let payload: { password?: string; formKeys?: string[] }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const data = await callGas<{
      status: string
      states: Record<string, ScoringFormState>
      errors?: Record<string, string>
    }>({
      action: 'readFormStates',
      password: payload.password ?? '',
      formKeys: payload.formKeys ?? [],
    })
    return NextResponse.json({ ok: true, states: data.states ?? {}, errors: data.errors ?? {} })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message, states: {} }, { status: 500 })
  }
}
