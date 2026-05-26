import { NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import { mergeFormLiveIntoState, publishFormRoundPatch, publishFullFormState } from '@/lib/formLive'
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
      if (payload.allRounds === true) {
      const data = await runLegacyCompatibleBulkControl(payload, true, email)
        await publishControlChange(payload, data)
        return NextResponse.json({ ok: true, message: data.message || 'Updated', data })
      }
      const data = await callOAuthGas({
        ...payload,
        email,
        action: 'setFormRoundControlOAuth',
      })
      await publishControlChange(payload, data)
      return NextResponse.json({ ok: true, message: data.message || 'Updated', data })
    }

    if (payload.allRounds === true) {
      const data = await runLegacyCompatibleBulkControl(payload, false)
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

async function runLegacyCompatibleBulkControl(payload: Record<string, unknown>, oauth: boolean, email = '') {
  const formKey = String(payload.formKey || '')
  const roundCount = Math.max(1, Math.min(24, Math.floor(Number(payload.roundCount) || 0)))
  if (!formKey || !roundCount) throw new Error('Invalid round')

  const controlPayload = {
    formKey,
    password: payload.password ?? '',
    confirmed: payload.confirmed,
    locked: payload.locked,
    clearDeadline: payload.clearDeadline,
    deadlineMinutes: payload.deadlineMinutes,
  }

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
    if (oauth) {
      await callOAuthGas({
        ...controlPayload,
        email,
        roundIndex,
        action: 'setFormRoundControlOAuth',
      })
    } else {
      await callGas({
        ...controlPayload,
        roundIndex,
        action: 'setFormRoundControl',
      })
    }
  }

  const state = await readStateAfterControl(formKey, oauth, email)
  return {
    status: 'ok',
    message: 'All form rounds are editable again',
    state: applyControlPayloadToState(state, payload),
  }
}

function applyControlPayloadToState(state: ScoringFormState | null | undefined, payload: Record<string, unknown>) {
  if (!state) return state
  const patch = controlPatchFromPayload(payload)
  if (!patch) return state
  const applyPatch = (round: ScoringFormState['rounds'][number]) => ({
    ...round,
    confirmed: patch.confirmed === undefined ? round.confirmed : patch.confirmed,
    locked: patch.locked === undefined ? round.locked : patch.locked,
    deadlineAt: patch.deadlineAt === undefined ? round.deadlineAt : patch.deadlineAt,
  })
  if (payload.allRounds === true) {
    return { ...state, rounds: state.rounds.map(applyPatch) }
  }
  const roundIndex = Number(payload.roundIndex)
  if (!Number.isInteger(roundIndex) || roundIndex < 0) return state
  return {
    ...state,
    rounds: state.rounds.map((round, index) => index === roundIndex ? applyPatch(round) : round),
  }
}

async function readStateAfterControl(formKey: string, oauth: boolean, email = '') {
  if (oauth) {
    try {
      const data = await callOAuthGas<{
        status: string
        states: Record<string, ScoringFormState>
      }>({
        action: 'readFormStatesOAuth',
        email,
        formKeys: [formKey],
      })
      const state = data.states?.[formKey]
      if (state) return await mergeFormLiveIntoState(state)
    } catch {
      // Fall back to the main form reader below.
    }
  }

  const stateData = await callGas<{ status: string; state: ScoringFormState }>({
    action: 'readFormState',
    formKey,
  })
  return await mergeFormLiveIntoState(stateData.state)
}

async function publishControlChange(payload: Record<string, unknown>, data: Record<string, unknown>) {
  try {
    const formKey = String(payload.formKey || '')
    const patch = controlPatchFromPayload(payload)
    if (formKey && patch) {
      if (payload.allRounds === true) {
        const roundCount = Math.max(1, Math.min(24, Math.floor(Number(payload.roundCount) || 0)))
        await publishFormRoundPatch(
          formKey,
          Array.from({ length: roundCount }, (_, index) => ({ index, ...patch })),
        )
        return
      }

      const roundIndex = Number(payload.roundIndex)
      if (!Number.isInteger(roundIndex) || roundIndex < 0) return
      await publishFormRoundPatch(formKey, [{ index: roundIndex, ...patch }])
      return
    }

    const returnedState = data.state as ScoringFormState | undefined
    if (returnedState?.form?.formKey) await publishFullFormState(returnedState)
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
