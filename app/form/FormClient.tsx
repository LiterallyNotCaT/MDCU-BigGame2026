'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import clsx from 'clsx'
import { signOut } from 'next-auth/react'
import { CheckCircle2, Clock, Eye, FileSpreadsheet, KeyRound, Lock, LogOut, RefreshCw, Send, ShieldCheck, Unlock } from 'lucide-react'
import ContactFooter from '@/components/ContactFooter'
import GroupChat from '@/components/GroupChat'
import HomeButton from '@/components/HomeButton'
import {
  canOAuthEditForm,
  canOAuthViewForm,
  isOAuthBanned,
  isOAuthAdmin,
  type OAuthFormProfile,
} from '@/lib/formPermissions'
import {
  formatHouseList,
  normalizeHouseText,
  parseHouseList,
  remainingHouseText,
  type FormRole,
  type ScoringFormAuth,
  type ScoringFormConfig,
  type ScoringFormState,
} from '@/lib/forms'

type Session = {
  role: FormRole
  username: string
  password: string
  authMode?: 'password' | 'oauth'
}

type BulkControlKind = 'edit' | 'unlock'
type BulkControlScope = 'form' | 'tab' | 'all'
type BulkControlTarget = {
  formKey: string
  roundCount: number
}

type FormLiveState = {
  formKey: string
  version: number
  rounds: Record<string, {
    confirmed: boolean
    locked: boolean
    saving?: boolean
    error?: string
    deadlineAt: string
    participants: string
    values: string[]
  }>
}

type MoneyDropSpecialRound = {
  index: number
  label: string
  wave: 2 | 4
  value: string
  confirmed: boolean
  locked: boolean
  saving?: boolean
  error?: string
}

type MoneyDropSpecialState = {
  formKey: string
  liveKey: string
  rounds: MoneyDropSpecialRound[]
}

const FORM_TABS = ['เช้าล่าง', 'เช้าบน', 'Games บ่าย']
const FORM_SESSION_STORAGE_KEY = 'biggame_form_sessions_v1'

type StoredFormSession = {
  sessions: Record<string, Session>
  adminSession: Session | null
  tab: string
  formKey: string
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false
  const session = value as Record<string, unknown>
  return (session.role === 'staff' || session.role === 'admin')
    && typeof session.username === 'string'
    && typeof session.password === 'string'
}

function readStoredFormSession(): StoredFormSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(FORM_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredFormSession>
    const sessions = Object.entries(parsed.sessions ?? {}).reduce<Record<string, Session>>((next, [key, value]) => {
      if (isSession(value)) next[key] = value
      return next
    }, {})
    return {
      sessions,
      adminSession: isSession(parsed.adminSession) ? parsed.adminSession : null,
      tab: typeof parsed.tab === 'string' ? parsed.tab : '',
      formKey: typeof parsed.formKey === 'string' ? parsed.formKey : '',
    }
  } catch {
    return null
  }
}

function groupByTab(forms: ScoringFormConfig[]) {
  return forms.reduce<Record<string, ScoringFormConfig[]>>((groups, form) => {
    if (!groups[form.tab]) groups[form.tab] = []
    groups[form.tab].push(form)
    return groups
  }, {})
}

function blankDraft(state: ScoringFormState | null) {
  if (!state) return []
  return state.values.map(row => row.map(value => value || ''))
}

function defaultParticipants(text: string) {
  const parsed = parseHouseList(text)
  return parsed.length ? formatHouseList(parsed) : formatHouseList(Array.from({ length: 12 }, (_, index) => index + 1))
}

function clampFillToRank(value: number) {
  if (!Number.isFinite(value)) return 3
  return Math.max(1, Math.min(11, Math.floor(value)))
}

function staffChatName(name: string) {
  const clean = String(name || '').trim()
  return clean.toLowerCase().startsWith('staff ') ? clean : `Staff ${clean}`
}

function sanitizeScoreInput(value: string, allowNegative: boolean) {
  const compact = String(value ?? '').replace(/[,\s]/g, '')
  if (!allowNegative && compact.includes('-')) return ''
  const negative = allowNegative && compact.startsWith('-')
  const digits = compact.replace(/-/g, '').replace(/\D/g, '')
  if (!digits) return negative ? '-' : ''
  return `${negative ? '-' : ''}${digits}`
}

function normalizeScoreText(value: string, allowNegative: boolean) {
  const compact = sanitizeScoreInput(value, allowNegative)
  const pattern = allowNegative ? /^-?\d+$/ : /^\d+$/
  if (!pattern.test(compact)) return ''
  const number = Number(compact)
  return Number.isSafeInteger(number) ? String(number) : ''
}

function applyRoundControlPatch(round: ScoringFormState['rounds'][number], patch: Record<string, unknown>) {
  const next = { ...round }
  if (patch.locked !== undefined) next.locked = patch.locked === true
  if (patch.confirmed !== undefined) next.confirmed = patch.confirmed === true
  if (patch.deadlineMinutes !== undefined) {
    const minutes = Math.max(1, Math.min(240, Number(patch.deadlineMinutes) || 10))
    next.deadlineAt = new Date(Date.now() + minutes * 60000).toISOString()
  }
  if (patch.clearDeadline === true) next.deadlineAt = ''
  return next
}

function roundDisplayMeta(state: ScoringFormState, round: { label: string; wave: string }, index: number) {
  if (state.form.kind === 'score-unsigned') {
    const labels = ['2-ซองทอง', '2-ซองขาว', '4-ซองทอง', '4-ซองขาว']
    const waves = ['2', '2', '4', '4']
    return {
      label: labels[index] ?? round.label,
      wave: waves[index] ?? round.wave,
    }
  }
  return {
    label: round.label || `Round ${index + 1}`,
    wave: round.wave || '-',
  }
}

function validatedColumn(
  state: ScoringFormState,
  draft: string[][],
  roundIndex: number,
  fillToRank: number,
  participants: string,
) {
  const config = state.form
  const rankCount = config.rankCount || state.rankLabels.length
  const usesAutoRemainder = config.usesAutoRemainder === true
  const autoAfterHouseCount = config.autoAfterHouseCount || fillToRank
  if (config.kind === 'score-number' || config.kind === 'score-unsigned') {
    const allowNegative = config.kind === 'score-number'
    const values = Array.from({ length: rankCount }, (_, rowIndex) => {
      const raw = draft[rowIndex]?.[roundIndex] ?? ''
      return normalizeScoreText(raw, allowNegative)
    })
    const hasInvalid = Array.from({ length: rankCount }, (_, rowIndex) => draft[rowIndex]?.[roundIndex] ?? '')
      .some(raw => String(raw).trim() && !normalizeScoreText(raw, allowNegative))
    if (hasInvalid) return {
      ok: false,
      message: allowNegative
        ? 'Money Drop accepts numbers only. Use - for lost money, for example -500.'
        : 'Snake Ladder accepts unsigned integers only.',
      values,
    }
    return { ok: true, values }
  }
  const normalized = Array.from({ length: rankCount }, (_, rowIndex) => {
    const raw = draft[rowIndex]?.[roundIndex] ?? ''
    return normalizeHouseText(raw, config.allowTies)
  })

  if (config.kind === 'placeholder') return { ok: false, message: 'This form is blank for now.', values: normalized }

  const manualLimit = usesAutoRemainder ? fillToRank : rankCount
  const used = new Set<number>()
  for (let rowIndex = 0; rowIndex < manualLimit; rowIndex++) {
    const houses = parseHouseList(normalized[rowIndex])
    if (!config.allowTies && houses.length > 1) {
      return { ok: false, message: 'This game allows only one house per cell.', values: normalized }
    }
    for (const house of houses) {
      if (used.has(house)) return { ok: false, message: `บ้าน ${house} is repeated in this round.`, values: normalized }
      used.add(house)
    }
  }

  if (usesAutoRemainder) {
    const remainderRow = fillToRank
    const manualValues = normalized.slice(0, fillToRank)
    const enteredHouseCount = new Set(manualValues.flatMap(value => parseHouseList(value))).size
    normalized[remainderRow] = enteredHouseCount >= autoAfterHouseCount
      ? remainingHouseText(participants, manualValues)
      : ''
    for (let rowIndex = remainderRow + 1; rowIndex < normalized.length; rowIndex++) normalized[rowIndex] = ''
  }

  return { ok: true, values: normalized }
}

async function fetchJson<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), init?.timeoutMs ?? 45000)
  const res = await fetch(url, {
    ...init,
    signal: init?.signal ?? controller.signal,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  }).finally(() => window.clearTimeout(timeout))
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) throw new Error(data?.message || `Request failed: ${res.status}`)
  return data
}

export default function FormClient({ oauthEmail }: { oauthEmail: string }) {
  const [forms, setForms] = useState<ScoringFormConfig[]>([])
  const [tab, setTab] = useState(FORM_TABS[0])
  const [formKey, setFormKey] = useState('')
  const [state, setState] = useState<ScoringFormState | null>(null)
  const [statesByFormKey, setStatesByFormKey] = useState<Record<string, ScoringFormState>>({})
  const [draft, setDraft] = useState<string[][]>([])
  const [participantsByRound, setParticipantsByRound] = useState<string[]>([])
  const [fillToRank, setFillToRank] = useState(3)
  const [selectedRound, setSelectedRound] = useState(0)
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [adminSession, setAdminSession] = useState<Session | null>(null)
  const [passwordInput, setPasswordInput] = useState('')
  const [adminInput, setAdminInput] = useState('')
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [sessionsRestored, setSessionsRestored] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [loadingState, setLoadingState] = useState(false)
  const [stateLoadError, setStateLoadError] = useState('')
  const [savingRounds, setSavingRounds] = useState<Set<number>>(() => new Set())
  const [controlBusy, setControlBusy] = useState(false)
  const [bulkControl, setBulkControl] = useState<{ kind: BulkControlKind } | null>(null)
  const [moneyDropSpecial, setMoneyDropSpecial] = useState<MoneyDropSpecialState | null>(null)
  const [moneyDropSpecialDraft, setMoneyDropSpecialDraft] = useState<string[]>(['', ''])
  const [moneyDropSpecialLoading, setMoneyDropSpecialLoading] = useState(false)
  const [moneyDropSpecialSaving, setMoneyDropSpecialSaving] = useState<Set<number>>(() => new Set())
  const [notice, setNotice] = useState<{ type: 'ok' | 'err' | 'warn'; text: string } | null>(null)
  const [oauthProfile, setOauthProfile] = useState<OAuthFormProfile | null>(null)
  const [oauthLoading, setOauthLoading] = useState(true)
  const [oauthError, setOauthError] = useState('')
  const didRouteOauthProfile = useRef(false)
  const adminPreloadedTabs = useRef<Set<string>>(new Set())
  const liveVersionByForm = useRef<Record<string, number>>({})
  const statesByFormKeyRef = useRef<Record<string, ScoringFormState>>({})
  const formStateRequestSeq = useRef(0)
  const latestFormStateRequestSeq = useRef<Record<string, number>>({})
  const sheetFreshLoadedForms = useRef<Set<string>>(new Set())
  const dirtyRoundsByForm = useRef<Record<string, Set<number>>>({})
  const submittingRoundsByForm = useRef<Record<string, Set<number>>>({})
  const dirtyMoneyDropRoundsByLiveKey = useRef<Record<string, Set<number>>>({})
  const submittingMoneyDropRoundsByLiveKey = useRef<Record<string, Set<number>>>({})
  const grouped = useMemo(() => groupByTab(forms), [forms])
  const currentForms = grouped[tab] ?? []
  const currentForm = forms.find(form => form.formKey === formKey) ?? currentForms[0] ?? null
  const currentState = currentForm && state?.form.formKey === currentForm.formKey ? state : null
  const oauthIsAdmin = isOAuthAdmin(oauthProfile)
  const oauthCanViewCurrent = canOAuthViewForm(oauthProfile, currentForm)
  const oauthCanEditCurrent = canOAuthEditForm(oauthProfile, currentForm)
  const reportTargets = useMemo(() => {
    const seen = new Set<string>()
    const targetForms = tab === FORM_TABS[2]
      ? forms.filter(form => form.tab === FORM_TABS[2])
      : forms.filter(form => form.tab !== FORM_TABS[2])
    return targetForms.flatMap(form => {
      const value = staffChatName(form.user)
      if (seen.has(value)) return []
      seen.add(value)
      return [{ value, label: value }]
    })
  }, [forms, tab])
  const oauthSession: Session | null = (currentForm && oauthCanViewCurrent) || oauthIsAdmin
    ? {
      role: oauthIsAdmin ? 'admin' : 'staff',
      username: oauthProfile?.nickname || oauthProfile?.email || oauthEmail,
      password: '',
      authMode: 'oauth',
    }
    : null
  const session = currentForm ? oauthSession ?? adminSession ?? sessions[currentForm.formKey] ?? null : oauthSession ?? adminSession
  const canSeeContent = Boolean(currentForm && (oauthCanViewCurrent || adminSession || sessions[currentForm.formKey]))
  const canLoadSelectedForm = Boolean(formKey && (oauthCanViewCurrent || adminSession || sessions[formKey]))
  const isAdmin = session?.role === 'admin'
  const canEditCurrentForm = Boolean(isAdmin || oauthCanEditCurrent || (currentForm && sessions[currentForm.formKey]))
  const selectedRoundMeta = currentState?.rounds[selectedRound] ?? null
  const selectedIsTimedOut = Boolean(selectedRoundMeta?.deadlineAt && Date.now() > new Date(selectedRoundMeta.deadlineAt).getTime())
  const selectedCanEdit = Boolean(currentState && session && canEditCurrentForm && (isAdmin || (!selectedRoundMeta?.confirmed && !selectedRoundMeta?.locked && !selectedIsTimedOut)))

  const notify = (type: 'ok' | 'err' | 'warn', text: string) => {
    setNotice({ type, text })
    window.setTimeout(() => setNotice(null), 4200)
  }

  useEffect(() => {
    statesByFormKeyRef.current = statesByFormKey
  }, [statesByFormKey])

  const markRoundInRef = (ref: MutableRefObject<Record<string, Set<number>>>, key: string, roundIndex: number) => {
    if (!key || !Number.isInteger(roundIndex)) return
    const existing = ref.current[key] ?? new Set<number>()
    existing.add(roundIndex)
    ref.current[key] = existing
  }

  const clearRoundInRef = (ref: MutableRefObject<Record<string, Set<number>>>, key: string, roundIndex: number) => {
    const existing = ref.current[key]
    if (!existing) return
    existing.delete(roundIndex)
    if (!existing.size) delete ref.current[key]
  }

  const isRoundInRef = (ref: MutableRefObject<Record<string, Set<number>>>, key: string, roundIndex: number) => (
    ref.current[key]?.has(roundIndex) === true
  )

  const applyLiveState = useCallback((live: FormLiveState) => {
    if (!live?.formKey || !live.version || !live.rounds) return
    liveVersionByForm.current[live.formKey] = Math.max(liveVersionByForm.current[live.formKey] ?? 0, live.version)
    Object.entries(live.rounds).forEach(([roundKey, liveRound]) => {
      const roundIndex = Number(roundKey)
      if (!Number.isInteger(roundIndex)) return
      if (liveRound.confirmed) {
        clearRoundInRef(dirtyRoundsByForm, live.formKey, roundIndex)
        clearRoundInRef(submittingRoundsByForm, live.formKey, roundIndex)
      } else if (!liveRound.saving && liveRound.error) {
        clearRoundInRef(submittingRoundsByForm, live.formKey, roundIndex)
      }
    })
    const shouldUseLiveValues = (roundIndex: number, liveRound: FormLiveState['rounds'][string] | undefined) => (
      Boolean(liveRound)
      && (
        liveRound?.confirmed === true
        || (
          !isRoundInRef(dirtyRoundsByForm, live.formKey, roundIndex)
          && !isRoundInRef(submittingRoundsByForm, live.formKey, roundIndex)
        )
      )
    )
    const mergeValues = (values: ScoringFormState['values']) => values.map((row, rowIndex) => row.map((cell, columnIndex) => {
      const liveRound = live.rounds[String(columnIndex)]
      const liveValues = liveRound?.values
      return Array.isArray(liveValues) && rowIndex < liveValues.length && shouldUseLiveValues(columnIndex, liveRound) ? liveValues[rowIndex] : cell
    }))
    const mergeRounds = (rounds: ScoringFormState['rounds']) => rounds.map((round, index) => {
      const liveRound = live.rounds[String(index)]
      if (!liveRound) return round
      if (
        round.confirmed === liveRound.confirmed
        && round.locked === liveRound.locked
        && (round.saving || false) === (liveRound.saving || false)
        && (round.error || '') === (liveRound.error || '')
        && (round.deadlineAt || '') === (liveRound.deadlineAt || '')
        && (round.participants || '') === (liveRound.participants || round.participants || '')
      ) return round
      return {
        ...round,
        participants: liveRound.participants || round.participants,
        confirmed: liveRound.confirmed === true,
        locked: liveRound.locked === true,
        saving: liveRound.saving === true,
        error: liveRound.error || '',
        deadlineAt: liveRound.deadlineAt || '',
      }
    })

    setState(prev => {
      if (!prev || prev.form.formKey !== live.formKey) return prev
      return { ...prev, values: mergeValues(prev.values), rounds: mergeRounds(prev.rounds) }
    })
    setStatesByFormKey(prev => {
      const cached = prev[live.formKey]
      if (!cached) return prev
      const nextState = { ...cached, values: mergeValues(cached.values), rounds: mergeRounds(cached.rounds) }
      return {
        ...prev,
        [live.formKey]: nextState,
      }
    })
    setDraft(prev => prev.map((row, rowIndex) => row.map((cell, columnIndex) => {
      const liveRound = live.rounds[String(columnIndex)]
      const liveValues = liveRound?.values
      return Array.isArray(liveValues) && rowIndex < liveValues.length && shouldUseLiveValues(columnIndex, liveRound) ? liveValues[rowIndex] : cell
    })))
    setParticipantsByRound(prev => prev.map((value, index) => {
      const liveRound = live.rounds[String(index)]
      return liveRound?.participants && shouldUseLiveValues(index, liveRound) ? liveRound.participants : value
    }))
  }, [])

  const applyMoneyDropSpecialLive = useCallback((live: FormLiveState) => {
    if (!live?.formKey || !live.version || !live.rounds) return
    Object.entries(live.rounds).forEach(([roundKey, liveRound]) => {
      const roundIndex = Number(roundKey)
      if (!Number.isInteger(roundIndex)) return
      if (liveRound.confirmed) {
        clearRoundInRef(dirtyMoneyDropRoundsByLiveKey, live.formKey, roundIndex)
        clearRoundInRef(submittingMoneyDropRoundsByLiveKey, live.formKey, roundIndex)
      } else if (!liveRound.saving && liveRound.error) {
        clearRoundInRef(submittingMoneyDropRoundsByLiveKey, live.formKey, roundIndex)
      }
    })
    const shouldUseLiveValues = (roundIndex: number, liveRound: FormLiveState['rounds'][string] | undefined) => (
      Boolean(liveRound)
      && (
        liveRound?.confirmed === true
        || (
          !isRoundInRef(dirtyMoneyDropRoundsByLiveKey, live.formKey, roundIndex)
          && !isRoundInRef(submittingMoneyDropRoundsByLiveKey, live.formKey, roundIndex)
        )
      )
    )
    setMoneyDropSpecial(prev => {
      if (!prev || prev.liveKey !== live.formKey) return prev
      return {
        ...prev,
        rounds: prev.rounds.map(round => {
          const liveRound = live.rounds[String(round.index)]
          if (!liveRound) return round
          return {
            ...round,
            value: shouldUseLiveValues(round.index, liveRound) ? liveRound.values?.[0] ?? round.value : round.value,
            confirmed: liveRound.confirmed === true,
            locked: liveRound.locked === true,
            saving: liveRound.saving === true,
            error: liveRound.error || '',
          }
        }),
      }
    })
    setMoneyDropSpecialDraft(prev => prev.map((value, index) => {
      const liveRound = live.rounds[String(index)]
      return shouldUseLiveValues(index, liveRound) ? liveRound?.values?.[0] ?? value : value
    }))
  }, [])

  const refreshConfig = useCallback(async () => {
    setLoadingConfig(true)
    try {
      const data = await fetchJson<{ forms: ScoringFormConfig[] }>('/api/forms/config')
      setForms(data.forms)
      const nextTab = FORM_TABS.find(item => data.forms.some(form => form.tab === item)) ?? data.forms[0]?.tab ?? FORM_TABS[0]
      setTab(prev => data.forms.some(form => form.tab === prev) ? prev : nextTab)
      setFormKey(prev => data.forms.some(form => form.formKey === prev) ? prev : data.forms.find(form => form.tab === nextTab)?.formKey ?? '')
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingConfig(false)
    }
  }, [])

  const refreshOAuthProfile = useCallback(async () => {
    setOauthLoading(true)
    setOauthError('')
    try {
      const data = await fetchJson<{ profile: OAuthFormProfile }>('/api/forms/oauth')
      if (isOAuthBanned(data.profile)) {
        window.location.assign('/form/login-failed?reason=banned')
        return
      }
      setOauthProfile(data.profile)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setOauthError(message)
      notify('err', message)
    } finally {
      setOauthLoading(false)
    }
  }, [])

  const applyFormState = useCallback((nextState: ScoringFormState) => {
    setStateLoadError('')
    setLoadingState(false)
    delete dirtyRoundsByForm.current[nextState.form.formKey]
    delete submittingRoundsByForm.current[nextState.form.formKey]
    setState(nextState)
    setDraft(blankDraft(nextState))
    setFillToRank(clampFillToRank(nextState.fillToRank || nextState.form.defaultFillToRank))
    setParticipantsByRound(nextState.rounds.map(round => defaultParticipants(round.participants)))
    const maxVisibleRounds = nextState.form.maxRounds || nextState.rounds.length
    setSelectedRound(prev => Math.min(prev, Math.max(0, Math.min(nextState.rounds.length, maxVisibleRounds) - 1)))
  }, [])

  const formKeysForTab = useCallback((tabName: string) => (
    (grouped[tabName] ?? []).filter(form => !form.blank).map(form => form.formKey)
  ), [grouped])

  const loadStatesForTab = useCallback(async (tabName: string, options?: { password?: string; oauth?: boolean; force?: boolean }) => {
    const formKeys = formKeysForTab(tabName)
    if (!formKeys.length) return {}
    const requestSeq = ++formStateRequestSeq.current
    formKeys.forEach(key => {
      latestFormStateRequestSeq.current[key] = requestSeq
    })
    const data = await fetchJson<{ states: Record<string, ScoringFormState>; errors?: Record<string, string> }>('/api/forms/states', {
      method: 'POST',
      body: JSON.stringify({
        password: options?.password ?? '',
        oauth: options?.oauth === true,
        force: options?.force === true,
        formKeys,
      }),
    })
    const nextStates = data.states ?? {}
    const forceLoaded = options?.force === true
    const liveRequestStates = Object.fromEntries(
      Object.entries(nextStates).filter(([key]) => latestFormStateRequestSeq.current[key] === requestSeq),
    ) as Record<string, ScoringFormState>
    const acceptedStates = Object.fromEntries(
      Object.entries(liveRequestStates).filter(([key]) => forceLoaded || !sheetFreshLoadedForms.current.has(key)),
    ) as Record<string, ScoringFormState>
    if (forceLoaded) {
      Object.keys(acceptedStates).forEach(key => sheetFreshLoadedForms.current.add(key))
    }
    if (Object.keys(acceptedStates).length) {
      statesByFormKeyRef.current = { ...statesByFormKeyRef.current, ...acceptedStates }
      setStatesByFormKey(prev => ({ ...prev, ...acceptedStates }))
    }
    return acceptedStates
  }, [formKeysForTab])

  const roundCountForForm = useCallback((form: ScoringFormConfig) => {
    const cached = statesByFormKey[form.formKey]
    const count = cached?.form.maxRounds
      || cached?.rounds.length
      || form.maxRounds
      || (form.kind === 'score-number' || form.kind === 'score-unsigned' ? 4 : 0)
      || (form.kind === 'match-single' ? 6 : 0)
      || 12
    return Math.max(1, Math.min(24, Math.floor(count)))
  }, [statesByFormKey])

  const bulkTargetsForScope = useCallback((scope: BulkControlScope): BulkControlTarget[] => {
    const source = scope === 'all'
      ? forms
      : scope === 'tab'
        ? currentForms
        : currentForm
          ? [currentForm]
          : []
    return source
      .filter(form => !form.blank)
      .map(form => ({
        formKey: form.formKey,
        roundCount: roundCountForForm(form),
      }))
  }, [currentForm, currentForms, forms, roundCountForForm])

  const applyControlPatchLocally = useCallback((targets: BulkControlTarget[], patch: Record<string, unknown>) => {
    const targetMap = new Map(targets.map(target => [target.formKey, target.roundCount]))
    const patchState = (item: ScoringFormState) => {
      const roundCount = targetMap.get(item.form.formKey)
      if (!roundCount) return item
      return {
        ...item,
        rounds: item.rounds.map((round, index) => (
          index < roundCount ? applyRoundControlPatch(round, patch) : round
        )),
      }
    }

    setState(prev => prev && targetMap.has(prev.form.formKey) ? patchState(prev) : prev)
    setStatesByFormKey(prev => {
      let changed = false
      const next = { ...prev }
      for (const formKeyItem of targetMap.keys()) {
        const cached = next[formKeyItem]
        if (!cached) continue
        next[formKeyItem] = patchState(cached)
        changed = true
      }
      return changed ? next : prev
    })
  }, [])

  useEffect(() => {
    const stored = readStoredFormSession()
    if (stored) {
      setSessions(stored.sessions)
      setAdminSession(stored.adminSession)
      if (stored.tab) setTab(stored.tab)
      if (stored.formKey) setFormKey(stored.formKey)
    }
    setSessionsRestored(true)
  }, [])

  useEffect(() => {
    if (!sessionsRestored) return
    const hasLogin = Boolean(adminSession) || Object.keys(sessions).length > 0
    try {
      if (!hasLogin) {
        window.localStorage.removeItem(FORM_SESSION_STORAGE_KEY)
        return
      }
      window.localStorage.setItem(FORM_SESSION_STORAGE_KEY, JSON.stringify({
        sessions,
        adminSession,
        tab,
        formKey,
      }))
    } catch {
      // Ignore storage failures; login still works for this page session.
    }
  }, [adminSession, formKey, sessions, sessionsRestored, tab])

  const refreshState = useCallback(async (nextFormKey = formKey, options?: { force?: boolean }) => {
    if (!nextFormKey) return
    const cachedState = options?.force ? null : statesByFormKeyRef.current[nextFormKey]
    if (cachedState) {
      applyFormState(cachedState)
      return
    }
    const selectedForm = forms.find(form => form.formKey === nextFormKey)
    setLoadingState(true)
    setStateLoadError('')
    try {
      if (adminSession && selectedForm) {
        const loadedStates = await loadStatesForTab(selectedForm.tab, {
          password: adminSession?.password ?? '',
          force: options?.force === true,
        })
        const selectedState = loadedStates[nextFormKey] ?? statesByFormKeyRef.current[nextFormKey]
        if (selectedState) {
          applyFormState(selectedState)
          if (options?.force === true) sheetFreshLoadedForms.current.add(nextFormKey)
        }
        return
      }
      if (oauthProfile && selectedForm) {
        const loadedStates = await loadStatesForTab(selectedForm.tab, {
          oauth: true,
          force: options?.force === true,
        })
        const selectedState = loadedStates[nextFormKey] ?? statesByFormKeyRef.current[nextFormKey]
        if (selectedState) {
          applyFormState(selectedState)
          if (options?.force === true) sheetFreshLoadedForms.current.add(nextFormKey)
        }
        return
      }
      const requestSeq = ++formStateRequestSeq.current
      latestFormStateRequestSeq.current[nextFormKey] = requestSeq
      const data = await fetchJson<{ state: ScoringFormState }>('/api/forms/state', {
        method: 'POST',
        body: JSON.stringify({ formKey: nextFormKey, force: options?.force === true }),
      })
      if (latestFormStateRequestSeq.current[nextFormKey] !== requestSeq) return
      applyFormState(data.state)
      if (options?.force === true) sheetFreshLoadedForms.current.add(nextFormKey)
      statesByFormKeyRef.current = { ...statesByFormKeyRef.current, [nextFormKey]: data.state }
      setStatesByFormKey(prev => ({ ...prev, [nextFormKey]: data.state }))
    } catch (error) {
      const message = error instanceof Error
        ? (error.name === 'AbortError' ? 'Loading table timed out. Please refresh.' : error.message)
        : String(error)
      setStateLoadError(message)
      notify('err', message)
    } finally {
      setLoadingState(false)
    }
  }, [adminSession, applyFormState, formKey, forms, loadStatesForTab, oauthProfile])

  const selectFormKey = useCallback((nextFormKey: string) => {
    if (nextFormKey && nextFormKey !== formKey) {
      const cachedState = statesByFormKeyRef.current[nextFormKey]
      if (cachedState) applyFormState(cachedState)
    }
    setFormKey(nextFormKey)
    setPasswordInput('')
  }, [applyFormState, formKey])

  useEffect(() => {
    refreshConfig()
  }, [refreshConfig])

  useEffect(() => {
    refreshOAuthProfile()
  }, [refreshOAuthProfile])

  useEffect(() => {
    if (didRouteOauthProfile.current || oauthLoading || !oauthProfile || !forms.length) return
    const editableTarget = forms.find(form => canOAuthEditForm(oauthProfile, form))
    const viewTarget = editableTarget ?? forms.find(form => canOAuthViewForm(oauthProfile, form))
    if (!viewTarget) return
    didRouteOauthProfile.current = true
    setTab(viewTarget.tab)
    setFormKey(viewTarget.formKey)
  }, [forms, oauthLoading, oauthProfile])

  useEffect(() => {
    if (!formKey) return
    if (canLoadSelectedForm) {
      const needsFreshSheetLoad = !sheetFreshLoadedForms.current.has(formKey)
      if (currentState?.form.formKey === formKey && !needsFreshSheetLoad) return
      refreshState(formKey, { force: needsFreshSheetLoad })
      return
    }
    setState(null)
    setDraft([])
    setParticipantsByRound([])
    setStateLoadError('')
    setSelectedRound(0)
  }, [canLoadSelectedForm, currentState?.form.formKey, formKey, refreshState])

  useEffect(() => {
    const liveFormKey = currentForm && canSeeContent ? currentForm.formKey : ''
    if (!liveFormKey) return
    let stopped = false
    let timer: number | undefined

    const schedule = () => {
      if (!stopped) timer = window.setTimeout(sync, 500)
    }

    const sync = async () => {
      if (stopped) return
      if (document.hidden) {
        schedule()
        return
      }
      try {
        const res = await fetch(`/api/forms/live?formKey=${encodeURIComponent(liveFormKey)}&t=${Date.now()}`, { cache: 'no-store' })
        const data = await res.json().catch(() => null) as { ok?: boolean; live?: FormLiveState } | null
        const live = data?.live
        if (data?.ok && live && live.version > (liveVersionByForm.current[liveFormKey] ?? 0)) {
          applyLiveState(live)
        }
      } catch {
        // Live sync is only a fast UI signal; the sheet write remains authoritative.
      } finally {
        schedule()
      }
    }

    sync()
    return () => {
      stopped = true
      if (timer) window.clearTimeout(timer)
    }
  }, [applyLiveState, canSeeContent, currentForm])

  const loginStaff = async () => {
    if (!currentForm || !passwordInput.trim()) return
    try {
      const data = await fetchJson<ScoringFormAuth>('/api/forms/auth', {
        method: 'POST',
        body: JSON.stringify({ formKey: currentForm.formKey, password: passwordInput }),
      })
      if (!data.ok) throw new Error(data.message || 'Wrong password')
      const username = staffChatName(data.username)
      setSessions(prev => ({
        ...prev,
        [currentForm.formKey]: { role: 'staff', username, password: passwordInput },
      }))
      if (!currentForm.blank) {
        await refreshState(currentForm.formKey, { force: true })
      }
      setPasswordInput('')
      notify('ok', `Logged in as ${username}`)
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    }
  }

  const loginAdmin = async () => {
    if (!adminInput.trim()) return
    try {
      const adminTab = currentForm?.tab ?? tab
      const data = await fetchJson<ScoringFormAuth>('/api/forms/auth', {
        method: 'POST',
        body: JSON.stringify({ admin: true, password: adminInput }),
      })
      if (!data.ok) throw new Error(data.message || 'Wrong admin password')
      const statesData = await loadStatesForTab(adminTab, { password: adminInput, force: true })
      adminPreloadedTabs.current.add(`${adminInput}:${adminTab}`)
      const selectedState = formKey ? statesData?.[formKey] ?? statesByFormKeyRef.current[formKey] : null
      if (selectedState) applyFormState(selectedState)
      setAdminSession({ role: 'admin', username: 'Admin', password: adminInput, authMode: 'password' })
      setAdminInput('')
      setShowAdminLogin(false)
      notify('ok', 'Admin unlocked all form tabs')
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    }
  }

  const logoutGoogle = async () => {
    try {
      window.localStorage.removeItem(FORM_SESSION_STORAGE_KEY)
    } catch {
      // Ignore storage failures; Auth.js sign-out still clears the Google session.
    }
    setSessions({})
    setAdminSession(null)
    adminPreloadedTabs.current.clear()
    sheetFreshLoadedForms.current.clear()
    statesByFormKeyRef.current = {}
    setState(null)
    setStatesByFormKey({})
    setDraft([])
    await signOut({ redirectTo: '/form/login' })
  }

  const updateCell = (rowIndex: number, roundIndex: number, value: string) => {
    if (currentState?.form.formKey) markRoundInRef(dirtyRoundsByForm, currentState.form.formKey, roundIndex)
    setDraft(prev => prev.map((row, r) => r === rowIndex
      ? row.map((cell, c) => c === roundIndex ? value : cell)
      : row
    ))
  }

  const updateParticipants = (roundIndex: number, value: string) => {
    if (currentState?.form.formKey) markRoundInRef(dirtyRoundsByForm, currentState.form.formKey, roundIndex)
    setParticipantsByRound(prev => prev.map((cell, index) => index === roundIndex ? value : cell))
  }

  const refreshMoneyDropSpecial = useCallback(async (nextFormKey = currentState?.form.formKey) => {
    if (!nextFormKey) return
    setMoneyDropSpecialLoading(true)
    try {
      const data = await fetchJson<{ state: MoneyDropSpecialState }>('/api/forms/money-drop-special', {
        method: 'POST',
        body: JSON.stringify({ action: 'read', formKey: nextFormKey }),
      })
      delete dirtyMoneyDropRoundsByLiveKey.current[data.state.liveKey]
      delete submittingMoneyDropRoundsByLiveKey.current[data.state.liveKey]
      setMoneyDropSpecial(data.state)
      setMoneyDropSpecialDraft(data.state.rounds.map(round => round.value || ''))
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    } finally {
      setMoneyDropSpecialLoading(false)
    }
  }, [currentState?.form.formKey])

  const updateMoneyDropSpecialDraft = (roundIndex: number, value: string) => {
    if (moneyDropSpecial?.liveKey) markRoundInRef(dirtyMoneyDropRoundsByLiveKey, moneyDropSpecial.liveKey, roundIndex)
    setMoneyDropSpecialDraft(prev => prev.map((item, index) => index === roundIndex ? value : item))
  }

  const confirmMoneyDropSpecial = async (roundIndex: number) => {
    if (!currentState || !session || !moneyDropSpecial) return
    if (!isAdmin && !canEditCurrentForm) {
      notify('warn', 'This form is view-only for your account.')
      return
    }
    const round = moneyDropSpecial.rounds[roundIndex]
    if (!round) return
    if (!isAdmin && (round.confirmed || round.locked)) {
      notify('warn', 'This input is already locked or confirmed.')
      return
    }
    const rawValue = moneyDropSpecialDraft[roundIndex] ?? ''
    const value = roundIndex === 0
      ? (rawValue.toUpperCase().match(/[ABC]\s*[1-9]/g)?.map(item => item.replace(/\s+/g, '')) ?? []).filter((item, index, arr) => arr.indexOf(item) === index).join(', ')
      : rawValue.trim().toUpperCase()
    if (!value || (roundIndex === 1 && !/^[ABC]$/.test(value))) {
      notify('err', roundIndex === 0 ? 'Please enter island names like A2, B3, C9.' : 'Please enter only A, B, or C.')
      return
    }
    if (!window.confirm('Do you confirm? Please check this Money Drop special input before sending.')) return

    markRoundInRef(submittingMoneyDropRoundsByLiveKey, moneyDropSpecial.liveKey, roundIndex)
    setMoneyDropSpecialSaving(prev => new Set(prev).add(roundIndex))
    setMoneyDropSpecialDraft(prev => prev.map((item, index) => index === roundIndex ? value : item))
    setMoneyDropSpecial(prev => prev ? {
      ...prev,
      rounds: prev.rounds.map(item => item.index === roundIndex ? { ...item, value, locked: true, saving: true, error: '' } : item),
    } : prev)
    try {
      const response = await fetchJson<{ queued?: boolean; message?: string }>('/api/forms/money-drop-special', {
        method: 'POST',
        body: JSON.stringify({
          action: 'write',
          formKey: currentState.form.formKey,
          password: session.password,
          oauth: session.authMode === 'oauth',
          admin: isAdmin,
          roundIndex,
          value,
        }),
      })
      if (!response.queued) {
        clearRoundInRef(dirtyMoneyDropRoundsByLiveKey, moneyDropSpecial.liveKey, roundIndex)
        clearRoundInRef(submittingMoneyDropRoundsByLiveKey, moneyDropSpecial.liveKey, roundIndex)
      }
      notify('ok', response.message || 'Sending to sheet...')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      clearRoundInRef(submittingMoneyDropRoundsByLiveKey, moneyDropSpecial.liveKey, roundIndex)
      setMoneyDropSpecial(prev => prev ? {
        ...prev,
        rounds: prev.rounds.map(item => item.index === roundIndex ? { ...item, locked: false, saving: false, error: message } : item),
      } : prev)
      notify('err', message)
    } finally {
      setMoneyDropSpecialSaving(prev => {
        const next = new Set(prev)
        next.delete(roundIndex)
        return next
      })
    }
  }

  const confirmRound = async (roundIndex: number) => {
    if (!currentState || !session) return
    if (!isAdmin && !canEditCurrentForm) {
      notify('warn', 'This form is view-only for your account.')
      return
    }
    const round = currentState.rounds[roundIndex]
    if (!isAdmin && (round.confirmed || round.locked)) {
      notify('warn', 'This round is already locked or confirmed.')
      return
    }
    const participants = defaultParticipants(participantsByRound[roundIndex] ?? '')
    const validated = validatedColumn(currentState, draft, roundIndex, fillToRank, participants)
    if (!validated.ok) {
      notify('err', validated.message || 'Invalid data')
      return
    }
    if (!validated.values.some(value => String(value ?? '').trim())) {
      notify('err', 'Please enter data before confirming.')
      return
    }
    if (!window.confirm('Do you confirm? Please check the information carefully before sending.')) return

    markRoundInRef(submittingRoundsByForm, currentState.form.formKey, roundIndex)
    setSavingRounds(prev => {
      const next = new Set(prev)
      next.add(roundIndex)
      return next
    })
    setDraft(prev => prev.map((row, rowIndex) => row.map((cell, colIndex) => (
      colIndex === roundIndex ? validated.values[rowIndex] ?? '' : cell
    ))))
    setParticipantsByRound(prev => prev.map((cell, index) => index === roundIndex ? participants : cell))
    setState(prev => {
      if (!prev || prev.form.formKey !== currentState.form.formKey) return prev
      return {
        ...prev,
        fillToRank,
        values: prev.values.map((row, rowIndex) => row.map((cell, colIndex) => (
          colIndex === roundIndex ? validated.values[rowIndex] ?? '' : cell
        ))),
        rounds: prev.rounds.map((item, index) => index === roundIndex
          ? { ...item, participants, confirmed: false, locked: true, saving: true, error: '' }
          : item
        ),
      }
    })
    setStatesByFormKey(prev => {
      const cached = prev[currentState.form.formKey]
      if (!cached) return prev
      return {
        ...prev,
        [currentState.form.formKey]: {
          ...cached,
          fillToRank,
          values: cached.values.map((row, rowIndex) => row.map((cell, colIndex) => (
            colIndex === roundIndex ? validated.values[rowIndex] ?? '' : cell
          ))),
          rounds: cached.rounds.map((item, index) => index === roundIndex
            ? { ...item, participants, confirmed: false, locked: true, saving: true, error: '' }
            : item
          ),
        },
      }
    })
    try {
      const response = await fetchJson<{ queued?: boolean; message?: string }>('/api/forms/write', {
        method: 'POST',
        body: JSON.stringify({
          formKey: currentState.form.formKey,
          password: session.password,
          oauth: session.authMode === 'oauth',
          admin: isAdmin,
          roundIndex,
          fillToRank,
          participants,
          values: validated.values,
        }),
      })
      if (response.queued) {
        notify('ok', response.message || 'Sending to sheet...')
        return
      }
      clearRoundInRef(dirtyRoundsByForm, currentState.form.formKey, roundIndex)
      clearRoundInRef(submittingRoundsByForm, currentState.form.formKey, roundIndex)
      setState(prev => {
        if (!prev || prev.form.formKey !== currentState.form.formKey) return prev
        return {
          ...prev,
          fillToRank,
          values: prev.values.map((row, rowIndex) => row.map((cell, colIndex) => (
            colIndex === roundIndex ? validated.values[rowIndex] ?? '' : cell
          ))),
          rounds: prev.rounds.map((item, index) => index === roundIndex
            ? { ...item, participants, confirmed: true, locked: false, saving: false, error: '' }
            : item
          ),
        }
      })
      setStatesByFormKey(prev => {
        const cached = prev[currentState.form.formKey]
        if (!cached) return prev
        return {
          ...prev,
          [currentState.form.formKey]: {
            ...cached,
            fillToRank,
            values: cached.values.map((row, rowIndex) => row.map((cell, colIndex) => (
              colIndex === roundIndex ? validated.values[rowIndex] ?? '' : cell
            ))),
            rounds: cached.rounds.map((item, index) => index === roundIndex
              ? { ...item, participants, confirmed: true, locked: false, saving: false, error: '' }
              : item
            ),
          },
        }
      })
      notify('ok', `Saved ${round.label}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      clearRoundInRef(submittingRoundsByForm, currentState.form.formKey, roundIndex)
      setState(prev => {
        if (!prev || prev.form.formKey !== currentState.form.formKey) return prev
        return {
          ...prev,
          rounds: prev.rounds.map((item, index) => index === roundIndex
            ? { ...item, locked: false, saving: false, error: message }
            : item
          ),
        }
      })
      setStatesByFormKey(prev => {
        const cached = prev[currentState.form.formKey]
        if (!cached) return prev
        return {
          ...prev,
          [currentState.form.formKey]: {
            ...cached,
            rounds: cached.rounds.map((item, index) => index === roundIndex
              ? { ...item, locked: false, saving: false, error: message }
              : item
            ),
          },
        }
      })
      notify('err', message)
    } finally {
      setSavingRounds(prev => {
        const next = new Set(prev)
        next.delete(roundIndex)
        return next
      })
    }
  }

  const setRoundControl = async (roundIndex: number, patch: Record<string, unknown>) => {
    if (!currentState || (!adminSession && !oauthIsAdmin)) return
    setControlBusy(true)
    try {
      const useOAuthControl = oauthIsAdmin && !adminSession
      const response = await fetchJson<{
        data?: { state?: ScoringFormState }
        state?: ScoringFormState
      }>('/api/forms/control', {
        method: 'POST',
        body: JSON.stringify({
          formKey: currentState.form.formKey,
          password: adminSession?.password ?? '',
          oauth: useOAuthControl,
          roundIndex,
          ...patch,
        }),
      })
      const returnedState = response.data?.state ?? response.state
      if (returnedState) {
        applyFormState(returnedState)
        setStatesByFormKey(prev => ({ ...prev, [returnedState.form.formKey]: returnedState }))
        notify('ok', 'Round control updated')
        return
      }
      setState(prev => {
        if (!prev || prev.form.formKey !== currentState.form.formKey) return prev
        return {
          ...prev,
          rounds: prev.rounds.map((round, index) => index === roundIndex ? applyRoundControlPatch(round, patch) : round),
        }
      })
      setStatesByFormKey(prev => {
        const cached = prev[currentState.form.formKey]
        if (!cached) return prev
        return {
          ...prev,
          [currentState.form.formKey]: {
            ...cached,
            rounds: cached.rounds.map((round, index) => index === roundIndex ? applyRoundControlPatch(round, patch) : round),
          },
        }
      })
      notify('ok', 'Round control updated')
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    } finally {
      setControlBusy(false)
    }
  }

  const setMoneyDropSpecialControl = async (roundIndex: number, patch: Record<string, unknown>) => {
    if (!moneyDropSpecial || (!adminSession && !oauthIsAdmin)) return
    setControlBusy(true)
    try {
      const useOAuthControl = oauthIsAdmin && !adminSession
      await fetchJson('/api/forms/control', {
        method: 'POST',
        body: JSON.stringify({
          formKey: moneyDropSpecial.liveKey,
          password: adminSession?.password ?? '',
          oauth: useOAuthControl,
          roundIndex,
          ...patch,
        }),
      })
      setMoneyDropSpecial(prev => prev ? {
        ...prev,
        rounds: prev.rounds.map(round => round.index === roundIndex ? {
          ...round,
          confirmed: patch.confirmed === undefined ? round.confirmed : patch.confirmed === true,
          locked: patch.locked === undefined ? round.locked : patch.locked === true,
          saving: false,
          error: '',
        } : round),
      } : prev)
      notify('ok', 'Money Drop special control updated')
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    } finally {
      setControlBusy(false)
    }
  }

  useEffect(() => {
    if (!adminSession || !forms.length) return
    const key = `${adminSession.password}:${tab}`
    if (adminPreloadedTabs.current.has(key)) return
    adminPreloadedTabs.current.add(key)
    loadStatesForTab(tab, { password: adminSession.password, force: true }).catch(error => {
      adminPreloadedTabs.current.delete(key)
      notify('err', error instanceof Error ? error.message : String(error))
    })
  }, [adminSession, forms.length, loadStatesForTab, tab])

  useEffect(() => {
    if (!oauthProfile || !forms.length) return
    const key = `oauth:${oauthProfile.email || oauthProfile.nickname}:${tab}`
    if (adminPreloadedTabs.current.has(key)) return
    adminPreloadedTabs.current.add(key)
    loadStatesForTab(tab, { oauth: true, force: true }).catch(error => {
      adminPreloadedTabs.current.delete(key)
      notify('err', error instanceof Error ? error.message : String(error))
    })
  }, [forms.length, loadStatesForTab, oauthProfile, tab])

  const openBulkControl = (kind: BulkControlKind) => {
    if (!currentState || (!adminSession && !oauthIsAdmin)) return
    setBulkControl({ kind })
  }

  const runBulkControl = async (kind: BulkControlKind, scope: BulkControlScope) => {
    if (!currentState || (!adminSession && !oauthIsAdmin)) return
    const targets = bulkTargetsForScope(scope)
    if (!targets.length) {
      notify('warn', 'No form rounds found for this scope')
      return
    }
    const patch = kind === 'edit'
      ? { confirmed: false, locked: false, clearDeadline: true }
      : { locked: false, clearDeadline: true }
    setControlBusy(true)
    try {
      const useOAuthControl = oauthIsAdmin && !adminSession
      await fetchJson('/api/forms/control', {
        method: 'POST',
        body: JSON.stringify({
          password: adminSession?.password ?? '',
          oauth: useOAuthControl,
          allRounds: true,
          targets,
          ...patch,
        }),
      })
      applyControlPatchLocally(targets, patch)
      setBulkControl(null)
      notify('ok', kind === 'edit' ? 'Selected rounds can be edited again' : 'Selected rounds are unlocked')
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    } finally {
      setControlBusy(false)
    }
  }

  useEffect(() => {
    if (!currentState || !canSeeContent || currentState.form.user.toLowerCase().replace(/\s+/g, ' ').trim() !== 'money drop') {
      setMoneyDropSpecial(null)
      setMoneyDropSpecialDraft(['', ''])
      return
    }
    refreshMoneyDropSpecial(currentState.form.formKey)
  }, [canSeeContent, currentState?.form.formKey, currentState?.form.user, refreshMoneyDropSpecial])

  useEffect(() => {
    const liveKey = moneyDropSpecial?.liveKey ?? ''
    if (!liveKey) return
    let stopped = false
    let timer: number | undefined

    const schedule = () => {
      if (!stopped) timer = window.setTimeout(sync, 700)
    }

    const sync = async () => {
      if (stopped) return
      if (document.hidden) {
        schedule()
        return
      }
      try {
        const res = await fetch(`/api/forms/live?formKey=${encodeURIComponent(liveKey)}&t=${Date.now()}`, { cache: 'no-store' })
        const data = await res.json().catch(() => null) as { ok?: boolean; live?: FormLiveState } | null
        if (data?.ok && data.live) applyMoneyDropSpecialLive(data.live)
      } catch {
        // This is only the fast UI signal. The sheet write remains authoritative.
      } finally {
        schedule()
      }
    }

    sync()
    return () => {
      stopped = true
      if (timer) window.clearTimeout(timer)
    }
  }, [applyMoneyDropSpecialLive, moneyDropSpecial?.liveKey])

  const selectedAutoRow = currentState && currentState.form.kind !== 'match-single' ? fillToRank : -1
  const visibleRankLabels = currentState
    ? currentState.rankLabels.slice(0, currentState.form.rankCount || currentState.rankLabels.length)
    : []
  const visibleRounds = currentState
    ? currentState.rounds.slice(0, currentState.form.maxRounds || currentState.rounds.length)
    : []
  const isScoreNumberForm = currentState?.form.kind === 'score-number'
  const isScoreInputForm = currentState?.form.kind === 'score-number' || currentState?.form.kind === 'score-unsigned'
  const isMoneyDropForm = currentState?.form.user.toLowerCase().replace(/\s+/g, ' ').trim() === 'money drop'
  const usesAutoRemainder = currentState?.form.usesAutoRemainder === true
  const showAutoControls = Boolean(currentState && usesAutoRemainder)
  const effectiveSelectedAutoRow = usesAutoRemainder ? selectedAutoRow : -1
  const headerTitle = session ? `Staff Form for ${session.username}` : 'Staff Form'
  const profileLabel = oauthProfile?.nickname || oauthEmail
  const adminRoundControls = (adminSession || oauthIsAdmin) && selectedRoundMeta ? (
    <div className="form-admin-controls">
      <button type="button" disabled={controlBusy} onClick={() => setRoundControl(selectedRound, { locked: !selectedRoundMeta.locked })} className="btn btn-ghost">
        {selectedRoundMeta.locked ? <Unlock size={13} /> : <Lock size={13} />}
        {selectedRoundMeta.locked ? 'Unlock' : 'Lock'}
      </button>
      <button type="button" disabled={controlBusy} onClick={() => setRoundControl(selectedRound, { confirmed: false, locked: false, clearDeadline: true })} className="btn btn-ghost">
        Edit again
      </button>
      <button type="button" disabled={controlBusy} onClick={() => openBulkControl('edit')} className="btn btn-ghost">
        All edit again
      </button>
      <button type="button" disabled={controlBusy} onClick={() => openBulkControl('unlock')} className="btn btn-ghost">
        Unlock all
      </button>
    </div>
  ) : null

  return (
    <div className="wire-page-full form-page">
      <header className="wire-topbar form-topbar">
        <div className="form-topbar-left">
          <HomeButton className="bg-white/10 border-white/20 text-white hover:text-white" />
          <div>
            <div className="wire-title">{headerTitle}</div>
          </div>
        </div>
        <div className="form-topbar-actions">
          {oauthProfile && (
            <div className="form-user-badge">
              <strong>Hello, {profileLabel}</strong>
              <span>หน้าที่: {oauthProfile.job || '-'}</span>
              <span>Role: {oauthProfile.role}</span>
            </div>
          )}
          {session?.role === 'staff' && <GroupChat actor={session.username} label="Report" mode="report" />}
          {(adminSession || oauthIsAdmin) && <GroupChat actor="admin" label="Report" mode="report" reportTargets={reportTargets} />}
          {(adminSession || oauthIsAdmin) && (
            <button
              type="button"
              className="btn form-admin-status-button"
              onClick={adminSession ? () => setAdminSession(null) : undefined}
            >
              <ShieldCheck size={15} /> Admin
            </button>
          )}
          <button type="button" className="btn form-logout-button" onClick={logoutGoogle}>
            <LogOut size={15} /> Log out
          </button>
        </div>
      </header>

      <main className="wire-scroll">
        <div className="wire-content form-content">
          {notice && (
            <div className={clsx('form-notice', `form-notice-${notice.type}`)}>
              {notice.text}
            </div>
          )}

          <section className="form-shell">
            <div className="form-tabs">
              {FORM_TABS.map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    const targetForms = grouped[item] ?? []
                    const targetForm = targetForms.find(form => canOAuthEditForm(oauthProfile, form))
                      ?? targetForms.find(form => canOAuthViewForm(oauthProfile, form))
                      ?? targetForms[0]
                    setTab(item)
                    selectFormKey(targetForm?.formKey ?? '')
                  }}
                  className={clsx('btn', tab === item ? 'btn-primary' : 'btn-ghost')}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="form-subtabs">
              {loadingConfig || oauthLoading ? (
                <div className="form-loading">Loading forms...</div>
              ) : currentForms.map(form => (
                <button
                  key={form.formKey}
                  type="button"
                  onClick={() => {
                    selectFormKey(form.formKey)
                  }}
                  className={clsx(
                    'form-subtab',
                    form.formKey === currentForm?.formKey && 'active',
                    canOAuthViewForm(oauthProfile, form) && !canOAuthEditForm(oauthProfile, form) && 'view-only',
                  )}
                >
                  <span>{form.user}</span>
                  {adminSession || sessions[form.formKey] || canOAuthEditForm(oauthProfile, form)
                    ? <CheckCircle2 size={14} />
                    : canOAuthViewForm(oauthProfile, form)
                      ? <Eye size={13} />
                      : <Lock size={13} />}
                </button>
              ))}
            </div>

            {loadingConfig || oauthLoading ? (
              <div className="form-empty-state form-loading-panel">
                <div className="form-loading">Loading forms...</div>
              </div>
            ) : !currentForm ? (
              <div className="form-empty-state">No form config found.</div>
            ) : oauthError ? (
              <div className="form-empty-state">
                <div>{oauthError}</div>
                <button type="button" onClick={refreshOAuthProfile} className="btn btn-primary">
                  <RefreshCw size={14} /> Retry
                </button>
              </div>
            ) : !canSeeContent ? (
              <div className="form-unlock-card">
                <div className="form-unlock-icon"><KeyRound size={22} /></div>
                <div>
                  <h2>{currentForm.user}</h2>
                </div>
                <div className="form-unlock-row">
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={event => setPasswordInput(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') loginStaff() }}
                    placeholder="Password"
                    className="input-base"
                  />
                  <button type="button" onClick={loginStaff} className="btn btn-primary" disabled={!passwordInput.trim()}>
                    Unlock
                  </button>
                </div>
              </div>
            ) : currentForm.blank ? (
              <div className="form-empty-state">
                <FileSpreadsheet size={26} />
                <div>{currentForm.user} is left blank for now.</div>
              </div>
            ) : loadingState && !currentState ? (
              <div className="form-empty-state">Loading table...</div>
            ) : !currentState ? (
              <div className="form-empty-state">
                <div>{stateLoadError || 'Table is not loaded.'}</div>
                <button type="button" onClick={() => refreshState(currentForm.formKey, { force: true })} className="btn btn-primary">
                  <RefreshCw size={14} /> Retry
                </button>
              </div>
            ) : (
              <div className="form-workspace">
                <div className="form-table-header">
                  <div>
                    <h1>{currentState.title || currentState.form.user}</h1>
                  </div>
                  <button type="button" onClick={() => refreshState(currentState.form.formKey, { force: true })} className="btn btn-ghost">
                    <RefreshCw size={14} /> Refresh
                  </button>
                </div>

                {isAdmin && (
                  <div className="form-round-toolbar">
                    {visibleRounds.map((round, index) => {
                      const meta = roundDisplayMeta(currentState, round, index)
                      return (
                        <button
                          key={round.index}
                          type="button"
                          onClick={() => setSelectedRound(index)}
                          className={clsx('form-round-chip', selectedRound === index && 'active', round.confirmed && 'confirmed', round.locked && 'locked')}
                        >
                          <span>{meta.label}</span>
                          {round.confirmed ? <CheckCircle2 size={13} /> : round.locked ? <Lock size={13} /> : <Clock size={13} />}
                        </button>
                      )
                    })}
                  </div>
                )}

                {showAutoControls && (
                  <div className="form-settings-row">
                    <>
                      <label>
                        <span>กรอกถึงอันดับที่ :</span>
                        <input
                          type="number"
                          min={1}
                          max={11}
                          value={fillToRank}
                          onChange={event => setFillToRank(clampFillToRank(Number(event.target.value)))}
                          disabled={!isAdmin}
                        />
                      </label>
                      {isAdmin && (
                        <label>
                          <span>Houses playing in selected round</span>
                          <input
                            value={participantsByRound[selectedRound] ?? ''}
                            onChange={event => updateParticipants(selectedRound, event.target.value)}
                            onBlur={event => updateParticipants(selectedRound, defaultParticipants(event.target.value))}
                            disabled={!selectedCanEdit}
                          />
                        </label>
                      )}
                    </>
                  </div>
                )}

                {isAdmin && adminRoundControls}

                <div className="form-table-wrap">
                  <table className={clsx('form-score-table', visibleRounds.length <= 2 && 'compact-rounds')}>
                    <thead>
                      <tr>
                        <th>{isScoreInputForm ? 'บ้าน' : 'Rank'}</th>
                        {visibleRounds.map((round, roundIndex) => {
                          const meta = roundDisplayMeta(currentState, round, roundIndex)
                          return (
                            <th key={round.index} className={clsx(selectedRound === roundIndex && 'active-round')}>
                              <div>{meta.label}</div>
                              <small>Wave {meta.wave}</small>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRankLabels.map((label, rowIndex) => (
                        <tr key={`${label}-${rowIndex}`} className={clsx(rowIndex === effectiveSelectedAutoRow && 'auto-row')}>
                          <th>{isScoreInputForm ? (label || `บ้าน ${rowIndex + 1}`) : (label || `Rank ${rowIndex + 1}`)}</th>
                          {visibleRounds.map((round, roundIndex) => {
                            const editable = Boolean(session && canEditCurrentForm && (isAdmin || (!round.confirmed && !round.locked && !(round.deadlineAt && Date.now() > new Date(round.deadlineAt).getTime()))))
                            const isAuto = usesAutoRemainder && rowIndex === fillToRank
                            const manualValues = draft.slice(0, fillToRank).map(row => row[roundIndex] ?? '')
                            const enteredHouseCount = new Set(manualValues.flatMap(value => parseHouseList(value))).size
                            const autoValue = enteredHouseCount >= (currentState.form.autoAfterHouseCount || fillToRank)
                              ? remainingHouseText(participantsByRound[roundIndex] ?? '', manualValues)
                              : ''
                            return (
                              <td key={`${round.index}-${rowIndex}`} className={clsx(selectedRound === roundIndex && 'active-round')}>
                                <input
                                  value={isAuto ? autoValue : draft[rowIndex]?.[roundIndex] ?? ''}
                                  onChange={event => updateCell(rowIndex, roundIndex, isScoreInputForm ? sanitizeScoreInput(event.target.value, isScoreNumberForm) : event.target.value)}
                                  onBlur={event => updateCell(rowIndex, roundIndex, isScoreInputForm ? normalizeScoreText(event.target.value, isScoreNumberForm) : normalizeHouseText(event.target.value, currentState.form.allowTies))}
                                  disabled={!editable || isAuto}
                                  className={clsx(isAuto && 'auto-input')}
                                  inputMode={isScoreInputForm ? 'numeric' : undefined}
                                />
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                      {showAutoControls && (
                        <tr className="form-participant-row">
                          <th>Playing</th>
                          {visibleRounds.map((round, roundIndex) => {
                            const editable = Boolean(session && canEditCurrentForm && (isAdmin || (!round.confirmed && !round.locked && !(round.deadlineAt && Date.now() > new Date(round.deadlineAt).getTime()))))
                            return (
                              <td key={round.index} className={clsx(selectedRound === roundIndex && 'active-round')}>
                                <input
                                  value={participantsByRound[roundIndex] ?? ''}
                                  onChange={event => updateParticipants(roundIndex, event.target.value)}
                                  onBlur={event => updateParticipants(roundIndex, defaultParticipants(event.target.value))}
                                  disabled={!editable}
                                />
                              </td>
                            )
                          })}
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th>Confirm</th>
                        {visibleRounds.map((round, roundIndex) => {
                          const timedOut = Boolean(round.deadlineAt && Date.now() > new Date(round.deadlineAt).getTime())
                          const isSending = savingRounds.has(roundIndex) || round.saving === true
                          const disabled = isSending || !canEditCurrentForm || (!isAdmin && (round.confirmed || round.locked || timedOut))
                          return (
                            <td key={round.index} className={clsx(selectedRound === roundIndex && 'active-round')}>
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => confirmRound(roundIndex)}
                                className={clsx('form-confirm-btn', round.confirmed && 'confirmed')}
                              >
                                {isSending ? 'Sending...' : round.confirmed ? 'Confirmed' : 'Confirm'}
                                {!round.confirmed && !isSending && <Send size={13} />}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {isScoreNumberForm && (
                  <div className="form-score-note">
                    <strong>หมายเหตุ</strong>
                    <span>ถ้าเสียใส่ - เช่น -500</span>
                    <span>ถ้าบวก ใส่แค่เลข</span>
                  </div>
                )}
                {isMoneyDropForm && (
                  <div className="moneydrop-special-card">
                    <div className="moneydrop-special-header">
                      <div>
                        <h2>Money Drop special input</h2>
                      </div>
                      <button type="button" onClick={() => refreshMoneyDropSpecial(currentState.form.formKey)} className="btn btn-ghost" disabled={moneyDropSpecialLoading}>
                        <RefreshCw size={13} className={clsx(moneyDropSpecialLoading && 'animate-spin')} />
                        Refresh
                      </button>
                    </div>
                    <div className="form-table-wrap moneydrop-special-wrap">
                      <table className="form-score-table moneydrop-special-table">
                        <thead>
                          <tr>
                            <th>-</th>
                            {(moneyDropSpecial?.rounds ?? [
                              { index: 0, label: 'Wave 2', wave: 2, value: '', confirmed: false, locked: false },
                              { index: 1, label: 'Wave 4', wave: 4, value: '', confirmed: false, locked: false },
                            ]).map(round => (
                              <th key={round.index}>
                                <div className="moneydrop-special-head-cell">
                                  <span>{round.label}</span>
                                  {(adminSession || oauthIsAdmin) && moneyDropSpecial && (
                                    <div className="moneydrop-special-head-actions">
                                      <button type="button" className="btn btn-ghost" disabled={controlBusy} onClick={() => setMoneyDropSpecialControl(round.index, { locked: !round.locked })}>
                                        {round.locked ? <Unlock size={12} /> : <Lock size={12} />}
                                        {round.locked ? 'Unlock' : 'Lock'}
                                      </button>
                                      <button type="button" className="btn btn-ghost" disabled={controlBusy} onClick={() => setMoneyDropSpecialControl(round.index, { confirmed: false, locked: false, clearDeadline: true })}>
                                        Edit
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                          <tr>
                            <th>Input</th>
                            {(moneyDropSpecial?.rounds ?? []).map(round => {
                              const isSending = moneyDropSpecialSaving.has(round.index) || round.saving === true
                              const editable = Boolean(session && canEditCurrentForm && (isAdmin || (!round.confirmed && !round.locked && !isSending)))
                              return (
                                <td key={round.index}>
                                  <input
                                    value={moneyDropSpecialDraft[round.index] ?? ''}
                                    onChange={event => updateMoneyDropSpecialDraft(round.index, event.target.value)}
                                    onBlur={event => updateMoneyDropSpecialDraft(round.index, round.index === 0
                                      ? (event.target.value.toUpperCase().match(/[ABC]\s*[1-9]/g)?.map(item => item.replace(/\s+/g, '')) ?? []).filter((item, index, arr) => arr.indexOf(item) === index).join(', ')
                                      : event.target.value.trim().toUpperCase())}
                                    disabled={!editable}
                                    placeholder={round.index === 0 ? 'A2, B3, C9' : 'A / B / C'}
                                  />
                                  {round.error && <div className="form-round-error">{round.error}</div>}
                                </td>
                              )
                            })}
                          </tr>
                        </tbody>
                        <tfoot>
                          <tr>
                            <th>Confirm</th>
                            {(moneyDropSpecial?.rounds ?? []).map(round => {
                              const isSending = moneyDropSpecialSaving.has(round.index) || round.saving === true
                              const disabled = isSending || !canEditCurrentForm || (!isAdmin && (round.confirmed || round.locked))
                              return (
                                <td key={round.index}>
                                  <button type="button" className={clsx('form-confirm-btn', round.confirmed && 'confirmed')} disabled={disabled} onClick={() => confirmMoneyDropSpecial(round.index)}>
                                    {isSending ? 'Sending...' : round.confirmed ? 'Confirmed' : 'Confirm'}
                                    {!round.confirmed && !isSending && <Send size={13} />}
                                  </button>
                                </td>
                              )
                            })}
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {bulkControl && (
            <div className="form-control-dialog-backdrop" role="presentation" onClick={() => !controlBusy && setBulkControl(null)}>
              <div className="form-control-dialog" role="dialog" aria-modal="true" aria-labelledby="form-control-dialog-title" onClick={event => event.stopPropagation()}>
                <div>
                  <h2 id="form-control-dialog-title">
                    {bulkControl.kind === 'edit' ? 'Allow edit again' : 'Unlock all'}
                  </h2>
                  <p>Choose how wide this admin action should apply.</p>
                </div>
                <div className="form-control-dialog-options">
                  <button type="button" disabled={controlBusy} onClick={() => runBulkControl(bulkControl.kind, 'form')}>
                    <strong>This subtab only</strong>
                    <span>All columns in {currentForm?.user ?? 'this form'}</span>
                  </button>
                  <button type="button" disabled={controlBusy} onClick={() => runBulkControl(bulkControl.kind, 'tab')}>
                    <strong>All subtabs in this tab</strong>
                    <span>{tab}</span>
                  </button>
                  <button type="button" disabled={controlBusy} onClick={() => runBulkControl(bulkControl.kind, 'all')}>
                    <strong>All tabs</strong>
                    <span>Every loaded scoring form</span>
                  </button>
                </div>
                <button type="button" className="btn btn-ghost" disabled={controlBusy} onClick={() => setBulkControl(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <ContactFooter className="form-footer" />
        </div>
      </main>
    </div>
  )
}
