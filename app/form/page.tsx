'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, Clock, FileSpreadsheet, KeyRound, Lock, RefreshCw, Send, Settings2, ShieldCheck, Unlock } from 'lucide-react'
import ContactFooter from '@/components/ContactFooter'
import GroupChat from '@/components/GroupChat'
import HomeButton from '@/components/HomeButton'
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
}

const FORM_TABS = ['เช้าล่าง', 'เช้าบน', 'Games บ่าย']

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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) throw new Error(data?.message || `Request failed: ${res.status}`)
  return data
}

export default function FormPage() {
  const [forms, setForms] = useState<ScoringFormConfig[]>([])
  const [tab, setTab] = useState(FORM_TABS[0])
  const [formKey, setFormKey] = useState('')
  const [state, setState] = useState<ScoringFormState | null>(null)
  const [draft, setDraft] = useState<string[][]>([])
  const [participantsByRound, setParticipantsByRound] = useState<string[]>([])
  const [fillToRank, setFillToRank] = useState(3)
  const [selectedRound, setSelectedRound] = useState(0)
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [adminSession, setAdminSession] = useState<Session | null>(null)
  const [passwordInput, setPasswordInput] = useState('')
  const [adminInput, setAdminInput] = useState('')
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [loadingState, setLoadingState] = useState(false)
  const [savingRound, setSavingRound] = useState<number | null>(null)
  const [controlBusy, setControlBusy] = useState(false)
  const [notice, setNotice] = useState<{ type: 'ok' | 'err' | 'warn'; text: string } | null>(null)
  const grouped = useMemo(() => groupByTab(forms), [forms])
  const currentForms = grouped[tab] ?? []
  const currentForm = forms.find(form => form.formKey === formKey) ?? currentForms[0] ?? null
  const reportTargets = useMemo(() => {
    const seen = new Set<string>()
    return forms.flatMap(form => {
      const value = staffChatName(form.user)
      if (seen.has(value)) return []
      seen.add(value)
      return [{ value, label: value }]
    })
  }, [forms])
  const session = currentForm ? adminSession ?? sessions[currentForm.formKey] ?? null : adminSession
  const canSeeContent = Boolean(currentForm && (adminSession || sessions[currentForm.formKey]))
  const canLoadSelectedForm = Boolean(formKey && (adminSession || sessions[formKey]))
  const isAdmin = session?.role === 'admin'
  const selectedRoundMeta = state?.rounds[selectedRound] ?? null
  const selectedIsTimedOut = Boolean(selectedRoundMeta?.deadlineAt && Date.now() > new Date(selectedRoundMeta.deadlineAt).getTime())
  const selectedCanEdit = Boolean(state && session && (isAdmin || (!selectedRoundMeta?.confirmed && !selectedRoundMeta?.locked && !selectedIsTimedOut)))

  const notify = (type: 'ok' | 'err' | 'warn', text: string) => {
    setNotice({ type, text })
    window.setTimeout(() => setNotice(null), 4200)
  }

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

  const refreshState = useCallback(async (nextFormKey = formKey) => {
    if (!nextFormKey) return
    setLoadingState(true)
    try {
      const data = await fetchJson<{ state: ScoringFormState }>('/api/forms/state', {
        method: 'POST',
        body: JSON.stringify({ formKey: nextFormKey }),
      })
      setState(data.state)
      setDraft(blankDraft(data.state))
      setFillToRank(clampFillToRank(data.state.fillToRank || data.state.form.defaultFillToRank))
      setParticipantsByRound(data.state.rounds.map(round => defaultParticipants(round.participants)))
      const maxVisibleRounds = data.state.form.maxRounds || data.state.rounds.length
      setSelectedRound(prev => Math.min(prev, Math.max(0, Math.min(data.state.rounds.length, maxVisibleRounds) - 1)))
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingState(false)
    }
  }, [formKey])

  useEffect(() => {
    refreshConfig()
  }, [refreshConfig])

  useEffect(() => {
    if (!formKey) return
    if (canLoadSelectedForm) {
      refreshState(formKey)
      return
    }
    setState(null)
    setDraft([])
    setParticipantsByRound([])
    setSelectedRound(0)
  }, [canLoadSelectedForm, formKey, refreshState])

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
      setPasswordInput('')
      notify('ok', `Logged in as ${username}`)
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    }
  }

  const loginAdmin = async () => {
    if (!adminInput.trim()) return
    try {
      const data = await fetchJson<ScoringFormAuth>('/api/forms/auth', {
        method: 'POST',
        body: JSON.stringify({ admin: true, password: adminInput }),
      })
      if (!data.ok) throw new Error(data.message || 'Wrong admin password')
      setAdminSession({ role: 'admin', username: 'Admin', password: adminInput })
      setAdminInput('')
      setShowAdminLogin(false)
      notify('ok', 'Admin unlocked all form tabs')
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    }
  }

  const updateCell = (rowIndex: number, roundIndex: number, value: string) => {
    setDraft(prev => prev.map((row, r) => r === rowIndex
      ? row.map((cell, c) => c === roundIndex ? value : cell)
      : row
    ))
  }

  const updateParticipants = (roundIndex: number, value: string) => {
    setParticipantsByRound(prev => prev.map((cell, index) => index === roundIndex ? value : cell))
  }

  const confirmRound = async (roundIndex: number) => {
    if (!state || !session) return
    const round = state.rounds[roundIndex]
    if (!isAdmin && (round.confirmed || round.locked)) {
      notify('warn', 'This round is already locked or confirmed.')
      return
    }
    const participants = defaultParticipants(participantsByRound[roundIndex] ?? '')
    const validated = validatedColumn(state, draft, roundIndex, fillToRank, participants)
    if (!validated.ok) {
      notify('err', validated.message || 'Invalid data')
      return
    }
    if (!window.confirm('Do you confirm? Please check the information carefully before sending.')) return

    setSavingRound(roundIndex)
    try {
      await fetchJson('/api/forms/write', {
        method: 'POST',
        body: JSON.stringify({
          formKey: state.form.formKey,
          password: session.password,
          admin: isAdmin,
          roundIndex,
          fillToRank,
          participants,
          values: validated.values,
        }),
      })
      setDraft(prev => prev.map((row, rowIndex) => row.map((cell, colIndex) => (
        colIndex === roundIndex ? validated.values[rowIndex] ?? '' : cell
      ))))
      setParticipantsByRound(prev => prev.map((cell, index) => index === roundIndex ? participants : cell))
      setState(prev => {
        if (!prev || prev.form.formKey !== state.form.formKey) return prev
        return {
          ...prev,
          fillToRank,
          values: prev.values.map((row, rowIndex) => row.map((cell, colIndex) => (
            colIndex === roundIndex ? validated.values[rowIndex] ?? '' : cell
          ))),
          rounds: prev.rounds.map((item, index) => index === roundIndex
            ? { ...item, participants, confirmed: true, locked: false }
            : item
          ),
        }
      })
      notify('ok', `Saved ${round.label}`)
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    } finally {
      setSavingRound(null)
    }
  }

  const setRoundControl = async (roundIndex: number, patch: Record<string, unknown>) => {
    if (!state || !adminSession) return
    setControlBusy(true)
    try {
      await fetchJson('/api/forms/control', {
        method: 'POST',
        body: JSON.stringify({
          formKey: state.form.formKey,
          password: adminSession.password,
          roundIndex,
          ...patch,
        }),
      })
      setState(prev => {
        if (!prev || prev.form.formKey !== state.form.formKey) return prev
        return {
          ...prev,
          rounds: prev.rounds.map((round, index) => {
            if (index !== roundIndex) return round
            const next = { ...round }
            if (patch.locked !== undefined) next.locked = patch.locked === true
            if (patch.confirmed !== undefined) next.confirmed = patch.confirmed === true
            if (patch.deadlineMinutes !== undefined) {
              const minutes = Math.max(1, Math.min(240, Number(patch.deadlineMinutes) || 10))
              next.deadlineAt = new Date(Date.now() + minutes * 60000).toISOString()
            }
            if (patch.clearDeadline === true) next.deadlineAt = ''
            return next
          }),
        }
      })
      notify('ok', 'Round control updated')
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    } finally {
      setControlBusy(false)
    }
  }

  const selectedAutoRow = state?.form.kind !== 'match-single' ? fillToRank : -1
  const visibleRankLabels = state
    ? state.rankLabels.slice(0, state.form.rankCount || state.rankLabels.length)
    : []
  const visibleRounds = state
    ? state.rounds.slice(0, state.form.maxRounds || state.rounds.length)
    : []
  const usesAutoRemainder = state?.form.usesAutoRemainder === true
  const showAutoControls = Boolean(state && usesAutoRemainder)
  const effectiveSelectedAutoRow = usesAutoRemainder ? selectedAutoRow : -1
  const headerTitle = session ? `Staff Form for ${session.username}` : 'Staff Form'

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
          {session?.role === 'staff' && <GroupChat actor={session.username} label="Report" mode="report" />}
          {adminSession && <GroupChat actor="admin" label="Report" mode="report" reportTargets={reportTargets} />}
          {adminSession ? (
            <button type="button" className="btn btn-success" onClick={() => setAdminSession(null)}>
              <ShieldCheck size={15} /> Admin
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setShowAdminLogin(value => !value)}>
              <ShieldCheck size={15} /> Login as admin
            </button>
          )}
          {showAdminLogin && !adminSession && (
            <div className="form-admin-popover">
              <input
                type="password"
                value={adminInput}
                onChange={event => setAdminInput(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') loginAdmin() }}
                placeholder="Admin password"
                className="input-base"
                autoFocus
              />
              <button type="button" onClick={loginAdmin} className="btn btn-primary" disabled={!adminInput.trim()}>
                Unlock
              </button>
            </div>
          )}
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
                    setTab(item)
                    setFormKey(grouped[item]?.[0]?.formKey ?? '')
                    setPasswordInput('')
                  }}
                  className={clsx('btn', tab === item ? 'btn-primary' : 'btn-ghost')}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="form-subtabs">
              {loadingConfig ? (
                <div className="form-loading">Loading forms...</div>
              ) : currentForms.map(form => (
                <button
                  key={form.formKey}
                  type="button"
                  onClick={() => {
                    setFormKey(form.formKey)
                    setPasswordInput('')
                  }}
                  className={clsx('form-subtab', form.formKey === currentForm?.formKey && 'active')}
                >
                  <span>{form.user}</span>
                  {adminSession || sessions[form.formKey] ? <CheckCircle2 size={14} /> : <Lock size={13} />}
                </button>
              ))}
            </div>

            {!currentForm ? (
              <div className="form-empty-state">No form config found.</div>
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
            ) : loadingState || !state ? (
              <div className="form-empty-state">Loading table...</div>
            ) : state.form.blank ? (
              <div className="form-empty-state">
                <FileSpreadsheet size={26} />
                <div>{state.form.user} is left blank for now.</div>
              </div>
            ) : (
              <div className="form-workspace">
                <div className="form-table-header">
                  <div>
                    <div className="text-label">Scoring table</div>
                    <h1>{state.title || state.form.user}</h1>
                  </div>
                  <button type="button" onClick={() => refreshState(state.form.formKey)} className="btn btn-ghost">
                    <RefreshCw size={14} /> Refresh
                  </button>
                </div>

                <div className="form-round-toolbar">
                  {visibleRounds.map((round, index) => (
                    <button
                      key={round.index}
                      type="button"
                      onClick={() => setSelectedRound(index)}
                      className={clsx('form-round-chip', selectedRound === index && 'active', round.confirmed && 'confirmed', round.locked && 'locked')}
                    >
                      <span>{round.label || `Round ${index + 1}`}</span>
                      {round.confirmed ? <CheckCircle2 size={13} /> : round.locked ? <Lock size={13} /> : <Clock size={13} />}
                    </button>
                  ))}
                </div>

                <div className={clsx('form-settings-row', !showAutoControls && 'manual-only')}>
                  {showAutoControls && (
                    <>
                      <label>
                        <span>Fill through rank</span>
                        <input
                          type="number"
                          min={1}
                          max={11}
                          value={fillToRank}
                          onChange={event => setFillToRank(clampFillToRank(Number(event.target.value)))}
                          disabled={!selectedCanEdit}
                        />
                      </label>
                      <label>
                        <span>Houses playing in selected round</span>
                        <input
                          value={participantsByRound[selectedRound] ?? ''}
                          onChange={event => updateParticipants(selectedRound, event.target.value)}
                          onBlur={event => updateParticipants(selectedRound, defaultParticipants(event.target.value))}
                          disabled={!selectedCanEdit}
                        />
                      </label>
                    </>
                  )}
                  {adminSession && selectedRoundMeta && (
                    <div className="form-admin-controls">
                      <button type="button" disabled={controlBusy} onClick={() => setRoundControl(selectedRound, { locked: !selectedRoundMeta.locked })} className="btn btn-ghost">
                        {selectedRoundMeta.locked ? <Unlock size={13} /> : <Lock size={13} />}
                        {selectedRoundMeta.locked ? 'Unlock' : 'Lock'}
                      </button>
                      <button type="button" disabled={controlBusy} onClick={() => setRoundControl(selectedRound, { confirmed: false, locked: false })} className="btn btn-ghost">
                        Edit again
                      </button>
                      <button type="button" disabled={controlBusy} onClick={() => setRoundControl(selectedRound, { deadlineMinutes: 10 })} className="btn btn-ghost">
                        <Settings2 size={13} /> +10 min
                      </button>
                    </div>
                  )}
                </div>

                <div className="form-table-wrap">
                  <table className="form-score-table">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        {visibleRounds.map((round, roundIndex) => (
                          <th key={round.index} className={clsx(selectedRound === roundIndex && 'active-round')}>
                            <div>{round.label || `Round ${round.index}`}</div>
                            <small>Wave {round.wave || '-'}</small>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRankLabels.map((label, rowIndex) => (
                        <tr key={`${label}-${rowIndex}`} className={clsx(rowIndex === effectiveSelectedAutoRow && 'auto-row')}>
                          <th>{label || `Rank ${rowIndex + 1}`}</th>
                          {visibleRounds.map((round, roundIndex) => {
                            const editable = Boolean(session && (isAdmin || (!round.confirmed && !round.locked && !(round.deadlineAt && Date.now() > new Date(round.deadlineAt).getTime()))))
                            const isAuto = usesAutoRemainder && rowIndex === fillToRank
                            const manualValues = draft.slice(0, fillToRank).map(row => row[roundIndex] ?? '')
                            const enteredHouseCount = new Set(manualValues.flatMap(value => parseHouseList(value))).size
                            const autoValue = enteredHouseCount >= (state.form.autoAfterHouseCount || fillToRank)
                              ? remainingHouseText(participantsByRound[roundIndex] ?? '', manualValues)
                              : ''
                            return (
                              <td key={`${round.index}-${rowIndex}`} className={clsx(selectedRound === roundIndex && 'active-round')}>
                                <input
                                  value={isAuto ? autoValue : draft[rowIndex]?.[roundIndex] ?? ''}
                                  onChange={event => updateCell(rowIndex, roundIndex, event.target.value)}
                                  onBlur={event => updateCell(rowIndex, roundIndex, normalizeHouseText(event.target.value, state.form.allowTies))}
                                  disabled={!editable || isAuto}
                                  className={clsx(isAuto && 'auto-input')}
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
                            const editable = Boolean(session && (isAdmin || (!round.confirmed && !round.locked && !(round.deadlineAt && Date.now() > new Date(round.deadlineAt).getTime()))))
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
                          const disabled = savingRound !== null || (!isAdmin && (round.confirmed || round.locked || timedOut))
                          return (
                            <td key={round.index} className={clsx(selectedRound === roundIndex && 'active-round')}>
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => confirmRound(roundIndex)}
                                className={clsx('form-confirm-btn', round.confirmed && 'confirmed')}
                              >
                                {savingRound === roundIndex ? 'Saving...' : round.confirmed ? 'Confirmed' : 'Confirm'}
                                {!round.confirmed && <Send size={13} />}
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
          </section>

          <ContactFooter className="form-footer" />
        </div>
      </main>
    </div>
  )
}
