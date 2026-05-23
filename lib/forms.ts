export const FORM_CONFIG_RANGE = 'E3:H33'

export const FORM_SPREADSHEET_BY_TAB: Record<string, string> = {
  'เช้าบน': '10Z4J30FlnX_iXgGsJfc-v-USho2mSDtKT_9uFLcDEnk',
  'เช้าล่าง': '1SwwS8hxhZmAwuMF_WZn8QweKmDY-fv5dJg_gMFA1zfs',
  'Games บ่าย': '17aDGTgeB1xIwXBPrbU0Fd5hXr3Qw_zSu1OZkas3EgZs',
}

export type FormKind = 'ranking-group' | 'ranking-single' | 'match-single' | 'placeholder'
export type FormRole = 'staff' | 'admin'

export interface ScoringFormConfig {
  formKey: string
  tab: string
  user: string
  gid: string
  spreadsheetId: string
  kind: FormKind
  defaultFillToRank: number
  allowTies: boolean
  blank: boolean
  rankCount: number
  maxRounds: number
  usesAutoRemainder: boolean
  autoAfterHouseCount: number
}

export interface ScoringFormRound {
  index: number
  label: string
  wave: string
  participants: string
  confirmed: boolean
  locked: boolean
  deadlineAt: string
}

export interface ScoringFormState {
  form: ScoringFormConfig
  title: string
  fillToRank: number
  rankLabels: string[]
  rounds: ScoringFormRound[]
  values: string[][]
}

export interface ScoringFormAuth {
  ok: boolean
  role: FormRole
  username: string
  formKey?: string
  message?: string
}

export function formKeyFor(tab: string, user: string, gid: string) {
  return `${tab}|${user}|${gid}`
}

export function inferFormKind(
  tab: string,
  user: string
): Pick<ScoringFormConfig, 'kind' | 'defaultFillToRank' | 'allowTies' | 'blank' | 'rankCount' | 'maxRounds' | 'usesAutoRemainder' | 'autoAfterHouseCount'> {
  const normalized = user.toLowerCase().replace(/\s+/g, ' ').trim()
  if (['event', 'snake ladder', 'money drop'].includes(normalized)) {
    return { kind: 'placeholder', defaultFillToRank: 0, allowTies: false, blank: true, rankCount: 0, maxRounds: 0, usesAutoRemainder: false, autoAfterHouseCount: 0 }
  }
  if (normalized.includes('dodge ball') || normalized.includes('territory control')) {
    return { kind: 'match-single', defaultFillToRank: 1, allowTies: false, blank: false, rankCount: 2, maxRounds: 6, usesAutoRemainder: false, autoAfterHouseCount: 0 }
  }
  if (normalized.includes('stacking block') || normalized.includes('escape')) {
    return { kind: 'ranking-single', defaultFillToRank: 4, allowTies: false, blank: false, rankCount: 4, maxRounds: 6, usesAutoRemainder: false, autoAfterHouseCount: 0 }
  }
  return { kind: 'ranking-group', defaultFillToRank: 3, allowTies: true, blank: false, rankCount: 4, maxRounds: tab === 'เช้าบน' ? 4 : 0, usesAutoRemainder: true, autoAfterHouseCount: 3 }
}

export function parseHouseList(value: unknown) {
  const seen = new Set<number>()
  return (String(value ?? '').match(/\d{1,2}/g) ?? [])
    .map(raw => Number(raw))
    .filter(house => {
      if (!Number.isInteger(house) || house < 1 || house > 12 || seen.has(house)) return false
      seen.add(house)
      return true
    })
}

export function formatHouseList(houses: number[]) {
  return houses.join(', ')
}

export function normalizeHouseText(value: string, allowMany: boolean) {
  const houses = parseHouseList(value)
  if (!houses.length) return ''
  return formatHouseList(allowMany ? houses : houses.slice(0, 1))
}

export function remainingHouseText(participantsText: string, manualValues: string[]) {
  const participants = parseHouseList(participantsText)
  const base = participants.length ? participants : Array.from({ length: 12 }, (_, index) => index + 1)
  const used = new Set(manualValues.flatMap(value => parseHouseList(value)))
  return formatHouseList(base.filter(house => !used.has(house)))
}
