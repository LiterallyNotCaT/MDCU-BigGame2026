import { NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import {
  claimAndPublishFormRoundSubmit,
  FORM_SUBMIT_IN_PROGRESS_MESSAGE,
  publishFormRoundPatch,
  publishFormRoundSavedSignal,
  releaseFormRoundSubmitClaim,
} from '@/lib/formLive'
import { callGas } from '@/lib/gas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function jsonError(message: string, status = 500) {
  return NextResponse.json({ ok: false, message }, { status })
}

function statusForGasError(message: string) {
  if (/unauthorized/i.test(message)) return 401
  if (/already confirmation|already confirmed|already sending/i.test(message)) return 409
  return /busy|retry|lock|timeout|timed out/i.test(message) ? 503 : 400
}

export async function POST(req: Request) {
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const formKey = String(payload.formKey || '')
  const roundIndex = Number(payload.roundIndex)
  const isAdmin = payload.admin === true
  const values = Array.isArray(payload.values) ? payload.values.map(value => String(value ?? '')) : []

  if (!formKey.trim()) return jsonError('Missing formKey', 400)
  if (!Number.isInteger(roundIndex) || roundIndex < 0) return jsonError('Invalid round', 400)
  if (!values.some(value => value.trim())) return jsonError('Please enter data before confirming.', 400)

  let claimed = false
  try {
    await claimAndPublishFormRoundSubmit(formKey, roundIndex, isAdmin, {
      locked: true,
      saving: true,
      error: '',
      participants: String(payload.participants ?? ''),
      values,
    })
    claimed = true

    let email = ''
    if (payload.oauth === true) {
      const session = await auth()
      email = session?.user?.email ?? ''
      if (!session?.user || !isAllowedDocChulaEmail(email)) throw new Error('Unauthorized')
    }

    const data = await callGas<{ status: string; message?: string; roundIndex?: number }>({
      ...payload,
      values,
      email,
      action: payload.oauth === true ? 'writeFormScoreOAuth' : 'writeFormScore',
    })

    await publishFormRoundSavedSignal(formKey, roundIndex, {
      confirmed: true,
      locked: false,
      deadlineAt: '',
    })

    return NextResponse.json({
      ok: true,
      confirmed: true,
      message: data.message || 'Saved to sheet',
      roundIndex,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error)
    const message = rawMessage === FORM_SUBMIT_IN_PROGRESS_MESSAGE
      ? 'This round is already sending. Please wait.'
      : rawMessage

    if (claimed) {
      await releaseFormRoundSubmitClaim(formKey, roundIndex).catch(err => {
        console.error('Form submit claim release after failed write failed:', err)
      })
      await publishFormRoundPatch(formKey, [{
        index: roundIndex,
        locked: false,
        saving: false,
        error: message,
      }]).catch(err => {
        console.error('Form live publish after failed write failed:', err)
      })
    }

    return jsonError(message, statusForGasError(message))
  }
}
