import { NextResponse } from 'next/server'
import { mergeFormLiveIntoState, publishFullFormState } from '@/lib/formLive'
import { callGas } from '@/lib/gas'
import type { ScoringFormState } from '@/lib/forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let payload: { formKey?: string; force?: boolean }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const data = await callGas<{ status: string; state: ScoringFormState }>({
      action: 'readFormState',
      formKey: payload.formKey ?? '',
      force: payload.force === true,
    })
    if (payload.force === true) {
      await publishFullFormState(data.state)
    }
    const state = await mergeFormLiveIntoState(data.state)
    return NextResponse.json({ ok: true, state })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}
