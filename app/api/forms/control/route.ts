import { NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import { publishFormRoundPatch, publishFormState } from '@/lib/formLive'
import { callGas } from '@/lib/gas'
import { callOAuthGas } from '@/lib/oauthGas'
import type { ScoringFormState } from '@/lib/forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    if (payload.oauth === true) {
      const session = await auth()
      const email = session?.user?.email ?? ''
      if (!session?.user || !isAllowedDocChulaEmail(email)) {
        return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
      }
      const data = await callOAuthGas({
        ...payload,
        email,
        action: 'setFormRoundControlOAuth',
      })
      await publishControlChange(payload, data)
      return NextResponse.json({ ok: true, message: data.message || 'Updated', data })
    }

    const data = await callGas({
      ...payload,
      action: 'setFormRoundControl',
    })
    await publishControlChange(payload, data)
    return NextResponse.json({ ok: true, message: data.message || 'Updated', data })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: /busy|lock|timeout/i.test(message) ? 503 : 400 })
  }
}

async function publishControlChange(payload: Record<string, unknown>, data: Record<string, unknown>) {
  try {
    const returnedState = data.state as ScoringFormState | undefined
    if (returnedState?.form?.formKey) {
      await publishFormState(returnedState)
      return
    }

    const formKey = String(payload.formKey || '')
    if (!formKey) return
    const patch = controlPatchFromPayload(payload)
    if (!patch) return

    if (payload.allRounds === true) {
      await publishFormRoundPatch(
        formKey,
        Array.from({ length: 12 }, (_, index) => ({ index, ...patch })),
      )
      return
    }

    const roundIndex = Number(payload.roundIndex)
    if (!Number.isInteger(roundIndex) || roundIndex < 0) return
    await publishFormRoundPatch(formKey, [{ index: roundIndex, ...patch }])
  } catch (error) {
    console.error('Form live publish after control failed:', error)
  }
}

function controlPatchFromPayload(payload: Record<string, unknown>) {
  const patch: { confirmed?: boolean; locked?: boolean; deadlineAt?: string } = {}
  if (payload.confirmed !== undefined) patch.confirmed = payload.confirmed === true
  if (payload.locked !== undefined) patch.locked = payload.locked === true
  if (payload.clearDeadline === true) patch.deadlineAt = ''
  if (payload.deadlineMinutes !== undefined) {
    const minutes = Math.max(1, Math.min(240, Number(payload.deadlineMinutes) || 10))
    patch.deadlineAt = new Date(Date.now() + minutes * 60000).toISOString()
  }
  return Object.keys(patch).length ? patch : null
}
