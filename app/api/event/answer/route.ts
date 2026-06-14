import { after, NextResponse } from 'next/server'
import { cacheAccessSession, isCachedAccessSession } from '@/lib/accessSessionCache'
import {
  deleteEventPendingAnswer,
  eventAnswerOptions,
  getCachedEventAnswers,
  mergeEventPendingIntoStatus,
  normalizeEventAnswer,
  normalizeEventBaan,
  normalizeEventWave,
  publishEventPendingAnswer,
  readEventStatusCache,
  writeEventStatusCache,
  type EventRank,
} from '@/lib/eventLive'
import { callGas } from '@/lib/gas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type EventAnswerPayload = { wave?: number; baan?: number; answer?: string; token?: string }

type EventAnswerGasResponse = {
  status: string
  correct?: boolean
  alreadyCorrect?: boolean
  rank?: number | null
  results?: EventRank[]
  answers?: string[]
  answerOptions?: string[]
  answer?: string
  message?: string
}

function statusForError(message: string) {
  if (/unauthorized/i.test(message)) return 401
  return /busy|retry|lock|timeout|timed out/i.test(message) ? 503 : 400
}

async function ensureBaanSession(baan: number, token: string) {
  const session = { kind: 'baan', baan, token }
  if (await isCachedAccessSession(session)) return

  const data = await callGas<{ status: string; ok?: boolean; token?: string; message?: string }>({
    action: 'authAccess',
    kind: 'baan',
    mode: 'session',
    baan,
    token,
  })
  if (data.ok !== true) throw new Error(data.message || 'Unauthorized')
  await cacheAccessSession(session)
}

async function loadEventAnswers(wave: number) {
  const data = await callGas<EventAnswerGasResponse>({
    action: 'readEventAnswer',
    wave,
  })
  if (Array.isArray(data.answers)) return data.answers
  if (Array.isArray(data.answerOptions)) return data.answerOptions
  return eventAnswerOptions(data.answer)
}

async function submitThroughGas(payload: Required<EventAnswerPayload>) {
  return await callGas<EventAnswerGasResponse>({
    action: 'submitEventAnswer',
    wave: payload.wave,
    baan: payload.baan,
    answer: payload.answer,
    token: payload.token,
  })
}

async function persistEventAnswer({
  wave,
  baan,
  answer,
  token,
  submittedAt,
}: {
  wave: number
  baan: number
  answer: string
  token: string
  submittedAt: string
}) {
  try {
    let data: EventAnswerGasResponse
    try {
      data = await callGas<EventAnswerGasResponse>({
        action: 'writeEventAnswerResult',
        wave,
        baan,
        submittedAt,
        token,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/unknown action/i.test(message)) throw error
      data = await submitThroughGas({ wave, baan, answer, token })
    }

    const existingStatus = await readEventStatusCache(wave)
    await writeEventStatusCache(wave, {
      ...(existingStatus?.status ?? {}),
      status: 'ok',
      wave,
      results: Array.isArray(data.results) ? data.results : existingStatus?.status.results ?? [],
    })
    await deleteEventPendingAnswer(wave, baan)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timed out/i.test(message)) {
      console.error('Event answer background write timed out; leaving Redis pending for sheet verification:', message)
      return
    }
    console.error('Event answer background write failed:', message)
    await deleteEventPendingAnswer(wave, baan)
  }
}

export async function POST(req: Request) {
  let payload: EventAnswerPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ status: 'error', message: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const wave = normalizeEventWave(payload.wave)
    const baan = normalizeEventBaan(payload.baan)
    const answer = String(payload.answer ?? '').trim()
    const token = String(payload.token ?? '').trim()
    if (!wave) return NextResponse.json({ status: 'error', message: 'Event is available only in wave 2 or wave 4' }, { status: 400 })
    if (!baan) return NextResponse.json({ status: 'error', message: 'Invalid house' }, { status: 400 })
    if (!normalizeEventAnswer(answer)) return NextResponse.json({ status: 'error', message: 'Answer is blank' }, { status: 400 })

    await ensureBaanSession(baan, token)

    let correctOptions: string[]
    try {
      correctOptions = await getCachedEventAnswers(wave, () => loadEventAnswers(wave))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/unknown action/i.test(message)) throw error
      const data = await submitThroughGas({ wave, baan, answer, token })
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (!correctOptions.length) return NextResponse.json({ status: 'error', message: 'Correct answer is not configured' }, { status: 500 })
    if (!correctOptions.includes(normalizeEventAnswer(answer))) {
      return NextResponse.json({ status: 'ok', correct: false, message: 'Wrong answer' }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const statusCache = await readEventStatusCache(wave)
    const cachedStatus = statusCache?.status ?? { status: 'ok', wave, results: [] }
    const mergedStatus = await mergeEventPendingIntoStatus(wave, cachedStatus)
    const submittedAt = new Date().toISOString()
    const { rank, results } = await publishEventPendingAnswer(wave, baan, submittedAt, mergedStatus.results ?? [])
    after(() => persistEventAnswer({ wave, baan, answer, token, submittedAt }))

    return NextResponse.json({
      status: 'ok',
      correct: true,
      queued: true,
      saving: true,
      rank,
      results,
      message: 'Saving to sheet...',
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ status: 'error', message }, { status: statusForError(message) })
  }
}
