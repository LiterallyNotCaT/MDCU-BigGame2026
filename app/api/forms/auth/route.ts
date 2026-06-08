import { NextResponse } from 'next/server'
import { callGas } from '@/lib/gas'
import { cacheFormAdminPassword } from '@/lib/formAdminAuthCache'
import { mergeFormLiveIntoState } from '@/lib/formLive'
import { normalizeScoringFormState, type ScoringFormAuth } from '@/lib/forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
    if (payload.admin === true && data.ok) {
      await cacheFormAdminPassword(payload.password ?? '')
    }
    const state = data.state ? await mergeFormLiveIntoState(normalizeScoringFormState(data.state)) : data.state
    return NextResponse.json({ ...data, state })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: 401 })
  }
}
