// ============================================================
// GOOGLE SHEETS — Read & Write
// ============================================================
// READ  : Google Visualization API (no auth needed, sheet must be public/shared)
// WRITE : Google Apps Script Web App (doPost) — see GAS code below
// ============================================================

import { SHEET_ID, getWaveSheetQuery } from './constants'

export { SHEET_ID } from './constants'

// Your deployed GAS Web App URL — set this after deploying the script
// See STEP 2 in the setup guide
const GAS_URL = process.env.NEXT_PUBLIC_GAS_URL ?? ''
const CHAT_GID = '398958693'
const REPORT_CHAT_GID = '1090774629'

// ── Column map (1-indexed, for reference) ──────────────────
// Wave sheet rows 5–16 = บ้าน 1–12
// Col A (1)  = บ้านที่
// Col B (2)  = เงินก่อน (calculated, read-only)
// Col C (3)  = Bet: บ้านที่เดิมพัน
// Col D (4)  = Bet: จำนวนเงิน
// Col F (6)  = King bid: จำนวนเงิน
// Col H (8)  = เกาะ 1: ชื่อเกาะ
// Col I (9)  = เกาะ 1: จำนวนเงิน
// Col K (11) = เกาะ 2: ชื่อเกาะ
// Col L (12) = เกาะ 2: จำนวนเงิน
// Col N (14) = เกาะ 3: ชื่อเกาะ
// Col O (15) = เกาะ 3: จำนวนเงิน

// ── GViz helper ────────────────────────────────────────────
async function fetchGViz(sheet: string): Promise<any[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheet)}&t=${Date.now()}`
  try {
    const text = await (await fetch(url, { cache: 'no-store' })).text()
    const js = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)?.[1]
    if (!js) return []
    const rows: any[] = JSON.parse(js)?.table?.rows ?? []
    return rows.map(r =>
      (r.c ?? []).map((cell: any) => (cell?.v != null ? String(cell.v) : ''))
    )
  } catch (e) {
    console.error(`fetchGViz(${sheet}):`, e)
    return []
  }
}

async function fetchWaveGViz(wave: number): Promise<any[][]> {
  return fetchWaveRangeGViz(wave)
}

async function fetchWaveRangeGViz(wave: number, range?: string): Promise<any[][]> {
  const rangeQuery = range ? `&range=${encodeURIComponent(range)}` : ''
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&${getWaveSheetQuery(wave)}${rangeQuery}&t=${Date.now()}`
  try {
    const text = await (await fetch(url, { cache: 'no-store' })).text()
    const js = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)?.[1]
    if (!js) return []
    const rows: any[] = JSON.parse(js)?.table?.rows ?? []
    return rows.map(r =>
      (r.c ?? []).map((cell: any) => (cell?.v != null ? String(cell.v) : ''))
    )
  } catch (e) {
    console.error(`fetchWaveGViz(${wave}${range ? `, ${range}` : ''}):`, e)
    return []
  }
}

function kingFromResultRows(rows: unknown[][]): number | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? []
    const flag = parseFloat(String(row?.[6] ?? '').replace(/,/g, '').trim())
    if (flag !== 1) continue
    const baan = parseInt(String(row?.[0] ?? '').trim())
    if (Number.isInteger(baan) && baan >= 1 && baan <= 12) return baan
    const rowMappedBaan = i + 1
    if (rowMappedBaan >= 1 && rowMappedBaan <= 12) return rowMappedBaan
  }
  return null
}

async function fetchWaveKingOwner(wave: number): Promise<number | null> {
  const rows = await fetchWaveRangeGViz(wave, 'A5:G16')
  return kingFromResultRows(rows)
}

async function fetchWaveViewingKing(wave: number): Promise<number | null> {
  const rows = await fetchWaveRangeGViz(wave, 'H20')
  return parseHouseNumber(rows?.[0]?.[0])
}

function parseHouseNumber(value: unknown) {
  const baan = parseInt(String(value ?? '').trim())
  if (Number.isInteger(baan) && baan >= 1 && baan <= 12) return baan
  return null
}

async function fetchGidRangeGViz(gid: string, range?: string): Promise<any[][]> {
  const rangeQuery = range ? `&range=${encodeURIComponent(range)}` : ''
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${encodeURIComponent(gid)}${rangeQuery}&t=${Date.now()}`
  try {
    const text = await (await fetch(url, { cache: 'no-store' })).text()
    const js = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)?.[1]
    if (!js) return []
    const rows: any[] = JSON.parse(js)?.table?.rows ?? []
    return rows.map(r =>
      (r.c ?? []).map((cell: any) => (cell?.f != null ? String(cell.f) : cell?.v != null ? String(cell.v) : ''))
    )
  } catch (e) {
    console.error(`fetchGidRangeGViz(${gid}${range ? `, ${range}` : ''}):`, e)
    return []
  }
}

// ── READ: Morning scoreboard ────────────────────────────────
export async function fetchMorningScores() {
  const rows = await fetchGViz('Recap Morning')
  return rows
    .filter(r => !isNaN(parseInt(r[0])))
    .map(r => ({
      baan:    parseInt(r[0]),
      morning: parseFloat(r[1]) || 0,
      betray:  parseFloat(r[2]) || 0,
      total:   parseFloat(r[3]) || 0,
    }))
}

// ── READ: Total scores ──────────────────────────────────────
export async function fetchTotalScores() {
  const rows = await fetchGViz('TOTALSCORE')
  return rows
    .filter(r => !isNaN(parseInt(r[0])) && parseInt(r[0]) >= 1)
    .map(r => ({
      baan:  parseInt(r[0]),
      score: parseFloat(r[1]) || 0,
      rank:  parseInt(r[2])   || 0,
    }))
}

// ── READ: Single wave data ─────────────────────────────────
// Returns balance for each house in that wave
export async function fetchWaveBalances(wave: number) {
  const rows = await fetchWaveGViz(wave)
  // Data rows start at index 4 (row 5 in sheet = index 4 after 0-based GViz)
  // Filter rows where col A is a number 1-12
  return rows
    .slice(4, 16)
    .filter(r => {
      const b = parseInt(r[0])
      return !isNaN(b) && b >= 1 && b <= 12
    })
    .map(r => ({
      baan:    parseInt(r[0]),
      balance: parseFloat(r[1]) || 0,   // Col B = เงินก่อน
    }))
}

export interface WaveInputRow {
  baan: number
  balance: number
  currentBalance: number
  betTarget: string
  betAmount: number
  betReturn: number
  kingAmount: number
  kingResult: string
  islands: Array<{ name: string; amount: number; returnAmount: number }>
  adjustments: Array<{ label: string; amount: number }>
  hasInput: boolean
  hasBetInput: boolean
  hasBidInput: boolean
  pending?: boolean
  saving?: boolean
  error?: string
  pendingModes?: string[]
}

export type WaveInputsResult = {
  rows: WaveInputRow[]
  king: number | null
  viewingKing: number | null
  kingDisaster: number | null
  pendingWrites?: Array<{
    clientId: string
    wave: number
    baan: number
    mode: string
    saving: boolean
    error: string
    submittedAt: string
    updatedAt: string
    payload?: WritePayload
  }>
}

export async function fetchRawWaveInputs(wave: number): Promise<WaveInputsResult> {
  const rows = await fetchWaveRangeGViz(wave, 'A5:U16')
  const numberAt = (row: string[], idx: number) => parseFloat(String(row[idx] ?? 0)) || 0
  const textAt = (row: string[], idx: number) => String(row[idx] ?? '').trim()
  const isFilled = (value: string) => value !== '' && value !== '-'
  const isAreaName = (value: string) => /^[ABC](?:[1-9])$/.test(value)
  const parsedRows = rows
    // Exact input range A5:U16. Do not read lower tables; they also contain 1-12.
    .filter(r => {
      const b = parseInt(textAt(r, 0))
      return !isNaN(b) && b >= 1 && b <= 12
    })
    .map(r => {
      const islandInputs = [
        { name: textAt(r, 7), amountText: textAt(r, 8), returnText: textAt(r, 9), amount: numberAt(r, 8), returnAmount: numberAt(r, 9) },
        { name: textAt(r, 10), amountText: textAt(r, 11), returnText: textAt(r, 12), amount: numberAt(r, 11), returnAmount: numberAt(r, 12) },
        { name: textAt(r, 13), amountText: textAt(r, 14), returnText: textAt(r, 15), amount: numberAt(r, 14), returnAmount: numberAt(r, 15) },
      ]
      const islands = islandInputs.map(({ name, amount, returnAmount }) => ({
        name,
        amount,
        returnAmount,
      }))
      const adjustments = [
        { label: 'MiniGame', amount: numberAt(r, 17) },
        { label: 'MoneyDrop', amount: numberAt(r, 18) },
        { label: 'Event', amount: numberAt(r, 19) },
      ].filter(x => x.amount)
      const betTarget = textAt(r, 2)
      const betAmount = numberAt(r, 3)
      const betAmountText = textAt(r, 3)
      const kingAmount = numberAt(r, 5)
      const kingAmountText = textAt(r, 5)
      // Submission status should mirror sheet ownership of the input cells:
      // Bet saved = C and D contain data. Bid saved = king bid F or any H:I/K:L/N:O pair.
      const hasBetInput = isFilled(betTarget) && isFilled(betAmountText)
      const hasKingBidInput = isFilled(kingAmountText)
      const hasIslandBidInput = islandInputs.some(x => isFilled(x.name) && isAreaName(x.name) && isFilled(x.amountText))
      const hasBidInput = hasKingBidInput || hasIslandBidInput
      const hasInput = Boolean(
        hasBetInput || hasBidInput
      )
      return {
        baan: parseInt(textAt(r, 0)),
        balance: numberAt(r, 1),
        currentBalance: numberAt(r, 20) || numberAt(r, 1),
        betTarget,
        betAmount,
        betReturn: numberAt(r, 4),
        kingAmount,
        kingResult: textAt(r, 6),
        islands,
        adjustments,
        hasInput,
        hasBetInput,
        hasBidInput,
      }
    })
  const parsed = Array.from(
    parsedRows.reduce((byBaan, row) => byBaan.set(row.baan, row), new Map<number, WaveInputRow>()).values()
  ).sort((a, b) => a.baan - b.baan)
  const [king, viewingKing, infoCell] = await Promise.all([
    fetchWaveKingOwner(wave),
    fetchWaveViewingKing(wave),
    fetchWaveRangeGViz(wave, 'H22'),
  ])
  let kingDisaster: number | null = parseInt(String(infoCell?.[0]?.[0] ?? '').trim())
  if (isNaN(kingDisaster)) kingDisaster = null
  return { rows: parsed, king, viewingKing, kingDisaster }
}

export async function fetchWaveInputs(wave: number): Promise<WaveInputsResult> {
  if (typeof window === 'undefined') return fetchRawWaveInputs(wave)

  const res = await fetch(`/api/sheets/wave-inputs?wave=${encodeURIComponent(String(wave))}`, {
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({} as { message?: string }))
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    throw new Error((data as { message?: string }).message || 'Failed to fetch wave inputs')
  }
  return data as WaveInputsResult
}

export interface GroupChatMessage {
  id: string
  chatId: string
  clientId?: string
  row: number
  timestamp: string
  dateKey: string
  dateLabel: string
  timeLabel: string
  sender: string
  baan: number | null
  message: string
  sendTo: string
  replyToId: string
  topic: string
  pending?: boolean
  error?: string
}

export type GroupChatActor = number | 'admin' | string

function cleanChatCell(value: unknown) {
  return String(value || '').replace(/\u00a0/g, ' ').trim()
}

function parseChatBaan(value: string) {
  const text = cleanChatCell(value)
  const match = text.match(/(?:baan|บ้าน)?\s*(\d{1,2})/i)
  const baan = Number(match?.[1] ?? text)
  return Number.isInteger(baan) && baan >= 1 && baan <= 12
    ? baan
    : null
}

function isAdminText(value: string) {
  const lower = cleanChatCell(value).toLowerCase()
  return lower === 'admin' || lower === 'unknown'
}

function isChatActorValue(value: string) {
  const text = cleanChatCell(value)
  const lower = text.toLowerCase()
  if (lower === 'admin' || lower === 'unknown') return true
  return parseChatBaan(text) != null
}

function splitChatTimestamp(value: string) {
  const text = cleanChatCell(value)
  const timeMatch = text.match(/(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)
  if (!timeMatch) return { dateText: text, timeText: '' }
  return {
    dateText: text.replace(timeMatch[1], '').trim(),
    timeText: timeMatch[1].trim(),
  }
}

function normalizeChatTarget(value: string) {
  const text = cleanChatCell(value)
  const lower = text.toLowerCase()
  if (!text || lower === 'public' || lower === 'all') return 'public'
  if (lower === 'admin') return 'admin'
  const baan = parseChatBaan(text)
  return baan != null ? String(baan) : text
}

function normalizeChatSender(value: string) {
  const text = cleanChatCell(value)
  const lower = text.toLowerCase()
  if (!text || lower === 'admin' || lower === 'unknown') return { sender: 'Admin', baan: null }
  const baan = parseChatBaan(text)
  if (baan != null) return { sender: String(baan), baan }
  return { sender: text, baan: null }
}

function normalizeChatTopic(value: string) {
  const text = cleanChatCell(value).toLowerCase()
  if (text === 'report') return 'report'
  return 'bid'
}

function parseSlashDate(text: string) {
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (!match) return null
  const first = Number(match[1])
  const second = Number(match[2])
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3])
  const month = first > 12 ? second : first
  const day = first > 12 ? first : second
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseSheetDate(value: string) {
  const text = cleanChatCell(value)
  const dateParts = text.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/)
  if (dateParts) {
    return new Date(
      Number(dateParts[1]),
      Number(dateParts[2]),
      Number(dateParts[3]),
      Number(dateParts[4] ?? 0),
      Number(dateParts[5] ?? 0),
      Number(dateParts[6] ?? 0),
    )
  }
  const slashDate = parseSlashDate(text)
  if (slashDate) return slashDate
  return new Date(text)
}

function chatDateParts(dateText: string) {
  const date = parseSheetDate(dateText)
  if (!Number.isNaN(date.getTime())) {
    return {
      dateKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    }
  }
  const fallback = String(dateText || '').trim()
  return {
    dateKey: fallback || 'unknown-date',
    dateLabel: fallback || 'Unknown date',
  }
}

function normalizeChatTime(value: string) {
  const text = cleanChatCell(value)
  const amPmParts = text.match(/^(1[0-2]|0?\d):([0-5]\d)\s*([AP]M)$/i)
  if (amPmParts) {
    const hour = Number(amPmParts[1])
    const normalizedHour = amPmParts[3].toUpperCase() === 'PM'
      ? hour === 12 ? 12 : hour + 12
      : hour === 12 ? 0 : hour
    return `${String(normalizedHour).padStart(2, '0')}:${amPmParts[2]}`
  }
  const timeParts = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (timeParts) return `${timeParts[1].padStart(2, '0')}:${timeParts[2]}`
  return text
}

export async function fetchGroupChatMessages(mode: 'bid' | 'report' = 'bid'): Promise<GroupChatMessage[]> {
  const topic = mode === 'report' ? 'report' : 'bid'
  const gid = topic === 'report' ? REPORT_CHAT_GID : CHAT_GID
  const rows = await fetchGidRangeGViz(gid, 'A2:G')
  const messages: GroupChatMessage[] = []
  for (let i = 0; i < rows.length; i++) {
    const colA = cleanChatCell(rows[i]?.[0] ?? '')
    const colB = cleanChatCell(rows[i]?.[1] ?? '')
    const colC = cleanChatCell(rows[i]?.[2] ?? '')
    const colD = cleanChatCell(rows[i]?.[3] ?? '')
    const colE = cleanChatCell(rows[i]?.[4] ?? '')
    const colF = cleanChatCell(rows[i]?.[5] ?? '')
    const colG = cleanChatCell(rows[i]?.[6] ?? '')
    let chatId = ''
    let dateText = ''
    let timeText = ''
    let baanRaw = ''
    let message = ''
    let sendTo = 'public'
    let replyToId = ''

    if (/^\d+$/.test(colA) && (colB || colC || colD || colE)) {
      chatId = colA
      dateText = colB
      timeText = colC
      baanRaw = colD
      message = colE
      sendTo = normalizeChatTarget(colF)
      replyToId = /^\d+$/.test(colG) ? colG : ''
    } else if (isChatActorValue(colC)) {
      chatId = String(i + 1)
      dateText = colA
      timeText = colB
      baanRaw = colC
      message = colD
    } else if (isChatActorValue(colB) && colC && (!isChatActorValue(colC) || !colD || /^\d+$/.test(colD))) {
      const split = splitChatTimestamp(colA)
      chatId = String(i + 1)
      dateText = split.dateText
      timeText = split.timeText
      baanRaw = colB
      message = colC
    } else {
      chatId = String(i + 1)
      dateText = colA
      timeText = colB
      baanRaw = colC
      message = colD
    }
    if (!dateText && !timeText && !baanRaw && !message) break
    const { sender, baan } = normalizeChatSender(baanRaw)
    const { dateKey, dateLabel } = chatDateParts(dateText)
    const timeLabel = normalizeChatTime(timeText)
    const timestamp = [dateText, timeText].filter(Boolean).join(' ')
    messages.push({
      id: chatId ? `chat-${chatId}` : `${i + 2}-${dateText}-${timeText}-${baanRaw}-${message}`,
      chatId,
      row: i + 2,
      timestamp,
      dateKey,
      dateLabel,
      timeLabel,
      sender,
      baan,
      message,
      sendTo,
      replyToId,
      topic,
    })
  }
  return messages
}

export async function fetchGroupChatLatestId(mode: 'bid' | 'report' = 'bid'): Promise<string> {
  const gid = mode === 'report' ? REPORT_CHAT_GID : CHAT_GID
  const rows = await fetchGidRangeGViz(gid, 'A2:A')
  for (let i = rows.length - 1; i >= 0; i--) {
    const value = cleanChatCell(rows[i]?.[0] ?? '')
    if (value) return /^\d+$/.test(value) ? value : `${i + 2}:${value}`
  }
  return ''
}

export async function sendGroupChatMessage(
  actor: GroupChatActor,
  message: string,
  options: { sendTo?: string; replyToId?: string; topic?: string } = {}
): Promise<{ ok: boolean; message?: string }> {
  if (!GAS_URL) return { ok: false, message: 'GAS URL not configured' }
  const actorText = String(actor)
  const sheetActor = actorText.toLowerCase() === 'admin' ? 'Admin' : actor
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'writeChat',
        actor: sheetActor,
        baan: sheetActor,
        message,
        sendTo: options.sendTo ?? 'public',
        replyToId: options.replyToId ?? '',
        topic: options.topic ?? 'bid',
      }),
    })
    return { ok: true, message: 'Sent' }
  } catch (e) {
    console.error('sendGroupChatMessage:', e)
    return { ok: false, message: String(e) }
  }
}

export function parseAreaTokens(value: string): string[] {
  const matches = String(value || '').toUpperCase().match(/KING|[ABC]\s*\d+/g) ?? []
  return Array.from(new Set(matches.map(token => token.replace(/\s+/g, ''))))
}

export interface LieHistoryCell {
  baan: number
  promises: string[]
  actual: string[]
}

export async function fetchLieHistoryWave(wave: number): Promise<LieHistoryCell[]> {
  const rows = await fetchWaveRangeGViz(wave, 'R20:U31')
  return rows.slice(0, 12).map((row, i) => ({
    baan: i + 1,
    promises: parseAreaTokens(String(row?.[0] ?? '')),
    actual: parseAreaTokens(String(row?.[3] ?? '')),
  }))
}

// ── READ: King info for a wave ─────────────────────────────
// KING island owner comes from rows 5-16. Current viewing king comes from H20.
export async function fetchWaveInfo(wave: number): Promise<{ king: number | null; viewingKing: number | null; disaster: number | null }> {
  const [king, viewingKing, disasterCell] = await Promise.all([
    fetchWaveKingOwner(wave),
    fetchWaveViewingKing(wave),
    fetchWaveRangeGViz(wave, 'H22'),
  ])
  const disaster = parseHouseNumber(disasterCell?.[0]?.[0])
  return { king, viewingKing, disaster }
}

// ── WRITE payload type ─────────────────────────────────────
export interface WritePayload {
  action: 'writeWave'
  wave:   number
  baan:   number
  clientId?: string
  // Bet game
  betTarget?: number   // Col C: บ้านที่เดิมพัน (1-12)
  betAmount?: number   // Col D: จำนวนเงิน
  // King bid
  kingAmount?: number  // Col F
  kingDisaster?: number | null // INFO section H22
  // Islands (up to 3)
  islands?: Array<{
    name:   string   // e.g. "A1", "B3"
    amount: number
  }>
}

// ── WRITE: Send submission to sheet via GAS ────────────────
const SHEET_WRITE_RETRY_DELAYS_MS = [0, 600, 1400, 2600]

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function shouldRetrySheetWrite(status: number, message: string) {
  return status === 429 || status >= 500 || /busy|retry|lock|timeout|timed out|temporarily/i.test(message)
}

export async function writeToSheet(payload: WritePayload): Promise<{ ok: boolean; message?: string; queued?: boolean; saving?: boolean; clientId?: string }> {
  let lastMessage = 'Google Sheet write failed'

  for (let attempt = 0; attempt < SHEET_WRITE_RETRY_DELAYS_MS.length; attempt++) {
    const delay = SHEET_WRITE_RETRY_DELAYS_MS[attempt]
    if (delay) await wait(delay)

    try {
      const res = await fetch('/api/sheets/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({} as { message?: string; queued?: boolean; saving?: boolean; clientId?: string }))
      lastMessage = data?.message || (res.ok ? 'Sent to Google Sheet' : 'Google Sheet write failed')
      if (res.ok && data?.ok !== false) {
        return {
          ok: true,
          message: lastMessage,
          queued: data?.queued === true,
          saving: data?.saving === true,
          clientId: data?.clientId,
        }
      }
      if (!shouldRetrySheetWrite(res.status, lastMessage)) return { ok: false, message: lastMessage }
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : String(e)
      if (attempt === SHEET_WRITE_RETRY_DELAYS_MS.length - 1) {
        console.error('writeToSheet:', e)
        return { ok: false, message: lastMessage }
      }
    }
  }

  return { ok: false, message: lastMessage }
}
