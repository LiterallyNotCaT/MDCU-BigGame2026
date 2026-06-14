import { redisDeleteKey, redisGetJson, redisSetJsonWithTtl } from '@/lib/redisStore'
import type { WaveInputRow, WaveInputsResult, WritePayload } from '@/lib/sheets'

export type BiddingWriteMode = 'bid' | 'bet' | 'select-disaster'

type BiddingPendingWrite = {
  clientId: string
  wave: number
  baan: number
  mode: BiddingWriteMode
  payload: WritePayload
  saving: boolean
  error: string
  submittedAt: string
  updatedAt: string
}

export type BiddingPendingSummary = Omit<BiddingPendingWrite, 'payload'> & {
  payload?: WritePayload
}

type BiddingPendingState = {
  wave: number
  version: number
  updatedAt: string
  writes: Record<string, BiddingPendingWrite>
}

const BIDDING_PENDING_TTL_SECONDS = 5 * 60
const BIDDING_PENDING_STALE_MS = 3 * 60 * 1000

function biddingPendingKey(wave: number) {
  return `biggame_bidding_pending:${wave}`
}

function pendingWriteKey(wave: number, baan: number, mode: BiddingWriteMode) {
  return `${wave}:${baan}:${mode}`
}

function isFreshPendingWrite(write: BiddingPendingWrite) {
  const updatedMs = new Date(write.updatedAt || write.submittedAt || '').getTime()
  return Number.isFinite(updatedMs) && Date.now() - updatedMs <= BIDDING_PENDING_STALE_MS
}

function normalizePendingState(wave: number, value: unknown): BiddingPendingState {
  const raw = value && typeof value === 'object' ? value as Partial<BiddingPendingState> : {}
  const rawWrites = raw.writes && typeof raw.writes === 'object' ? raw.writes : {}
  const writes = Object.entries(rawWrites).reduce<Record<string, BiddingPendingWrite>>((next, [key, item]) => {
    if (!item || typeof item !== 'object') return next
    const rawItem = item as Partial<BiddingPendingWrite>
    const mode = rawItem.mode === 'bet' || rawItem.mode === 'select-disaster' ? rawItem.mode : 'bid'
    const baan = Number(rawItem.baan)
    if (!Number.isInteger(baan) || baan < 1 || baan > 12) return next
    const payload = rawItem.payload && typeof rawItem.payload === 'object' ? rawItem.payload as WritePayload : null
    if (!payload || payload.action !== 'writeWave') return next
    const write: BiddingPendingWrite = {
      clientId: String(rawItem.clientId || key),
      wave,
      baan,
      mode,
      payload,
      saving: rawItem.saving !== false,
      error: String(rawItem.error || ''),
      submittedAt: String(rawItem.submittedAt || rawItem.updatedAt || ''),
      updatedAt: String(rawItem.updatedAt || rawItem.submittedAt || ''),
    }
    if (!isFreshPendingWrite(write)) return next
    next[pendingWriteKey(wave, baan, mode)] = write
    return next
  }, {})

  return {
    wave,
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    writes,
  }
}

async function readPendingState(wave: number) {
  return normalizePendingState(wave, await redisGetJson<BiddingPendingState>(biddingPendingKey(wave)).catch(() => null))
}

async function writePendingState(wave: number, state: BiddingPendingState) {
  if (!Object.keys(state.writes).length) {
    await redisDeleteKey(biddingPendingKey(wave)).catch(() => undefined)
    return
  }
  await redisSetJsonWithTtl(biddingPendingKey(wave), state, BIDDING_PENDING_TTL_SECONDS).catch(() => undefined)
}

export function classifyBiddingWriteMode(payload: WritePayload): BiddingWriteMode {
  if (payload.betTarget != null || payload.betAmount != null) return 'bet'
  if (payload.kingDisaster != null && !payload.kingAmount && !payload.islands?.length) return 'select-disaster'
  return 'bid'
}

function pendingSummary(write: BiddingPendingWrite): BiddingPendingSummary {
  return {
    clientId: write.clientId,
    wave: write.wave,
    baan: write.baan,
    mode: write.mode,
    saving: write.saving,
    error: write.error,
    submittedAt: write.submittedAt,
    updatedAt: write.updatedAt,
    payload: write.payload,
  }
}

export async function readBiddingPendingWrites(wave: number): Promise<BiddingPendingSummary[]> {
  const pending = await readPendingState(wave)
  return Object.values(pending.writes).map(pendingSummary)
}

export async function isBiddingPendingWriteCurrent(wave: number, baan: number, mode: BiddingWriteMode, clientId: string) {
  const pending = await readPendingState(wave)
  const write = pending.writes[pendingWriteKey(wave, baan, mode)]
  return write?.clientId === clientId && write.saving !== false
}

function modeAlreadyInSheet(row: WaveInputRow | undefined, mode: BiddingWriteMode, result: WaveInputsResult, payload: WritePayload) {
  if (mode === 'select-disaster') return result.kingDisaster != null && result.kingDisaster === payload.kingDisaster
  if (!row) return false
  if (mode === 'bet') {
    return row.hasBetInput
      && String(row.betTarget || '').trim() === String(payload.betTarget ?? '').trim()
      && Number(row.betAmount) === Number(payload.betAmount ?? 0)
  }
  if (payload.kingAmount != null && Number(row.kingAmount) !== Number(payload.kingAmount)) return false
  const pendingIslands = Array.isArray(payload.islands) ? payload.islands.slice(0, 3) : []
  if (pendingIslands.length) {
    const rowIslands = row.islands.filter(item => item.name && item.amount > 0)
    const sameIslands = pendingIslands.every((island, index) => {
      const existing = rowIslands[index]
      return existing
        && String(existing.name || '').trim().toUpperCase() === String(island.name || '').trim().toUpperCase()
        && Number(existing.amount) === Number(island.amount)
    })
    if (!sameIslands) return false
  }
  return row.hasBidInput
}

function applyPendingWriteToRow(row: WaveInputRow, write: BiddingPendingWrite) {
  row.pending = true
  row.saving = write.saving
  row.error = write.error
  row.pendingModes = Array.from(new Set([...(row.pendingModes ?? []), write.mode]))
  if (!write.saving && write.error) return

  if (write.mode === 'bet') {
    row.betTarget = String(write.payload.betTarget ?? row.betTarget ?? '')
    row.betAmount = Number(write.payload.betAmount ?? row.betAmount ?? 0)
    row.hasBetInput = Boolean(row.betTarget && row.betAmount)
    row.hasInput = row.hasInput || row.hasBetInput
    return
  }

  if (write.mode === 'bid') {
    if (write.payload.kingAmount != null) row.kingAmount = Number(write.payload.kingAmount)
    const islands = Array.isArray(write.payload.islands) ? write.payload.islands.slice(0, 3) : []
    if (islands.length) {
      row.islands = [
        ...islands.map((island, index) => ({
          name: String(island.name || '').trim().toUpperCase(),
          amount: Number(island.amount || 0),
          returnAmount: row.islands[index]?.returnAmount ?? 0,
        })),
        ...row.islands.slice(islands.length),
      ].slice(0, 3)
    }
    row.hasBidInput = row.kingAmount > 0 || row.islands.some(island => /^[ABC](?:[1-9])$/.test(island.name) && island.amount > 0)
    row.hasInput = row.hasInput || row.hasBidInput
  }
}

function cloneRow(row: WaveInputRow): WaveInputRow {
  return {
    ...row,
    islands: row.islands.map(island => ({ ...island })),
    adjustments: row.adjustments.map(adjustment => ({ ...adjustment })),
    pendingModes: row.pendingModes ? [...row.pendingModes] : undefined,
  }
}

function blankRow(baan: number): WaveInputRow {
  return {
    baan,
    balance: 0,
    currentBalance: 0,
    betTarget: '',
    betAmount: 0,
    betReturn: 0,
    kingAmount: 0,
    kingResult: '',
    islands: [],
    adjustments: [],
    hasInput: false,
    hasBetInput: false,
    hasBidInput: false,
  }
}

export async function mergeBiddingPendingIntoWaveInputs(wave: number, result: WaveInputsResult): Promise<WaveInputsResult> {
  const pending = await readPendingState(wave)
  const rowsByBaan = new Map(result.rows.map(row => [row.baan, cloneRow(row)]))
  const keptWrites: BiddingPendingSummary[] = []
  let kingDisaster = result.kingDisaster

  await Promise.all(Object.values(pending.writes).map(async write => {
    let row = rowsByBaan.get(write.baan)
    if (modeAlreadyInSheet(row, write.mode, { ...result, kingDisaster }, write.payload)) {
      await deleteBiddingPendingWrite(wave, write.baan, write.mode).catch(() => undefined)
      return
    }

    if (!row) {
      row = blankRow(write.baan)
      rowsByBaan.set(write.baan, row)
    }

    keptWrites.push(pendingSummary(write))
    applyPendingWriteToRow(row, write)
    if (write.mode === 'select-disaster' && write.saving && !write.error) {
      kingDisaster = write.payload.kingDisaster ?? kingDisaster
    }
  }))

  return {
    ...result,
    rows: Array.from(rowsByBaan.values()).sort((a, b) => a.baan - b.baan),
    kingDisaster,
    pendingWrites: keptWrites.sort((a, b) => a.baan - b.baan || a.mode.localeCompare(b.mode)),
  }
}

export async function publishBiddingPendingWrite(payload: WritePayload, mode: BiddingWriteMode, clientId: string) {
  const pending = await readPendingState(payload.wave)
  const now = new Date().toISOString()
  const key = pendingWriteKey(payload.wave, payload.baan, mode)
  await writePendingState(payload.wave, {
    wave: payload.wave,
    version: Math.max(Date.now(), pending.version + 1),
    updatedAt: now,
    writes: {
      ...pending.writes,
      [key]: {
        clientId,
        wave: payload.wave,
        baan: payload.baan,
        mode,
        payload,
        saving: true,
        error: '',
        submittedAt: now,
        updatedAt: now,
      },
    },
  })
  if (!await isBiddingPendingWriteCurrent(payload.wave, payload.baan, mode, clientId)) {
    throw new Error('Redis pending write unavailable')
  }
}

export async function deleteBiddingPendingWrite(wave: number, baan: number, mode: BiddingWriteMode) {
  const pending = await readPendingState(wave)
  const key = pendingWriteKey(wave, baan, mode)
  if (!pending.writes[key]) return
  const writes = { ...pending.writes }
  delete writes[key]
  await writePendingState(wave, {
    ...pending,
    version: Math.max(Date.now(), pending.version + 1),
    updatedAt: new Date().toISOString(),
    writes,
  })
}

export async function markBiddingPendingWriteFailed(wave: number, baan: number, mode: BiddingWriteMode, error: string) {
  const pending = await readPendingState(wave)
  const key = pendingWriteKey(wave, baan, mode)
  const existing = pending.writes[key]
  if (!existing) return
  await writePendingState(wave, {
    ...pending,
    version: Math.max(Date.now(), pending.version + 1),
    updatedAt: new Date().toISOString(),
    writes: {
      ...pending.writes,
      [key]: {
        ...existing,
        saving: false,
        error,
        updatedAt: new Date().toISOString(),
      },
    },
  })
}
