import { NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import {
  assertFormRoundEditable,
  claimFormRoundSubmit,
  publishFormRoundPatch,
  releaseFormRoundSubmitClaim,
} from '@/lib/formLive'
import { callGas } from '@/lib/gas'
import { callOAuthGas } from '@/lib/oauthGas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function jsonError(message: string, status = 500) {
  return NextResponse.json({ ok: false, message }, { status })
}

function statusForGasError(message: string) {
  if (/already confirmation|already confirmed/i.test(message)) return 409
  return /busy|retry|lock|timeout|timed out/i.test(message) ? 503 : 400
}

export async function POST(req: Request) {
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  try {
    const formKey = String(payload.formKey || '')
    const roundIndex = Number(payload.roundIndex)
    const isAdmin = payload.admin === true
    const values = Array.isArray(payload.values) ? payload.values.map(value => String(value ?? '')) : []
    if (!values.some(value => value.trim())) {
      return jsonError('Please enter data before confirming.', 400)
    }

    await assertFormRoundEditable(formKey, roundIndex, isAdmin)
    const claimed = await claimFormRoundSubmit(formKey, roundIndex)
    if (!claimed) {
      return jsonError("Can't send the data as there is already confirmation from another person.", 409)
    }

    try {
      if (payload.oauth === true) {
        const session = await auth()
        const email = session?.user?.email ?? ''
        if (!session?.user || !isAllowedDocChulaEmail(email)) throw new Error('Unauthorized')

        const data = await callOAuthGas({
          ...payload,
          values,
          email,
          action: 'writeFormScoreOAuth',
        })
        await publishConfirmedRound(payload, values)
        return NextResponse.json({ ok: true, message: data.message || 'Saved', data })
      }

      const data = await callGas({
        ...payload,
        values,
        action: 'writeFormScore',
      })
      await publishConfirmedRound(payload, values)
      return NextResponse.json({ ok: true, message: data.message || 'Saved', data })
    } catch (error) {
      await releaseFormRoundSubmitClaim(formKey, roundIndex)
      throw error
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonError(message, statusForGasError(message))
  }
}

async function publishConfirmedRound(payload: Record<string, unknown>, values: string[]) {
  try {
    const formKey = String(payload.formKey || '')
    const roundIndex = Number(payload.roundIndex)
    if (!formKey || !Number.isInteger(roundIndex) || roundIndex < 0) return
    await publishFormRoundPatch(formKey, [{
      index: roundIndex,
      confirmed: true,
      locked: false,
      deadlineAt: '',
      participants: String(payload.participants ?? ''),
      values,
    }])
  } catch (error) {
    console.error('Form live publish after write failed:', error)
  }
}
