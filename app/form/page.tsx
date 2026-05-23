'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, Clock, FileSpreadsheet, KeyRound, Lock, RefreshCw, Send, Settings2, ShieldCheck, Unlock } from 'lucide-react'
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
import { ADMIN_CONTACT_EMAILS } from '@/lib/contacts'

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

function validatedColumn(
  state: ScoringFormState,
  draft: string[][],
  roundIndex: number,
  fillToRank: number,
  participants: string,
) {
  const config = state.form
  const normalized = Array.from({ length: state.rankLabels.length }, (_, rowIndex) => {
    const raw = draft[rowIndex]?.[roundIndex] ?? ''
    return normalizeHouseText(raw, config.allowTies)
  })

  if (config.kind === 'placeholder') return { ok: false, message: 'This form is blank for now.', values: normalized }

  const manualLimit = config.kind === 'match-single' ? state.rankLabels.length : fillToRank
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

  if (config.kind !== 'match-single') {
    const remainderRow = fillToRank
    normalized[remainderRow] = remainingHouseText(participants, normalized.slice(0, fillToRank))
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
  const session = currentForm ? adminSession ?? sessions[currentForm.formKey] ?? null : adminSession
  const canSeeContent = Boolean(currentForm && (adminSession || sessions[currentForm.formKey]))
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
      setSelectedRound(prev => Math.min(prev, Math.max(0, data.state.rounds.length - 1)))
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
    refreshState(formKey)
  }, [formKey, refreshState])

  const loginStaff = async () => {
    if (!currentForm || !passwordInput.trim()) return
    try {
      const data = await fetchJson<ScoringFormAuth>('/api/forms/auth', {
        method: 'POST',
        body: JSON.stringify({ formKey: currentForm.formKey, password: passwordInput }),
      })
      if (!data.ok) throw new Error(data.message || 'Wrong password')
      setSessions(prev => ({
        ...prev,
        [currentForm.formKey]: { role: 'staff', username: data.username, password: passwordInput },
      }))
      setPasswordInput('')
      notify('ok', `Logged in as ${data.username}`)
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
      notify('ok', `Saved ${round.label}`)
      await refreshState(state.form.formKey)
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
      await refreshState(state.form.formKey)
      notify('ok', 'Round control updated')
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error))
    } finally {
      setControlBusy(false)
    }
  }

  const selectedAutoRow = state?.form.kind !== 'match-single' ? fillToRank : -1
  const headerTitle = session ? `Staff Form for ${session.username}` : 'Staff Form'

  return (
    <div className="wire-page-full form-page">
      <header className="wire-topbar form-topbar">
        <div className="form-topbar-left">
          <HomeButton className="bg-white/10 border-white/20 text-white hover:text-white" />
          <div>
            <div className="wire-title">{headerTitle}</div>
            <div className="form-topbar-subtitle">Confirm-only scoring forms</div>
          </div>
        </div>
        <div className="form-topbar-actions">
          {session?.role === 'staff' && <GroupChat actor={session.username} label="Report" topic="report" adminOnly />}
          {adminSession ? (
            <button type="button" className="btn btn-success" onClick={() => setAdminSession(null)}>
              <ShieldCheck size={15} /> Admin
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setShowAdminLogin(value => !value)}>
              <ShieldCheck size={15} /> Login as admin
            </button>
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

          {showAdminLogin && !adminSession && (
            <section className="form-admin-login">
              <div>
                <div className="font-display text-sm font-black text-slate-900">Admin override</div>
                <div className="text-xs font-semibold text-slate-500">Use the admin password from the password sheet.</div>
              </div>
              <input
                type="password"
                value={adminInput}
                onChange={event => setAdminInput(event.target.value)}
                placeholder="Admin password"
                className="input-base"
              />
              <button type="button" onClick={loginAdmin} className="btn btn-primary" disabled={!adminInput.trim()}>
                Unlock
              </button>
            </section>
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
                  <p>Enter this subtab password to unlock only this form.</p>
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
                    <p>{state.form.tab} / {state.form.user}</p>
                  </div>
                  <button type="button" onClick={() => refreshState(state.form.formKey)} className="btn btn-ghost">
                    <RefreshCw size={14} /> Refresh
                  </button>
                </div>

                <div className="form-round-toolbar">
                  {state.rounds.map((round, index) => (
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

                <div className="form-settings-row">
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
                        {state.rounds.map((round, roundIndex) => (
                          <th key={round.index} className={clsx(selectedRound === roundIndex && 'active-round')}>
                            <div>{round.label || `Round ${round.index}`}</div>
                            <small>Wave {round.wave || '-'}</small>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {state.rankLabels.map((label, rowIndex) => (
                        <tr key={`${label}-${rowIndex}`} className={clsx(rowIndex === selectedAutoRow && 'auto-row')}>
                          <th>{label || `Rank ${rowIndex + 1}`}</th>
                          {state.rounds.map((round, roundIndex) => {
                            const editable = Boolean(session && (isAdmin || (!round.confirmed && !round.locked && !(round.deadlineAt && Date.now() > new Date(round.deadlineAt).getTime()))))
                            const isAuto = state.form.kind !== 'match-single' && rowIndex === fillToRank
                            const manualValues = draft.slice(0, fillToRank).map(row => row[roundIndex] ?? '')
                            const autoValue = remainingHouseText(participantsByRound[roundIndex] ?? '', manualValues)
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
                      <tr className="form-participant-row">
                        <th>Playing</th>
                        {state.rounds.map((round, roundIndex) => {
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
                    </tbody>
                    <tfoot>
                      <tr>
                        <th>Confirm</th>
                        {state.rounds.map((round, roundIndex) => {
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

          <footer className="form-footer">
            <span>Login problem contact:</span>
            {ADMIN_CONTACT_EMAILS.map(email => (
              <a key={email} href={`mailto:${email}?subject=BigGame%20login%20problem`} className="contact-email-button">{email}</a>
            ))}
            <span className="form-footer-note">Edit emails in ADMIN_CONTACT_EMAILS inside lib/contacts.ts.</span>
          </footer>
        </div>
      </main>
    </div>
  )
}
