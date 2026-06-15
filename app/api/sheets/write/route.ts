import { after, NextResponse } from 'next/server'
import {
  classifyBiddingWriteMode,
  deleteBiddingPendingWrite,
  isBiddingPendingWriteCurrent,
  markBiddingPendingWriteFailed,
  publishBiddingPendingWrite,
  type BiddingWriteMode,
} from '@/lib/biddingLive'
import { callGas } from '@/lib/gas'
import type { WritePayload } from '@/lib/sheets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type GasWriteResponse = {
  status?: string
  message?: string
  [key: string]: unknown
}

const SHEET_WRITE_RETRY_DELAYS_MS = [700, 900, 1600, 3000]
const writeQueues = (globalThis as typeof globalThis & {
  __biddingWriteQueues?: Map<string, Promise<void>>
}).__biddingWriteQueues ??= new Map<string, Promise<void>>()

function jsonError(message: string, status = 500) {
  return NextResponse.json({ ok: false, message }, { status })
}

function statusForGasError(message: string) {
  return /busy|retry|lock|timeout|timed out/i.test(message) ? 503 : 400
}

function isHouseNumber(value: unknown) {
  const numberValue = Number(value)
  return Number.isInteger(numberValue) && numberValue >= 1 && numberValue <= 12
}

function isWritePayload(payload: unknown): payload is WritePayload {
  if (!payload || typeof payload !== 'object') return false
  const raw = payload as Partial<WritePayload>
  return raw.action === 'writeWave'
    && Number.isInteger(Number(raw.wave))
    && Number(raw.wave) >= 1
    && isHouseNumber(raw.baan)
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function shouldRetryGasWrite(message: string) {
  return /busy|retry|lock|timeout|timed out|temporarily/i.test(message)
}

function newClientId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function writeQueueKey(payload: WritePayload, mode: BiddingWriteMode) {
  return `${payload.wave}:${payload.baan}:${mode}`
}

function queuePersistWriteWave(payload: WritePayload, mode: BiddingWriteMode) {
  const key = writeQueueKey(payload, mode)
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => persistWriteWave(payload, mode))
    .finally(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key)
    })
  writeQueues.set(key, next)
  return next
}

async function persistWriteWave(payload: WritePayload, mode: BiddingWriteMode) {
  let lastMessage = ''
  let lastRetryable = false
  const clientId = String(payload.clientId || '').trim()

  for (let attempt = 0; attempt < SHEET_WRITE_RETRY_DELAYS_MS.length; attempt++) {
    const delay = SHEET_WRITE_RETRY_DELAYS_MS[attempt]
    if (delay) await wait(delay)
    if (clientId && !await isBiddingPendingWriteCurrent(payload.wave, payload.baan, mode, clientId)) {
      return
    }

    try {
      await callGas<GasWriteResponse>({ ...payload })
      if (clientId && !await isBiddingPendingWriteCurrent(payload.wave, payload.baan, mode, clientId)) {
        return
      }
      await deleteBiddingPendingWrite(payload.wave, payload.baan, mode)
      return
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error)
      lastRetryable = shouldRetryGasWrite(lastMessage)
      if (!lastRetryable) break
    }
  }

  if (lastRetryable) {
    console.error('Bid/bet background write is still pending after a retryable GAS error:', lastMessage)
    return
  }

  console.error('Bid/bet background write failed:', lastMessage || 'Unknown error')
  if (clientId && !await isBiddingPendingWriteCurrent(payload.wave, payload.baan, mode, clientId)) {
    return
  }
  await markBiddingPendingWriteFailed(payload.wave, payload.baan, mode, lastMessage || 'Google Sheet write failed')
}

export async function POST(req: Request) {
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return jsonError('Invalid JSON payload', 400)
  }

  if (!isWritePayload(payload)) {
    return jsonError('Invalid sheet write action', 400)
  }

  try {
    const mode = classifyBiddingWriteMode(payload)
    const clientId = String((payload as { clientId?: unknown }).clientId || newClientId()).trim()
    const writePayload: WritePayload = { ...payload, clientId }
    await publishBiddingPendingWrite(writePayload, mode, clientId)
    after(() => queuePersistWriteWave(writePayload, mode))

    return NextResponse.json({
      ok: true,
      queued: true,
      saving: true,
      clientId,
      message: 'Sending to sheet...',
    }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonError(message, statusForGasError(message))
  }
}
