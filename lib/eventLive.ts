import { redisDeleteKey, redisGetJson, redisSetJsonWithTtl } from '@/lib/redisStore'

export type EventRank = {
  rank: number
  baan: number
  saving?: boolean
  submittedAt?: string
  time?: string
}

export type EventSafeStatus = {
  status?: string
  wave?: number
  questionReady?: boolean
  solutionVisible?: boolean
  results?: EventRank[]
  submitted?: Array<{ baan: number; time?: string; submittedAt?: string }>
  message?: string
  [key: string]: unknown
}

type EventAnswerCache = {
  wave: number
  answers: string[]
  updatedAt: string
}

type EventStatusCache = {
  wave: number
  status: EventSafeStatus
  updatedAt: string
}

type EventPendingAnswer = {
  baan: number
  submittedAt: string
  saving: boolean
  error: string
  updatedAt: string
}

type EventPendingState = {
  wave: number
  version: number
  updatedAt: string
  answers: Record<string, EventPendingAnswer>
}

const EVENT_ANSWER_TTL_SECONDS = 90
const EVENT_STATUS_TTL_SECONDS = 30
const EVENT_PENDING_TTL_SECONDS = 5 * 60
const EVENT_PENDING_STALE_MS = 90 * 1000
const EVENT_PENDING_EMPTY_SHEET_GRACE_MS = 25 * 1000

export function normalizeEventWave(value: unknown) {
  const wave = Number(value)
  return wave === 2 || wave === 4 ? wave : null
}

export function normalizeEventBaan(value: unknown) {
  const baan = Number(value)
  return Number.isInteger(baan) && baan >= 1 && baan <= 12 ? baan : null
}

export function normalizeEventAnswer(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function eventAnswerOptions(value: unknown) {
  return String(value || '')
    .split(/[\n,|/]+/)
    .map(normalizeEventAnswer)
    .filter(Boolean)
}

function eventAnswerKey(wave: number) {
  return `biggame_event_answer:${wave}`
}

function eventStatusKey(wave: number) {
  return `biggame_event_status:${wave}`
}

function eventPendingKey(wave: number) {
  return `biggame_event_pending:${wave}`
}

function normalizeRankList(value: unknown): EventRank[] {
  if (!Array.isArray(value)) return []
  const ranks: EventRank[] = []
  value.forEach((item, index) => {
    const raw = item && typeof item === 'object' ? item as Partial<EventRank> : {}
    const baan = normalizeEventBaan(raw.baan)
    const rankNumber = Number(raw.rank)
    if (!baan) return
    ranks.push({
      rank: Number.isFinite(rankNumber) && rankNumber > 0 ? Math.floor(rankNumber) : index + 1,
      baan,
      saving: raw.saving === true,
      submittedAt: typeof raw.submittedAt === 'string' ? raw.submittedAt : typeof raw.time === 'string' ? raw.time : '',
      time: typeof raw.time === 'string' ? raw.time : typeof raw.submittedAt === 'string' ? raw.submittedAt : '',
    })
  })
  return ranks.sort((a, b) => a.rank - b.rank || a.baan - b.baan)
}

function normalizeStatusCache(wave: number, value: unknown): EventStatusCache | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<EventStatusCache>
  const status = raw.status && typeof raw.status === 'object' ? raw.status as EventSafeStatus : null
  if (!status) return null
  return {
    wave,
    status: {
      ...status,
      results: normalizeRankList(status.results),
    },
    updatedAt: String(raw.updatedAt || ''),
  }
}

function normalizePendingState(wave: number, value: unknown): EventPendingState {
  const raw = value && typeof value === 'object' ? value as Partial<EventPendingState> : {}
  const rawAnswers = raw.answers && typeof raw.answers === 'object' ? raw.answers : {}
  const answers = Object.entries(rawAnswers).reduce<Record<string, EventPendingAnswer>>((next, [key, item]) => {
    if (!item || typeof item !== 'object') return next
    const rawItem = item as Partial<EventPendingAnswer>
    const baan = normalizeEventBaan(rawItem.baan ?? key)
    if (!baan) return next
    next[String(baan)] = {
      baan,
      submittedAt: String(rawItem.submittedAt || rawItem.updatedAt || ''),
      saving: rawItem.saving !== false,
      error: String(rawItem.error || ''),
      updatedAt: String(rawItem.updatedAt || rawItem.submittedAt || ''),
    }
    return next
  }, {})

  return {
    wave,
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    answers,
  }
}

async function readPendingState(wave: number) {
  return normalizePendingState(wave, await redisGetJson<EventPendingState>(eventPendingKey(wave)).catch(() => null))
}

async function writePendingState(wave: number, state: EventPendingState) {
  if (!Object.keys(state.answers).length) {
    await redisDeleteKey(eventPendingKey(wave)).catch(() => undefined)
    return
  }
  await redisSetJsonWithTtl(eventPendingKey(wave), state, EVENT_PENDING_TTL_SECONDS).catch(() => undefined)
}

export async function getCachedEventAnswers(wave: number, loader: () => Promise<string[]>) {
  const cached = await redisGetJson<EventAnswerCache>(eventAnswerKey(wave)).catch(() => null)
  if (cached?.wave === wave && Array.isArray(cached.answers) && cached.answers.length) {
    return cached.answers.map(normalizeEventAnswer).filter(Boolean)
  }

  const answers = (await loader()).map(normalizeEventAnswer).filter(Boolean)
  if (answers.length) {
    await redisSetJsonWithTtl(eventAnswerKey(wave), {
      wave,
      answers,
      updatedAt: new Date().toISOString(),
    }, EVENT_ANSWER_TTL_SECONDS).catch(() => undefined)
  }
  return answers
}

export async function warmEventAnswers(wave: number, loader: () => Promise<string[]>) {
  await getCachedEventAnswers(wave, loader).catch(() => undefined)
}

export async function readEventStatusCache(wave: number) {
  return normalizeStatusCache(wave, await redisGetJson<EventStatusCache>(eventStatusKey(wave)).catch(() => null))
}

export async function writeEventStatusCache(wave: number, status: EventSafeStatus) {
  await redisSetJsonWithTtl(eventStatusKey(wave), {
    wave,
    status: {
      ...status,
      results: normalizeRankList(status.results),
    },
    updatedAt: new Date().toISOString(),
  }, EVENT_STATUS_TTL_SECONDS).catch(() => undefined)
}

function isPendingStale(answer: EventPendingAnswer) {
  const updatedMs = new Date(answer.updatedAt || answer.submittedAt || '').getTime()
  return !Number.isFinite(updatedMs) || Date.now() - updatedMs > EVENT_PENDING_STALE_MS
}

function isPendingPastEmptySheetGrace(answer: EventPendingAnswer) {
  const updatedMs = new Date(answer.updatedAt || answer.submittedAt || '').getTime()
  return !Number.isFinite(updatedMs) || Date.now() - updatedMs > EVENT_PENDING_EMPTY_SHEET_GRACE_MS
}

function mergePendingResults(sheetResults: EventRank[], pending: EventPendingAnswer[]) {
  const safeSheet = normalizeRankList(sheetResults)
  const seen = new Set(safeSheet.map(item => item.baan))
  const next = [...safeSheet]
  pending
    .filter(item => item.saving && !item.error && !seen.has(item.baan))
    .sort((a, b) => {
      const aMs = new Date(a.submittedAt).getTime()
      const bMs = new Date(b.submittedAt).getTime()
      return (Number.isFinite(aMs) ? aMs : 0) - (Number.isFinite(bMs) ? bMs : 0) || a.baan - b.baan
    })
    .forEach(item => {
      seen.add(item.baan)
      next.push({ rank: next.length + 1, baan: item.baan, saving: true, submittedAt: item.submittedAt, time: item.submittedAt })
    })
  return next
}

export async function mergeEventPendingIntoStatus(wave: number, status: EventSafeStatus) {
  const sheetResults = normalizeRankList(status.results)
  const submittedBaans = new Set(
    (Array.isArray(status.submitted) ? status.submitted : [])
      .map(item => normalizeEventBaan(item?.baan))
      .filter((baan): baan is number => baan !== null),
  )
  const sheetBaans = new Set([...sheetResults.map(item => item.baan), ...submittedBaans])
  const sheetIsEmpty = sheetResults.length === 0 && submittedBaans.size === 0
  const pending = await readPendingState(wave)
  const keptAnswers: Record<string, EventPendingAnswer> = {}
  const pendingAnswers = Object.values(pending.answers).filter(answer => {
    if (sheetBaans.has(answer.baan)) return false
    if (isPendingStale(answer)) return false
    if (sheetIsEmpty && isPendingPastEmptySheetGrace(answer)) return false
    keptAnswers[String(answer.baan)] = answer
    return true
  })

  if (Object.keys(keptAnswers).length !== Object.keys(pending.answers).length) {
    await writePendingState(wave, {
      ...pending,
      version: Math.max(Date.now(), pending.version + 1),
      updatedAt: new Date().toISOString(),
      answers: keptAnswers,
    })
  }

  return {
    ...status,
    results: mergePendingResults(sheetResults, pendingAnswers),
  }
}

export async function publishEventPendingAnswer(wave: number, baan: number, submittedAt: string, sheetResults: EventRank[]) {
  const pending = await readPendingState(wave)
  const now = new Date().toISOString()
  const existing = pending.answers[String(baan)]
  const nextAnswer: EventPendingAnswer = existing?.submittedAt ? existing : {
    baan,
    submittedAt,
    saving: true,
    error: '',
    updatedAt: now,
  }
  const nextState: EventPendingState = {
    wave,
    version: Math.max(Date.now(), pending.version + 1),
    updatedAt: now,
    answers: {
      ...pending.answers,
      [String(baan)]: {
        ...nextAnswer,
        saving: true,
        error: '',
        updatedAt: now,
      },
    },
  }
  await writePendingState(wave, nextState)
  const results = mergePendingResults(sheetResults, Object.values(nextState.answers))
  const rank = results.find(item => item.baan === baan)?.rank ?? null
  return { rank, results }
}

export async function deleteEventPendingAnswer(wave: number, baan: number) {
  const pending = await readPendingState(wave)
  if (!pending.answers[String(baan)]) return
  const answers = { ...pending.answers }
  delete answers[String(baan)]
  await writePendingState(wave, {
    ...pending,
    version: Math.max(Date.now(), pending.version + 1),
    updatedAt: new Date().toISOString(),
    answers,
  })
}
