import { NextResponse } from 'next/server'
import { auth, isAllowedDocChulaEmail } from '@/auth'
import { cacheFormAdminPassword, readCachedFormAdminPassword } from '@/lib/formAdminAuthCache'
import { publishFormRoundPatch, publishFullFormState } from '@/lib/formLive'
import { isOAuthAdmin } from '@/lib/formPermissions'
import { callGas } from '@/lib/gas'
import { normalizeScoringFormState, type ScoringFormState } from '@/lib/forms'
import { readOAuthProfile } from '@/lib/oauthProfile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type ControlTarget = {
  formKey?: unknown
  roundCount?: unknown
}

type ResolvedControlTarget = {
  formKey: string
  rounds: number[]
  allRounds: boolean
}

type ControlPatch = {
  confirmed?: boolean
  locked?: boolean
  deadlineAt?: string
}

type MoneyDropSpecialState = {
  formKey: string
  liveKey: string
  rounds: Array<{
    index: number
    confirmed: boolean
    locked: boolean
    deadlineAt?: string
  }>
}

type AdminContext = {
  oauth: boolean
  email: string
  password: string
}

export async function POST(req: Request) {
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const admin = await assertAdmin(payload)

    const patch = controlPatchFromPayload(payload)
    if (!patch) {
      return NextResponse.json({ ok: false, message: 'No control change supplied' }, { status: 400 })
    }

    const targets = controlTargetsFromPayload(payload)
    if (!targets.length) {
      return NextResponse.json({ ok: false, message: 'Invalid round' }, { status: 400 })
    }

    const states: Record<string, ScoringFormState> = {}
    for (const target of targets) {
      if (isMoneyDropSpecialLiveKey(target.formKey)) {
        await persistMoneyDropSpecialControlTarget(payload, admin, target, patch)
        continue
      }

      const result = await persistFormControlTarget(payload, admin, target)
      if (result.state) {
        const state = normalizeScoringFormState(result.state)
        states[target.formKey] = state
        await publishFullFormState(state)
      } else {
        await publishFormRoundPatch(
          target.formKey,
          target.rounds.map(index => ({ index, ...patch })),
        )
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Updated',
      data: {
        patch,
        targets,
        states,
        state: Object.keys(states).length === 1 ? Object.values(states)[0] : undefined,
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, message }, { status: /unauthorized/i.test(message) ? 401 : 400 })
  }
}

async function assertAdmin(payload: Record<string, unknown>): Promise<AdminContext> {
  if (payload.oauth === true) {
    const session = await auth()
    const email = session?.user?.email ?? ''
    if (!session?.user || !isAllowedDocChulaEmail(email)) {
      throw new Error('Unauthorized')
    }
    const profile = await readOAuthProfile(email)
    if (!isOAuthAdmin(profile)) throw new Error('Unauthorized')
    return { oauth: true, email, password: '' }
  }

  const password = String(payload.password ?? '')
  if (await readCachedFormAdminPassword(password)) return { oauth: false, email: '', password }

  await callGas({
    action: 'authFormUser',
    admin: true,
    password,
  })
  await cacheFormAdminPassword(password)
  return { oauth: false, email: '', password }
}

function controlTargetsFromPayload(payload: Record<string, unknown>): ResolvedControlTarget[] {
  const rawTargets = Array.isArray(payload.targets) ? payload.targets as ControlTarget[] : []
  const targets = rawTargets.length
    ? rawTargets
    : [{
      formKey: payload.formKey,
      roundCount: payload.roundCount,
    }]

  return targets.flatMap<ResolvedControlTarget>(target => {
    const formKey = String(target.formKey ?? '').trim()
    if (!formKey) return []

    const allRounds = payload.allRounds === true || rawTargets.length > 0
    if (!allRounds) {
      const roundIndex = Number(payload.roundIndex)
      if (!Number.isInteger(roundIndex) || roundIndex < 0) return []
      return [{ formKey, rounds: [roundIndex], allRounds: false }]
    }

    const roundCount = Math.max(1, Math.min(24, Math.floor(Number(target.roundCount) || 0)))
    if (!roundCount) return []
    return [{
      formKey,
      rounds: Array.from({ length: roundCount }, (_, index) => index),
      allRounds: true,
    }]
  })
}

function controlPatchFromPayload(payload: Record<string, unknown>): ControlPatch | null {
  const patch: ControlPatch = {}
  if (payload.confirmed !== undefined) patch.confirmed = payload.confirmed === true
  if (payload.locked !== undefined) patch.locked = payload.locked === true
  if (payload.clearDeadline === true) patch.deadlineAt = ''
  if (payload.deadlineMinutes !== undefined) {
    const minutes = Math.max(1, Math.min(240, Number(payload.deadlineMinutes) || 10))
    patch.deadlineAt = new Date(Date.now() + minutes * 60000).toISOString()
  }
  return Object.keys(patch).length ? patch : null
}

function gasControlPatchFromPayload(payload: Record<string, unknown>) {
  const patch: Record<string, unknown> = {}
  if (payload.confirmed !== undefined) patch.confirmed = payload.confirmed === true
  if (payload.locked !== undefined) patch.locked = payload.locked === true
  if (payload.clearDeadline === true) patch.clearDeadline = true
  if (payload.deadlineMinutes !== undefined) patch.deadlineMinutes = payload.deadlineMinutes
  return patch
}

function isMoneyDropSpecialLiveKey(formKey: string) {
  return formKey.endsWith('::money-drop-special')
}

function moneyDropSpecialBaseFormKey(liveKey: string) {
  return liveKey.slice(0, -'::money-drop-special'.length)
}

async function persistFormControlTarget(
  payload: Record<string, unknown>,
  admin: AdminContext,
  target: ResolvedControlTarget,
) {
  return await callGas<{
    status: string
    message?: string
    state?: ScoringFormState
  }>({
    action: admin.oauth ? 'setFormRoundControlOAuth' : 'setFormRoundControl',
    formKey: target.formKey,
    password: admin.password,
    email: admin.email,
    oauth: admin.oauth,
    allRounds: target.allRounds,
    roundIndex: target.allRounds ? undefined : target.rounds[0],
    ...gasControlPatchFromPayload(payload),
  })
}

async function persistMoneyDropSpecialControlTarget(
  payload: Record<string, unknown>,
  admin: AdminContext,
  target: ResolvedControlTarget,
  patch: ControlPatch,
) {
  const formKey = moneyDropSpecialBaseFormKey(target.formKey)
  for (const roundIndex of target.rounds) {
    const result = await callGas<{
      status: string
      message?: string
      state?: MoneyDropSpecialState
    }>({
      action: admin.oauth ? 'setMoneyDropSpecialControlOAuth' : 'setMoneyDropSpecialControl',
      formKey,
      password: admin.password,
      email: admin.email,
      oauth: admin.oauth,
      roundIndex,
      ...gasControlPatchFromPayload(payload),
    })
    const rounds = result.state?.rounds?.length
      ? result.state.rounds
      : target.rounds.map(index => ({ index, ...patch }))
    await publishFormRoundPatch(
      target.formKey,
      rounds.map(round => ({
        index: round.index,
        confirmed: round.confirmed,
        locked: round.locked,
        deadlineAt: round.deadlineAt || '',
        saving: false,
        error: '',
        values: [],
      })),
    )
  }
}
