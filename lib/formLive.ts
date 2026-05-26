import type { ScoringFormState } from '@/lib/forms'
import { redisGetJson, redisSetJson } from '@/lib/redisStore'

export type FormLiveRound = {
  confirmed: boolean
  locked: boolean
  deadlineAt: string
  updatedAt: string
}

export type FormLiveState = {
  formKey: string
  version: number
  updatedAt: string
  rounds: Record<string, FormLiveRound>
}

type RoundPatch = {
  index: number
  confirmed?: boolean
  locked?: boolean
  deadlineAt?: string
}

function formLiveKey(formKey: string) {
  return `biggame_form_live:${Buffer.from(String(formKey)).toString('base64url')}`
}

function normalizeLiveState(formKey: string, value: unknown): FormLiveState {
  const raw = value && typeof value === 'object' ? value as Partial<FormLiveState> : {}
  const rounds = raw.rounds && typeof raw.rounds === 'object' ? raw.rounds : {}
  return {
    formKey,
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    rounds: Object.entries(rounds).reduce<Record<string, FormLiveRound>>((next, [key, round]) => {
      if (!round || typeof round !== 'object') return next
      const item = round as Partial<FormLiveRound>
      next[key] = {
        confirmed: item.confirmed === true,
        locked: item.locked === true,
        deadlineAt: typeof item.deadlineAt === 'string' ? item.deadlineAt : '',
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
      }
      return next
    }, {}),
  }
}

export async function readFormLiveState(formKey: string) {
  const key = String(formKey || '').trim()
  if (!key) return normalizeLiveState('', null)
  return normalizeLiveState(key, await redisGetJson<FormLiveState>(formLiveKey(key)))
}

export async function publishFormRoundPatch(formKey: string, patches: RoundPatch[]) {
  const key = String(formKey || '').trim()
  if (!key || !patches.length) return

  const existing = await readFormLiveState(key)
  const now = new Date().toISOString()
  const version = Math.max(Date.now(), existing.version + 1)
  const rounds = { ...existing.rounds }

  for (const patch of patches) {
    if (!Number.isInteger(patch.index) || patch.index < 0) continue
    const previous = rounds[String(patch.index)] ?? {
      confirmed: false,
      locked: false,
      deadlineAt: '',
      updatedAt: '',
    }
    rounds[String(patch.index)] = {
      confirmed: patch.confirmed === undefined ? previous.confirmed : patch.confirmed === true,
      locked: patch.locked === undefined ? previous.locked : patch.locked === true,
      deadlineAt: patch.deadlineAt === undefined ? previous.deadlineAt : String(patch.deadlineAt || ''),
      updatedAt: now,
    }
  }

  await redisSetJson(formLiveKey(key), {
    formKey: key,
    version,
    updatedAt: now,
    rounds,
  } satisfies FormLiveState)
}

export async function mergeFormLiveIntoState(state: ScoringFormState | null | undefined) {
  if (!state?.form?.formKey) return state
  const live = await readFormLiveState(state.form.formKey)
  if (!live.version) {
    await seedFormLiveState(state)
    return state
  }

  return {
    ...state,
    rounds: state.rounds.map((round, index) => {
      const liveRound = live.rounds[String(index)]
      if (!liveRound) return round
      return {
        ...round,
        confirmed: liveRound.confirmed === true,
        locked: liveRound.locked === true,
        deadlineAt: liveRound.deadlineAt || '',
      }
    }),
  } satisfies ScoringFormState
}

export async function seedFormLiveState(state: ScoringFormState | null | undefined) {
  if (!state?.form?.formKey) return
  const existing = await readFormLiveState(state.form.formKey)
  if (existing.version > 0) return

  const patches = state.rounds
    .map((round, index) => ({
      index,
      confirmed: round.confirmed === true,
      locked: round.locked === true,
      deadlineAt: round.deadlineAt || '',
    }))
    .filter(patch => patch.confirmed || patch.locked || patch.deadlineAt)

  if (!patches.length) return
  await publishFormRoundPatch(state.form.formKey, patches)
}

export async function publishFormState(state: ScoringFormState | null | undefined) {
  await seedFormLiveState(state)
}

export async function assertFormRoundEditable(formKey: string, roundIndex: number, isAdmin: boolean) {
  if (isAdmin) return
  if (!formKey || !Number.isInteger(roundIndex) || roundIndex < 0) throw new Error('Invalid round')

  const live = await readFormLiveState(formKey)
  const round = live.rounds[String(roundIndex)]
  if (!round) return
  if (round.confirmed) throw new Error('This round is already confirmed')
  if (round.locked) throw new Error('This round is locked')
  if (round.deadlineAt) {
    const deadlineMs = new Date(round.deadlineAt).getTime()
    if (Number.isFinite(deadlineMs) && Date.now() > deadlineMs) {
      throw new Error('This round is timed out')
    }
  }
}

export async function mergeFormLiveIntoStates(states: Record<string, ScoringFormState>) {
  const entries = await Promise.all(
    Object.entries(states).map(async ([key, state]) => [key, await mergeFormLiveIntoState(state)] as const),
  )
  return entries.reduce<Record<string, ScoringFormState>>((next, [key, state]) => {
    if (state) next[key] = state
    return next
  }, {})
}

export async function publishFullFormState(state: ScoringFormState | null | undefined) {
  if (!state?.form?.formKey) return
  await publishFormRoundPatch(
    state.form.formKey,
    state.rounds.map((round, index) => ({
      index,
      confirmed: round.confirmed === true,
      locked: round.locked === true,
      deadlineAt: round.deadlineAt || '',
    })),
  )
}
