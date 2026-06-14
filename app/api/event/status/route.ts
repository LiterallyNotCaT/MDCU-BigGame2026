import { NextResponse } from 'next/server'
import {
  eventAnswerOptions,
  mergeEventPendingIntoStatus,
  normalizeEventWave,
  warmEventAnswers,
  writeEventStatusCache,
  type EventSafeStatus,
} from '@/lib/eventLive'
import { callGas } from '@/lib/gas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const wave = normalizeEventWave(url.searchParams.get('wave'))
  if (!wave) return NextResponse.json({ status: 'error', message: 'Event is available only in wave 2 or wave 4' }, { status: 400 })
  try {
    const data = await callGas<EventSafeStatus>({
      action: 'readEventStatus',
      wave,
      includeSolutionImage: false,
    })
    const { solutionImage: _solutionImage, questionImage: _questionImage, ...safeData } = data ?? {}
    await writeEventStatusCache(wave, safeData)
    await warmEventAnswers(wave, async () => {
      const answerData = await callGas<{ answers?: string[]; answerOptions?: string[]; answer?: string }>({
        action: 'readEventAnswer',
        wave,
      })
      if (Array.isArray(answerData.answers)) return answerData.answers
      if (Array.isArray(answerData.answerOptions)) return answerData.answerOptions
      return eventAnswerOptions(answerData.answer)
    })
    const mergedData = await mergeEventPendingIntoStatus(wave, safeData)
    return NextResponse.json(mergedData, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ status: 'error', message }, { status: 500 })
  }
}
