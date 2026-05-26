import { NextResponse } from 'next/server'
import { callGas } from '@/lib/gas'
import { mergeFormLiveIntoState } from '@/lib/formLive'
import type { ScoringFormAuth } from '@/lib/forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let payload: { formKey?: string; password?: string; admin?: boolean }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const data = await callGas<ScoringFormAuth & { status: string }>({
      action: 'authFormUser',
      formKey: payload.formKey ?? '',
      password: payload.password ?? '',
      admin: payload.admin === true,
    })
    const state = data.state ? await mergeFormLiveIntoState(data.state) : data.state
    return NextResponse.json({ ...data, state })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: 401 })
  }
}
