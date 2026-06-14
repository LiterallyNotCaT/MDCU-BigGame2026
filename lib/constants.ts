// ============================================================
// GAME CONSTANTS & TYPES
// ============================================================

export const SHEET_ID = '1FKv1l9zpF85V_oUKQCjAjYyb4DZcMRCvN671DzU_Dq4'
export const SHEET_BASE = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?usp=sharing`
export const WAVE_GIDS: Partial<Record<number, string>> = {
  1: '1448591830',
}
export const getWaveSheetQuery = (wave: number) =>
  WAVE_GIDS[wave]
    ? `gid=${WAVE_GIDS[wave]}`
    : `sheet=${encodeURIComponent(`Wave ${wave}`)}`

// Areas
export const AREAS = {
  A: ['A1','A2','A3','A4','A5'],
  B: ['B1','B2','B3','B4','B5','B6'],
  C: ['C1','C2','C3','C4','C5','C6','C7','C8','C9'],
}
export const ALL_AREAS = [...AREAS.A, ...AREAS.B, ...AREAS.C]

// Income rates
export const INCOME_RATE: Record<string, number> = { A: 1.8, B: 1.6, C: 1.4 }
// Disaster-ed loss rate
export const DISASTER_RATE: Record<string, number> = { A: 0.9, B: 0.8, C: 0.7 }

// Disasters
export type DisasterType = '🌊 น้ำท่วม' | '🌋 แผ่นดินไหว' | '🔥 ไฟป่า' | '🌪️ พายุ' | '☀️ แล้ง'
export const DISASTERS: DisasterType[] = ['🌊 น้ำท่วม', '🌋 แผ่นดินไหว', '🔥 ไฟป่า', '🌪️ พายุ', '☀️ แล้ง']
export const DISASTER_KEYS = ['น้ำท่วม', 'แผ่นดินไหว', 'ไฟป่า', 'พายุ', 'แล้ง']

// Disaster affected areas (from RULEBOOK sheet)
// disaster number -> affected area cells per group
export const DISASTER_AREAS: Record<number, { A: number[], B: number[], C: number[] }> = {
  1: { A: [1],     B: [1,2],   C: [1] },
  2: { A: [2],     B: [2,3],   C: [2] },
  3: { A: [3],     B: [3,4],   C: [3] },
  4: { A: [4],     B: [4,5],   C: [4] },
  5: { A: [5],     B: [5,6],   C: [5] },
  6: { A: [],      B: [6,1],   C: [6,7,8] },
  7: { A: [],      B: [],      C: [1,2,3,4,5,6] },
  8: { A: [],      B: [1,2,3], C: [] },
  9: { A: [1,2],   B: [],      C: [] },
}

// Rank rewards
export const RANK_REWARDS: Record<number, number> = {
  1: 4.0, 2: 2.5, 3: 2.0, 4: 1.5, 5: 1.5,
  6: 1.0, 7: 0.75, 8: 0.75, 9: 0.75, 10: 0.75,
  11: 0.5, 12: 0.5,
}

export const TOTAL_WAVES = 5
export const HOUSES = Array.from({ length: 12 }, (_, i) => i + 1)
export type MapMode = 'simple' | 'image' | 'both'
export const DEFAULT_MAP_MODE: MapMode = 'simple'

// Types
export interface BiddingEntry {
  area: string
  amount: number
}

export interface WaveSubmission {
  baan: number
  wave: number
  bets: BiddingEntry[]
  isKing: boolean
  kingDisaster?: number
  betTarget?: number
  betAmount?: number
  timestamp: string
  balance: number
  revision?: number
}

export interface HouseData {
  baan: number
  balance: number
  wave: number
  areas: string[]  // currently owned
  history: WaveHistory[]
}

export interface WaveHistory {
  wave: number
  spent: number
  won: string[]
  lost: string[]
  income: number
  disaster?: number
  endBalance: number
}

export interface GameState {
  currentWave: number
  isOpen: boolean       // submissions open/closed
  timerEnd: string | null  // ISO timestamp
  duration: number      // minutes per wave
  gameMode?: 'bid' | 'bet' | 'event'
  gamePhase?: 'welcome' | 'rules' | 'play' | 'select-disaster'
  showResults?: boolean
  showEventSolution?: boolean
  mapMode?: MapMode
  ambassadorVisibility?: AmbassadorVisibility
  chatPermissions?: ChatPermissions
  updatedAt?: string
}

export type AmbassadorTabKey = 'map' | 'history' | 'ownership' | 'lieHistory' | 'scoreboard'

export interface AmbassadorVisibility {
  tabs: Record<AmbassadorTabKey, boolean>
  scoreboardNumbers: boolean
}

export interface ChatPermissions {
  groupChat: boolean
  adminPrivate: boolean
  playerPrivate: boolean
}

export const DEFAULT_AMBASSADOR_VISIBILITY: AmbassadorVisibility = {
  tabs: {
    map: true,
    history: false,
    ownership: true,
    lieHistory: false,
    scoreboard: true,
  },
  scoreboardNumbers: true,
}

export const DEFAULT_CHAT_PERMISSIONS: ChatPermissions = {
  groupChat: true,
  adminPrivate: true,
  playerPrivate: true,
}

export function normalizeAmbassadorVisibility(value?: Partial<AmbassadorVisibility> | null): AmbassadorVisibility {
  const tabs = (value?.tabs ?? {}) as Partial<Record<AmbassadorTabKey, boolean>>
  return {
    tabs: {
      map: tabs.map === undefined ? DEFAULT_AMBASSADOR_VISIBILITY.tabs.map : tabs.map === true,
      history: tabs.history === undefined ? DEFAULT_AMBASSADOR_VISIBILITY.tabs.history : tabs.history === true,
      ownership: tabs.ownership === undefined ? DEFAULT_AMBASSADOR_VISIBILITY.tabs.ownership : tabs.ownership === true,
      lieHistory: tabs.lieHistory === undefined ? DEFAULT_AMBASSADOR_VISIBILITY.tabs.lieHistory : tabs.lieHistory === true,
      scoreboard: tabs.scoreboard === undefined ? DEFAULT_AMBASSADOR_VISIBILITY.tabs.scoreboard : tabs.scoreboard === true,
    },
    scoreboardNumbers: value?.scoreboardNumbers === undefined
      ? DEFAULT_AMBASSADOR_VISIBILITY.scoreboardNumbers
      : value.scoreboardNumbers === true,
  }
}

export function normalizeChatPermissions(value?: Partial<ChatPermissions> | null): ChatPermissions {
  return {
    groupChat: value?.groupChat === undefined ? DEFAULT_CHAT_PERMISSIONS.groupChat : value.groupChat === true,
    adminPrivate: true,
    playerPrivate: value?.playerPrivate === undefined ? DEFAULT_CHAT_PERMISSIONS.playerPrivate : value.playerPrivate === true,
  }
}

export function normalizeMapMode(value?: string | null): MapMode {
  return value === 'image' || value === 'both' ? value : DEFAULT_MAP_MODE
}

export interface LeaderboardEntry {
  baan: number
  score: number
  rank: number
  wave: number
}

// House color palette
export const HOUSE_COLORS: Record<number, string> = {
  1:  '#EFBA45', 2:  '#D55B5B', 3:  '#320B35', 4:  '#75E2E0',
  5:  '#081D56', 6:  '#695243', 7:  '#604361', 8:  '#BF5A7B',
  9:  '#2D5A27', 10: '#FFFFC1', 11: '#F09835', 12: '#6AB87E',
}

export const HOUSE_TEXT_COLORS: Record<number, string> = {
  1:  '#111827', 2:  '#111827', 3:  '#FFFFFF', 4:  '#111827',
  5:  '#FFFFFF', 6:  '#FFFFFF', 7:  '#FFFFFF', 8:  '#111827',
  9:  '#FFFFFF', 10: '#111827', 11: '#111827', 12: '#111827',
}

export const HOUSE_NAMES: Record<number, string> = {
  1: 'บ้านที่ 1', 2: 'บ้านที่ 2', 3: 'บ้านที่ 3', 4: 'บ้านที่ 4',
  5: 'บ้านที่ 5', 6: 'บ้านที่ 6', 7: 'บ้านที่ 7', 8: 'บ้านที่ 8',
  9: 'บ้านที่ 9', 10: 'บ้านที่ 10', 11: 'บ้านที่ 11', 12: 'บ้านที่ 12',
}
