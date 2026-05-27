import { after, NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import {
  claimAndPublishFormRoundSubmit,
  publishFormRoundPatch,
  readFormLiveState,
  releaseFormRoundSubmitClaim,
} from '@/lib/formLive'
import { callGas } from '@/lib/gas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

type MoneyDropSpecialRound = {
  index: number
  label: string
  wave: 2 | 4
  value: string
  confirmed: boolean
  locked: boolean
  saving?: boolean
  error?: string
}

type MoneyDropSpecialState = {
  formKey: string
  liveKey: string
  rounds: MoneyDropSpecialRound[]
}

function specialLiveKey(formKey: string) {
  return `${formKey}::money-drop-special`
}

function jsonError(message: string, status = 500) {
  return NextResponse.json({ ok: false, message }, { status })
}

function normalizeIslandList(value: unknown) {
  const areas = String(value ?? '')
    .toUpperCase()
    .match(/[ABC]\s*[1-9]/g)
    ?.map(item => item.replace(/\s+/g, '')) ?? []
  return Array.from(new Set(areas)).join(', ')
}

function normalizeGroup(value: unknown) {
  const clean = String(value ?? '').trim().toUpperCase()
  return /^[ABC]$/.test(clean) ? clean : ''
}

function normalizeValue(roundIndex: number, value: unknown) {
  return roundIndex === 0 ? normalizeIslandList(value) : normalizeGroup(value)
}

async function mergeLive(state: MoneyDropSpecialState) {
  const live = await readFormLiveState(state.liveKey)
  return {
    ...state,
    rounds: state.rounds.map(round => {
      const liveRound = live.rounds[String(round.index)]
      if (!liveRound) return round
      return {
        ...round,
        value: liveRound.values?.[0] ?? round.value,
        confirmed: liveRound.confirmed === true,
        locked: liveRound.locked === true,
        saving: liveRound.saving === true,
        error: liveRound.error || '',
      }
    }),
  }
}

export async function POST(req: Request) {
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const action = String(payload.action || 'read')
  const formKey = String(payload.formKey || '').trim()
  if (!formKey) return jsonError('Missing formKey', 400)

  try {
    if (action === 'read') {
      const data = await callGas<{ state: MoneyDropSpecialState }>({
        action: 'readMoneyDropSpecial',
        formKey,
      })
      return NextResponse.json({ ok: true, state: await mergeLive(data.state) }, {
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    if (action !== 'write') return jsonError('Unknown action', 400)

    const roundIndex = Number(payload.roundIndex)
    if (!Number.isInteger(roundIndex) || roundIndex < 0 || roundIndex > 1) {
      return jsonError('Invalid round', 400)
    }

    const value = normalizeValue(roundIndex, payload.value)
    if (!value) {
      return jsonError(roundIndex === 0 ? 'Please enter island names like A2, B3, C9.' : 'Please enter only A, B, or C.', 400)
    }

    const liveKey = specialLiveKey(formKey)
    const isAdmin = payload.admin === true
    try {
      await claimAndPublishFormRoundSubmit(liveKey, roundIndex, isAdmin, {
        locked: true,
        saving: true,
        error: '',
        values: [value],
      })
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 409)
    }

    let email = ''
    if (payload.oauth === true) {
      const session = await auth()
      email = session?.user?.email ?? ''
      if (!session?.user || !isAllowedDocChulaEmail(email)) {
        await releaseFormRoundSubmitClaim(liveKey, roundIndex)
        return jsonError('Unauthorized', 401)
      }
    }

    after(() => persistMoneyDropSpecial({ payload, formKey, liveKey, roundIndex, value, email }))
    return NextResponse.json({ ok: true, queued: true, message: 'Sending to sheet...' }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error))
  }
}

async function persistMoneyDropSpecial({
  payload,
  formKey,
  liveKey,
  roundIndex,
  value,
  email,
}: {
  payload: Record<string, unknown>
  formKey: string
  liveKey: string
  roundIndex: number
  value: string
  email: string
}) {
  try {
    await callGas({
      action: payload.oauth === true ? 'writeMoneyDropSpecialOAuth' : 'writeMoneyDropSpecial',
      formKey,
      password: payload.password ?? '',
      oauth: payload.oauth === true,
      admin: payload.admin === true,
      email,
      roundIndex,
      value,
    })
    await publishFormRoundPatch(liveKey, [{
      index: roundIndex,
      confirmed: true,
      locked: false,
      saving: false,
      error: '',
      values: [value],
    }])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await releaseFormRoundSubmitClaim(liveKey, roundIndex).catch(() => undefined)
    await publishFormRoundPatch(liveKey, [{
      index: roundIndex,
      locked: false,
      saving: false,
      error: message,
    }]).catch(() => undefined)
  }
}
