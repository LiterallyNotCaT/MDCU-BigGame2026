import { after, NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import {
  assertFormRoundEditable,
  claimFormRoundSubmit,
  publishFormRoundPatch,
  releaseFormRoundSubmitClaim,
} from '@/lib/formLive'
import { callGas } from '@/lib/gas'

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
      await publishFormRoundPatch(formKey, [{
        index: roundIndex,
        locked: true,
        saving: true,
        error: '',
        participants: String(payload.participants ?? ''),
      }])

      let email = ''
      if (payload.oauth === true) {
        const session = await auth()
        email = session?.user?.email ?? ''
        if (!session?.user || !isAllowedDocChulaEmail(email)) throw new Error('Unauthorized')
      }

      after(() => persistFormWrite({ payload, values, email }))
      return NextResponse.json({ ok: true, queued: true, message: 'Sending to sheet...' }, {
        headers: { 'Cache-Control': 'no-store' },
      })
    } catch (error) {
      await releaseFormRoundSubmitClaim(formKey, roundIndex)
      await publishFormRoundPatch(formKey, [{
        index: roundIndex,
        locked: false,
        saving: false,
        error: error instanceof Error ? error.message : String(error),
      }]).catch(err => {
        console.error('Form live unlock after failed write failed:', err)
      })
      throw error
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonError(message, statusForGasError(message))
  }
}

async function persistFormWrite({ payload, values, email }: { payload: Record<string, unknown>; values: string[]; email: string }) {
  try {
    if (payload.oauth === true) {
      await callGas({
        ...payload,
        values,
        email,
        action: 'writeFormScoreOAuth',
      })
    } else {
      await callGas({
        ...payload,
        values,
        action: 'writeFormScore',
      })
    }
    await publishConfirmedRound(payload, values)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const formKey = String(payload.formKey || '')
    const roundIndex = Number(payload.roundIndex)
    await releaseFormRoundSubmitClaim(formKey, roundIndex).catch(err => {
      console.error('Form submit claim release after background write failed:', err)
    })
    await publishFormRoundPatch(formKey, [{
      index: roundIndex,
      locked: false,
      saving: false,
      error: message,
    }]).catch(err => {
      console.error('Form live publish after background write failed:', err)
    })
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
      saving: false,
      error: '',
      deadlineAt: '',
      participants: String(payload.participants ?? ''),
      values,
    }])
  } catch (error) {
    console.error('Form live publish after write failed:', error)
  }
}
