'use client'
// ============================================================
// CLIENT-SIDE GAME STATE  (localStorage + BroadcastChannel)
// ============================================================
import {
  GameState,
  SHEET_ID,
  WaveSubmission,
  DEFAULT_AMBASSADOR_VISIBILITY,
  DEFAULT_CHAT_PERMISSIONS,
  normalizeAmbassadorVisibility,
  normalizeChatPermissions,
} from './constants'

const KEY_GAME_STATE    = 'biggame_state'
const KEY_SUBMISSIONS   = 'biggame_submissions'
const KEY_MAP_OWNERSHIP = 'biggame_map'
const KEY_DISASTERS     = 'biggame_disasters'
const STATE_SHEET       = 'GAME_STATE'
const GAS_URL           = process.env.NEXT_PUBLIC_GAS_URL ?? ''
const CLOUD_GAME_STATE_URL = '/api/gamestate'

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

function write(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new CustomEvent('biggame-store', { detail: { key } }))
  try { const ch = new BroadcastChannel('biggame'); ch.postMessage({ key }); ch.close() } catch {}
}

export function subscribeStore(cb: (key: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  let bc: BroadcastChannel | null = null
  try { bc = new BroadcastChannel('biggame'); bc.onmessage = (e) => cb(e.data?.key ?? '') } catch {}
  const onStorage = (e: StorageEvent) => { if (e.key) cb(e.key) }
  const onLocal = (e: Event) => cb((e as CustomEvent<{ key?: string }>).detail?.key ?? '')
  window.addEventListener('storage', onStorage)
  window.addEventListener('biggame-store', onLocal)
  return () => { bc?.close(); window.removeEventListener('storage', onStorage); window.removeEventListener('biggame-store', onLocal) }
}

export const defaultGameState: GameState = {
  currentWave: 1,
  isOpen: false,
  timerEnd: null,
  duration: 10,
  gameMode: 'bid',
  gamePhase: 'welcome',
  showResults: false,
  showEventSolution: false,
  ambassadorVisibility: DEFAULT_AMBASSADOR_VISIBILITY,
  chatPermissions: DEFAULT_CHAT_PERMISSIONS,
}

export function getGameState(): GameState {
  const state = read<Partial<GameState>>(KEY_GAME_STATE, {})
  return {
    ...defaultGameState,
    ...state,
    ambassadorVisibility: normalizeAmbassadorVisibility(state.ambassadorVisibility),
    chatPermissions: normalizeChatPermissions(state.chatPermissions),
  }
}
export function setGameState(patch: Partial<GameState>, options: { sync?: boolean } = {}) {
  const next = { ...getGameState(), ...patch, updatedAt: new Date().toISOString() }
  write(KEY_GAME_STATE, next)
  if (options.sync !== false) {
    void publishGameStateToCloud(next)
  }
}

function parseGViz(text: string): any[] {
  const js = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)?.[1]
  return js ? JSON.parse(js)?.table?.rows ?? [] : []
}

function cellText(row: any, idx: number) {
  return String(row?.c?.[idx]?.v ?? '').trim()
}

function sheetTime(value?: string) {
  const raw = String(value ?? '').trim()
  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) return parsed
  const dateParts = raw.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/)
  if (!dateParts) return NaN
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = dateParts
  return new Date(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ).getTime()
}

export async function fetchGameStateFromSheet(): Promise<GameState | null> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(STATE_SHEET)}&t=${Date.now()}`
    const text = await (await fetch(url, { cache: 'no-store' })).text()
    const rows = parseGViz(text)
    const values = new Map<string, string>()
    rows.forEach(row => {
      const key = cellText(row, 0)
      if (key) values.set(key, cellText(row, 1))
    })
    const currentWave = parseInt(values.get('currentWave') ?? '')
    const duration = parseFloat(values.get('duration') ?? '')
    const gameModeRaw = values.get('gameMode')
    const gamePhaseRaw = values.get('gamePhase')
    const updatedAt = values.get('updatedAt') || undefined
    if (!currentWave || currentWave < 1 || currentWave > 5) return null
    return {
      currentWave,
      isOpen: values.get('isOpen') === 'true',
      timerEnd: values.get('timerEnd') || null,
      duration: Number.isFinite(duration) && duration > 0 ? duration : defaultGameState.duration,
      gameMode: gameModeRaw === 'bet' || gameModeRaw === 'event' ? gameModeRaw : 'bid',
      gamePhase:
        gamePhaseRaw === 'select-disaster'
          ? 'select-disaster'
          : gamePhaseRaw === 'welcome'
          ? 'welcome'
          : gamePhaseRaw === 'rules'
          ? 'rules'
          : 'play',
      showResults: values.get('showResults') === 'true',
      showEventSolution: values.get('showEventSolution') === 'true',
      ambassadorVisibility: normalizeAmbassadorVisibility(
        values.get('ambassadorVisibility') ? JSON.parse(values.get('ambassadorVisibility') || '{}') : undefined,
      ),
      chatPermissions: normalizeChatPermissions(
        values.get('chatPermissions') ? JSON.parse(values.get('chatPermissions') || '{}') : undefined,
      ),
      updatedAt,
    }
  } catch {
    return null
  }
}

export async function syncGameStateFromSheet(): Promise<GameState | null> {
  const cloud = await syncGameStateFromCloud()
  if (cloud) return cloud

  const remote = await fetchGameStateFromSheet()
  if (!remote) return null
  const local = getGameState()
  const remoteTime = sheetTime(remote.updatedAt)
  const localTime = sheetTime(local.updatedAt)
  if (Number.isFinite(localTime) && (!Number.isFinite(remoteTime) || localTime > remoteTime)) {
    return local
  }
  write(KEY_GAME_STATE, remote)
  return remote
}

export async function fetchGameStateFromCloud(): Promise<GameState | null> {
  if (typeof window === 'undefined') return null
  try {
    const res = await fetch(`${CLOUD_GAME_STATE_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    return { ...defaultGameState, ...(await res.json() as Partial<GameState>) }
  } catch {
    return null
  }
}

export async function syncGameStateFromCloud(): Promise<GameState | null> {
  const remote = await fetchGameStateFromCloud()
  if (!remote) return null
  const local = getGameState()
  const remoteTime = sheetTime(remote.updatedAt)
  const localTime = sheetTime(local.updatedAt)
  if (Number.isFinite(localTime) && (!Number.isFinite(remoteTime) || localTime > remoteTime)) {
    return local
  }
  if (JSON.stringify(remote) !== JSON.stringify(local)) {
    write(KEY_GAME_STATE, remote)
  }
  return remote
}

export async function publishGameStateToCloud(state: GameState = getGameState()) {
  if (typeof window === 'undefined') return { ok: false, message: 'Cloud sync is client-only' }
  try {
    const res = await fetch(CLOUD_GAME_STATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    })
    if (!res.ok) return { ok: false, message: `Cloud sync failed: ${res.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}

export async function publishGameStateToSheet(state: GameState = getGameState()) {
  if (!GAS_URL) return { ok: false, message: 'NEXT_PUBLIC_GAS_URL not configured' }
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'writeGameState', state }),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, message: String(e) }
  }
}

export function startCloudSync(intervalMs = 2000) {
  if (typeof window === 'undefined') return () => {}
  let inFlight = false

  const sync = () => {
    if (document.visibilityState === 'hidden') return
    if (inFlight) return
    inFlight = true
    void syncGameStateFromCloud().finally(() => {
      inFlight = false
    })
  }

  sync()
  const intervalId = window.setInterval(sync, intervalMs)
  document.addEventListener('visibilitychange', sync)
  return () => {
    window.clearInterval(intervalId)
    document.removeEventListener('visibilitychange', sync)
  }
}

export function getMapOwnership(): Record<string, number> {
  return read<Record<string, number>>(KEY_MAP_OWNERSHIP, {})
}
export function setMapOwnership(map: Record<string, number>) {
  write(KEY_MAP_OWNERSHIP, map)
}

export function getSubmissions(): WaveSubmission[] {
  return read<WaveSubmission[]>(KEY_SUBMISSIONS, [])
}
export function saveSubmission(sub: WaveSubmission) {
  const subs = getSubmissions()
  const idx = subs.findIndex(s => s.baan === sub.baan && s.wave === sub.wave)
  const previousRevision = idx >= 0 ? subs[idx].revision ?? 1 : 0
  const next = { ...sub, revision: previousRevision + 1 }
  if (idx >= 0) subs[idx] = next; else subs.push(next)
  write(KEY_SUBMISSIONS, subs)
}
export { saveSubmission as addSubmission }

export function getSubmissionsForWave(wave: number): WaveSubmission[] {
  return getSubmissions().filter(s => s.wave === wave)
}
export function getSubmissionsForBaan(baan: number): WaveSubmission[] {
  return getSubmissions().filter(s => s.baan === baan)
}

export function getActiveDisasters(): Record<number, number> {
  return read<Record<number, number>>(KEY_DISASTERS, {})
}
export function setActiveDisaster(wave: number, num: number | null) {
  const d = getActiveDisasters()
  if (num === null) delete d[wave]; else d[wave] = num
  write(KEY_DISASTERS, d)
}
export function getActiveDisasterForWave(wave: number): number | null {
  return getActiveDisasters()[wave] ?? null
}
