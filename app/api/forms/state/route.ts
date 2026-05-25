import { NextResponse } from 'next/server'
import { publishFormState } from '@/lib/formLive'
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
    await publishFormState(data.state).catch(error => console.error('Form live publish after state read failed:', error))
    return NextResponse.json({ ok: true, state: data.state })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}
