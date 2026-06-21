import { NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import {
  claimAndPublishFormRoundSubmit,
  FORM_SUBMIT_IN_PROGRESS_MESSAGE,
  isFreshFormControlRound,
  isFormLiveRoundSavingStale,
  publishFormRoundPatch,
  publishFormRoundSavedSignal,
  readFormLiveState,
  releaseFormRoundSubmitClaim,
} from '@/lib/formLive'
import { callGas } from '@/lib/gas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type MoneyDropSpecialRound = {
  index: number
  label: string
  wave: 2 | 4
  value: string
  confirmed: boolean
  locked: boolean
  saving?: boolean
  error?: string
  deadlineAt?: string
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

function statusForWriteError(message: string) {
  if (/unauthorized/i.test(message)) return 401
  if (/already confirmation|already confirmed|already sending/i.test(message)) return 409
  return /busy|retry|lock|timeout|timed out/i.test(message) ? 503 : 400
}

function normalizeIslandList(value: unknown) {
  const areas = String(value ?? '')
    .toUpperCase()
    .match(/[ABC]\s*[1-9]/g)
    ?.map(item => item.replace(/\s+/g, '')) ?? []
  return Array.from(new Set(areas)).join(', ')
}

function normalizeGroup(value: unknown) {
  const groups = String(value ?? '')
    .toUpperCase()
    .split(/[\s,|/]+/)
    .map(item => item.trim())
    .filter(item => /^[ABC]$/.test(item))
  return Array.from(new Set(groups)).join(', ')
}

function normalizeValue(roundIndex: number, value: unknown) {
  return roundIndex === 0 ? normalizeIslandList(value) : normalizeGroup(value)
}

function fallbackSpecialRound(index: number): MoneyDropSpecialRound {
  return {
    index,
    label: index === 0 ? 'Wave 2' : 'Wave 4',
    wave: index === 0 ? 2 : 4,
    value: '',
    confirmed: false,
    locked: false,
    saving: false,
    error: '',
    deadlineAt: '',
  }
}

function normalizeSpecialState(state: MoneyDropSpecialState | null | undefined, formKey: string): MoneyDropSpecialState {
  const rawRounds = Array.isArray(state?.rounds) ? state.rounds : []
  const rounds = [0, 1].map(index => {
    const rawRound = rawRounds[index]
    const fallback = fallbackSpecialRound(index)
    if (!rawRound || typeof rawRound !== 'object') return fallback
    const item = rawRound as Partial<MoneyDropSpecialRound>
    return {
      ...fallback,
      label: String(item.label || fallback.label),
      wave: item.wave === 4 ? 4 : fallback.wave,
      value: String(item.value || ''),
      confirmed: item.confirmed === true,
      locked: item.locked === true,
      saving: item.saving === true,
      error: String(item.error || ''),
      deadlineAt: String(item.deadlineAt || ''),
    }
  })
  return {
    formKey: String(state?.formKey || formKey),
    liveKey: String(state?.liveKey || specialLiveKey(formKey)),
    rounds,
  }
}

async function mergeLive(state: MoneyDropSpecialState) {
  state = normalizeSpecialState(state, state.formKey)
  const sheetState = {
    ...state,
    rounds: state.rounds.map(round => ({
      ...round,
      confirmed: round.confirmed === true,
      saving: false,
      error: '',
    })),
  }
  let live = await readFormLiveState(sheetState.liveKey)
  const staleSavingPatches = sheetState.rounds.flatMap(round => {
    const liveRound = live.rounds[String(round.index)]
    if (!isFormLiveRoundSavingStale(liveRound)) return []
    return [{
      index: round.index,
      confirmed: round.confirmed === true,
      locked: round.locked === true,
      saving: false,
      error: '',
      deadlineAt: round.deadlineAt || '',
      values: [round.value],
    }]
  })
  if (staleSavingPatches.length) {
    await Promise.all(staleSavingPatches.map(patch => releaseFormRoundSubmitClaim(sheetState.liveKey, patch.index)))
    await publishFormRoundPatch(sheetState.liveKey, staleSavingPatches)
    live = await readFormLiveState(sheetState.liveKey)
  }
  return {
    ...sheetState,
    rounds: sheetState.rounds.map(round => {
      const liveRound = live.rounds[String(round.index)]
      if (!liveRound) return round
      const saving = liveRound.saving === true && !isFormLiveRoundSavingStale(liveRound)
      if (!saving) {
        if (!isFreshFormControlRound(liveRound)) return round
        if (!String(round.value || '').trim()) {
          return {
            ...round,
            confirmed: false,
            locked: false,
            saving: false,
            error: '',
          }
        }
        return {
          ...round,
          confirmed: liveRound.confirmed === true,
          locked: liveRound.locked === true,
          saving: false,
          error: liveRound.error || '',
        }
      }
      return {
        ...round,
        value: liveRound.values?.[0] ?? round.value,
        locked: true,
        saving,
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
    if (!Number.isInteger(roundIndex) || roundIndex < 0 || roundIndex > 1) return jsonError('Invalid round', 400)

    const value = normalizeValue(roundIndex, payload.value)
    if (!value) {
      return jsonError(roundIndex === 0 ? 'Please enter island names like A2, B3, C9.' : 'Please enter A, B, C, or multiple groups like A, B.', 400)
    }

    const liveKey = specialLiveKey(formKey)
    const isAdmin = payload.admin === true
    let claimed = false

    try {
      await claimAndPublishFormRoundSubmit(liveKey, roundIndex, isAdmin, {
        locked: true,
        saving: true,
        error: '',
        values: [value],
      })
      claimed = true

      let email = ''
      if (payload.oauth === true) {
        const session = await auth()
        email = session?.user?.email ?? ''
        if (!session?.user || !isAllowedDocChulaEmail(email)) throw new Error('Unauthorized')
      }

      const data = await callGas<{ status: string; message?: string; roundIndex?: number; value?: string }>({
        action: payload.oauth === true ? 'writeMoneyDropSpecialOAuth' : 'writeMoneyDropSpecial',
        formKey,
        password: payload.password ?? '',
        oauth: payload.oauth === true,
        admin: payload.admin === true,
        email,
        roundIndex,
        value,
      })

      await publishFormRoundSavedSignal(liveKey, roundIndex, {
        confirmed: true,
        locked: false,
      })

      return NextResponse.json({
        ok: true,
        confirmed: true,
        message: data.message || 'Saved to sheet',
        roundIndex,
        value,
      }, {
        headers: { 'Cache-Control': 'no-store' },
      })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const message = rawMessage === FORM_SUBMIT_IN_PROGRESS_MESSAGE
        ? 'This input is already sending. Please wait.'
        : rawMessage

      if (claimed) {
        await releaseFormRoundSubmitClaim(liveKey, roundIndex).catch(() => undefined)
        await publishFormRoundPatch(liveKey, [{
          index: roundIndex,
          locked: false,
          saving: false,
          error: message,
        }]).catch(() => undefined)
      }
      return jsonError(message, statusForWriteError(message))
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : String(error))
  }
}
