import { NextResponse } from 'next/server'
import { mergeFormLiveIntoState } from '@/lib/formLive'
import { callGas } from '@/lib/gas'
import type { ScoringFormState } from '@/lib/forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let payload: { formKey?: string }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const data = await callGas<{ status: string; state: ScoringFormState }>({
      action: 'readFormState',
      formKey: payload.formKey ?? '',
    })
    const state = await mergeFormLiveIntoState(data.state)
    return NextResponse.json({ ok: true, state })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}
