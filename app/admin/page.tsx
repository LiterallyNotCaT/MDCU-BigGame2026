'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import AuthGuard from '@/components/AuthGuard'
import HomeButton from '@/components/HomeButton'
import GameMap from '@/components/GameMap'
import FinanceHistory from '@/components/FinanceHistory'
import FullscreenButton from '@/components/FullscreenButton'
import GroupChat from '@/components/GroupChat'
import LieHistory from '@/components/LieHistory'
import OwnershipHistory, { useWaveOwnership } from '@/components/OwnershipHistory'
import SharedScoreboard from '@/components/SharedScoreboard'
import Timer from '@/components/Timer'
import clsx from 'clsx'
import {
  RefreshCw, ChevronLeft, ChevronRight, Play, Square,
  Zap, Map, History, Trophy,
  LayoutDashboard, CheckCircle2, Clock, RotateCcw,
} from 'lucide-react'
import {
  HOUSE_COLORS, HOUSE_NAMES, TOTAL_WAVES,
  normalizeAmbassadorVisibility, type AmbassadorTabKey,
  normalizeChatPermissions, type ChatPermissions,
} from '@/lib/constants'
import { AFTERNOON_SCORE_CSV_URL } from '@/lib/scoreboardSources'
import { fetchWaveInputs, type WaveInputRow } from '@/lib/sheets'
import {
  getGameState, setGameState,
  getActiveDisasterForWave, setActiveDisaster, getSubmissions, getSubmissionsForWave, subscribeStore, startCloudSync,
} from '@/lib/store'

const BID_PLAY_MINUTES = 10
const BET_PLAY_MINUTES = 2
const DISASTER_SELECT_MINUTES = 3
type WaveMeta = { king: number | null; disaster: number | null }
const AMBASSADOR_TAB_CONTROLS: Array<{ key: AmbassadorTabKey; label: string }> = [
  { key: 'scoreboard', label: 'Scoreboard' },
  { key: 'map', label: 'Map' },
  { key: 'ownership', label: 'Ownership' },
  { key: 'history', label: 'Finance history' },
  { key: 'lieHistory', label: 'Lie history' },
]
const CHAT_PERMISSION_CONTROLS: Array<{ key: keyof ChatPermissions; label: string; detail: string }> = [
  { key: 'adminPrivate', label: 'Admin private', detail: 'Players can DM admin' },
  { key: 'groupChat', label: 'Group chat', detail: 'Players can use public chat' },
  { key: 'playerPrivate', label: 'Player private', detail: 'Players can DM each other' },
]

function submissionKey(wave: number, baan: number) {
  return `${wave}:${baan}`
}

function getSubmissionRevisionMap() {
  return Object.fromEntries(
    getSubmissions().map(s => [submissionKey(s.wave, s.baan), s.revision ?? 1]),
  )
}

function AdminContent() {
  const initialRevisionMap = useRef<Record<string, number> | null>(null)
  if (initialRevisionMap.current === null) initialRevisionMap.current = getSubmissionRevisionMap()
  const [gs,          setGS]          = useState(getGameState())
  const [tab,         setTab]         = useState<'dashboard'|'map'|'history'|'ownership'|'lieHistory'|'leaderboard'>('dashboard')
  const [controlTab,  setControlTab]  = useState<'games'|'etc'>('games')
  const [mapWave,     setMapWave]     = useState(getGameState().currentWave)
  const [submissionWave, setSubmissionWave] = useState(getGameState().currentWave)
  const [submissionGame, setSubmissionGame] = useState<'bid'|'bet'>(getGameState().gameMode === 'bet' ? 'bet' : 'bid')
  const [sheetInputs, setSheetInputs] = useState<Record<number, WaveInputRow[]>>({})
  const [waveMeta,    setWaveMeta]    = useState<Record<number, WaveMeta>>({})
  const [savePulses,  setSavePulses]  = useState<Record<string, { count: number; at: number }>>({})
  const [nowTick,     setNowTick]     = useState(() => Date.now())
  const filterDis = null
  const [toast,       setToast]       = useState<{msg:string;type:'ok'|'warn'|'err'}>()
  const [duration,    setDuration]    = useState(() => {
    const state = getGameState()
    if (state.gameMode === 'bet') return String(BET_PLAY_MINUTES)
    if (state.gamePhase === 'select-disaster') return String(DISASTER_SELECT_MINUTES)
    return String(BID_PLAY_MINUTES)
  })
  const [processing,  setProcessing]  = useState(false)
  const submissionSnapshotRef = useRef<Record<string, number>>(initialRevisionMap.current ?? {})
  const sheetOwnership = useWaveOwnership(mapWave)

  const notify = (msg:string, type:'ok'|'warn'|'err'='ok') => {
    setToast({msg,type}); setTimeout(()=>setToast(undefined), 3500)
  }

  const applyGS = (patch: Parameters<typeof setGameState>[0]) => {
    setGameState(patch); setGS(getGameState())
  }

  useEffect(() => startCloudSync(800), [])

  // ── Fetch all sheet scores ──────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const inputs: Record<number, WaveInputRow[]> = {}
      const meta: Record<number, WaveMeta> = {}
      for (let w=1; w<=TOTAL_WAVES; w++) {
        const data = await fetchWaveInputs(w)
        inputs[w] = data.rows
        meta[w] = { king: data.king, disaster: data.kingDisaster }
        setActiveDisaster(w, data.kingDisaster)
      }
      setSheetInputs(inputs)
      setWaveMeta(meta)
    } catch(e){ console.error(e) }
  }, [])

  useEffect(()=>{
    const first = window.setTimeout(fetchAll, 0)
    const t = setInterval(fetchAll,15000)
    return()=>{ window.clearTimeout(first); clearInterval(t) }
  },[fetchAll])

  useEffect(()=>{
    const u=subscribeStore((key)=>{
      const nextState = getGameState()
      setGS(nextState)
      if (key === 'biggame_submissions') {
        const current = getSubmissions()
        const snapshot = submissionSnapshotRef.current
        const changedSubmissions = current
          .filter(s => {
            const revision = s.revision ?? 1
            const id = submissionKey(s.wave, s.baan)
            return snapshot[id] !== revision
          })
          .map(s => ({ id: submissionKey(s.wave, s.baan), revision: s.revision ?? 1 }))
        submissionSnapshotRef.current = {
          ...snapshot,
          ...Object.fromEntries(current.map(s => [submissionKey(s.wave, s.baan), s.revision ?? 1])),
        }
        if (!changedSubmissions.length) return
        const now = Date.now()
        setSavePulses(prev => {
          const next = { ...prev }
          changedSubmissions.forEach(({ id }) => {
            next[id] = { count: (prev[id]?.count ?? 0) + 1, at: now }
          })
          return next
        })
      }
    })
    return u
  },[])

  useEffect(() => {
    const currentRevisions = getSubmissionRevisionMap()
    submissionSnapshotRef.current = currentRevisions
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!gs.isOpen || !gs.timerEnd) return
    const ms = new Date(gs.timerEnd).getTime() - Date.now()
    const timeout = window.setTimeout(() => applyGS({ isOpen: false }), Math.max(0, ms))
    return () => window.clearTimeout(timeout)
  }, [gs.isOpen, gs.timerEnd])

  // ── Controls ────────────────────────────────────────────
  const gotoWave = (w:number) => {
    applyGS({currentWave:w, isOpen:false, timerEnd:null, showResults:false, gamePhase:'play'})
    notify(`➡ เข้าสู่ Wave ${w}`)
  }
  const selectBidMode = () => {
    setDuration(String(BID_PLAY_MINUTES))
    applyGS({gameMode:'bid', gamePhase:'play', duration:BID_PLAY_MINUTES})
    notify('Bid game ready: 10 min island + king bid')
  }
  const selectBetMode = () => {
    setDuration(String(BET_PLAY_MINUTES))
    applyGS({gameMode:'bet', gamePhase:'play', duration:BET_PLAY_MINUTES})
    notify('Bet game ready: 2 min')
  }
  const startTimer = () => {
    const fallback = gs.gameMode === 'bet' ? BET_PLAY_MINUTES : BID_PLAY_MINUTES
    const mins = parseFloat(duration)||fallback
    applyGS({isOpen:true, timerEnd:new Date(Date.now()+mins*60000).toISOString(), duration:mins, showResults:false, gamePhase:'play'})
    notify(`▶ เปิดรับข้อมูล ${mins} นาที`)
  }
  const stopTimer = () => { applyGS({isOpen:false}); notify('⏹ ปิดรับข้อมูลแล้ว') }
  const startDisasterSelect = () => {
    const mins = DISASTER_SELECT_MINUTES
    setDuration(String(mins))
    applyGS({
      gameMode:'bid',
      gamePhase:'select-disaster',
      isOpen:true,
      timerEnd:new Date(Date.now()+mins*60000).toISOString(),
      duration:mins,
      showResults:false,
    })
    notify('Select disaster: current king has 3 min')
  }
  const addTime = (seconds:number) => {
    const now = new Date().getTime()
    const cur = gs.timerEnd ? new Date(gs.timerEnd).getTime() : now
    applyGS({timerEnd:new Date(Math.max(now,cur)+seconds*1000).toISOString(), isOpen:true})
    notify(seconds >= 60 ? '+1 min' : '+5s')
  }
  const processWave = async () => {
    setProcessing(true)
    await fetchAll()
    notify(`${gs.gameMode === 'bet' ? 'Bet' : 'Bid'} Wave ${gs.currentWave} refreshed from Google Sheet`)
    setProcessing(false)
  }
  const resetSubmissionCounts = () => {
    const currentWaveSubmissions = getSubmissionsForWave(submissionWave)
    const baselinePatch = Object.fromEntries(
      currentWaveSubmissions.map(s => [submissionKey(s.wave, s.baan), s.revision ?? 1]),
    )
    submissionSnapshotRef.current = {
      ...submissionSnapshotRef.current,
      ...baselinePatch,
    }
    setSavePulses(prev => Object.fromEntries(
      Object.entries(prev).filter(([id]) => !id.startsWith(`${submissionWave}:`)),
    ))
    notify(`Reset count for Wave ${submissionWave}`)
  }
  const hasSubmittedForGame = (row: WaveInputRow, game: 'bid'|'bet') => game === 'bet' ? row.hasBetInput : row.hasBidInput
  const viewedSubmissionRows = sheetInputs[submissionWave] ?? []
  const sheetSubmittedBaans = viewedSubmissionRows.filter(row => hasSubmittedForGame(row, submissionGame)).map(r=>r.baan)
  const submittedBaans = Array.from(new Set(sheetSubmittedBaans))
  const localSubmissionsCurrent = getSubmissionsForWave(submissionWave)
  const viewedWaveMeta = waveMeta[submissionWave] ?? { king: null, disaster: null }
  const ambassadorVisibility = normalizeAmbassadorVisibility(gs.ambassadorVisibility)
  const chatPermissions = normalizeChatPermissions(gs.chatPermissions)
  const setAmbassadorVisibility = (patch: Parameters<typeof normalizeAmbassadorVisibility>[0]) => {
    applyGS({ ambassadorVisibility: normalizeAmbassadorVisibility(patch) })
  }
  const setChatPermissions = (patch: Parameters<typeof normalizeChatPermissions>[0]) => {
    applyGS({ chatPermissions: normalizeChatPermissions(patch) })
  }
  const toggleAmbassadorTab = (key: AmbassadorTabKey) => {
    setAmbassadorVisibility({
      ...ambassadorVisibility,
      tabs: {
        ...ambassadorVisibility.tabs,
        [key]: !ambassadorVisibility.tabs[key],
      },
    })
  }

  // ── Toast color ─────────────────────────────────────────
  const toastStyle = toast?.type==='err'
    ? 'border-red-500/30 bg-red-950/60'
    : toast?.type==='warn'
    ? 'border-yellow-500/30 bg-yellow-950/60'
    : 'border-emerald-500/30 bg-emerald-950/60'

  return (
    <div className="wire-page-full">
      <header className="wire-topbar">
        <div className="flex items-center gap-6">
          <HomeButton className="bg-white/10 border-white/20 text-white hover:text-white" />
          <div className="wire-title">ADMIN</div>
        </div>
        <div className="wire-topbar-actions">
          <GroupChat actor="admin" label="Chat" />
          <div className="wire-time">
            <Timer endTime={gs.timerEnd} isOpen={gs.isOpen} compact />
          </div>
        </div>
      </header>

      <main className="wire-scroll">
        <div className="wire-content">
          {toast && (
            <div className={clsx('fixed right-5 top-20 z-50 rounded px-4 py-3 text-sm text-white shadow-lg', toastStyle)}>
              {toast.msg}
            </div>
          )}

          <section className="wire-layout-admin">
            <div id="admin-main-fullscreen" className="wire-panel wire-panel-purple wire-main-hero admin-board-scroll fullscreen-scope">
              <FullscreenButton targetId="admin-main-fullscreen" />
              <div className="wire-panel-body w-full">
                <div className="mb-6 flex flex-wrap justify-center gap-2">
                  {([
                    ['dashboard','Dashboard',<LayoutDashboard key="d" size={14}/>],
                    ['map','MAP',<Map key="m" size={14}/>],
                    ['history','History',<History key="h" size={14}/>],
                    ['ownership','Ownership',<Map key="o" size={14}/>],
                    ['lieHistory','Lie History',<History key="lh" size={14}/>],
                    ['leaderboard','Leaderboard',<Trophy key="t" size={14}/>],
                  ] as const).map(([value,label,icon])=>(
                    <button key={value} onClick={()=>setTab(value)}
                      className={clsx('btn', tab===value ? 'btn-primary' : 'btn-ghost')}>
                      {icon} {label}
                    </button>
                  ))}
                </div>

                {tab==='dashboard' && (
                  <div className="wire-panel colorful-box colorful-box-blue bg-white p-5 admin-submission-panel">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-label">Wave {submissionWave} submissions</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="badge badge-blue">{submissionGame === 'bet' ? 'Bet game' : 'Bid game'} - Google Sheet</span>
                        <button onClick={resetSubmissionCounts} className="btn btn-ghost py-1.5 px-2 text-xs">
                          <RotateCcw size={12} /> reset count
                        </button>
                        <button onClick={fetchAll} className="btn btn-ghost py-1.5 px-2 text-xs">
                          <RefreshCw size={12} /> Refresh
                        </button>
                      </div>
                    </div>
                    <div className="admin-submission-wave-filter flex flex-wrap gap-2">
                      {Array.from({length:TOTAL_WAVES},(_,i)=>i+1).map(w=>(
                        <button key={w} onClick={()=>setSubmissionWave(w)}
                          className={clsx('btn px-3', submissionWave===w ? 'btn-primary' : 'btn-ghost')}>
                          W{w}
                        </button>
                      ))}
                      <div className="admin-submission-game-filter flex gap-2">
                        <button onClick={()=>setSubmissionGame('bid')}
                          className={clsx('btn px-3', submissionGame==='bid' ? 'btn-primary' : 'btn-ghost')}>
                          Bid
                        </button>
                        <button onClick={()=>setSubmissionGame('bet')}
                          className={clsx('btn px-3', submissionGame==='bet' ? 'btn-primary' : 'btn-ghost')}>
                          Bet
                        </button>
                      </div>
                    </div>
                    {submissionGame === 'bid' && (
                      <div className="admin-bid-status-grid mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                          <div className="text-label">Viewing wave king</div>
                          <div className="text-sm font-bold text-blue-800">
                            {viewedWaveMeta.king ? HOUSE_NAMES[viewedWaveMeta.king] : '-'}
                          </div>
                        </div>
                        <div className={clsx('rounded-lg border px-3 py-2', viewedWaveMeta.disaster ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50')}>
                          <div className="text-label">Disaster selection</div>
                          <div className={clsx('text-sm font-bold', viewedWaveMeta.disaster ? 'text-green-700' : 'text-red-700')}>
                            {viewedWaveMeta.disaster ? `Sent disaster ${viewedWaveMeta.disaster}` : 'no disaster'}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="admin-submission-grid grid grid-cols-1 gap-2 xl:grid-cols-2">
                      {Array.from({length:12},(_,i)=>i+1).map(b=>{
                        const row = viewedSubmissionRows.find(r=>r.baan===b)
                        const done = row ? hasSubmittedForGame(row, submissionGame) : false
                        const localSub = localSubmissionsCurrent.find(s => s.baan === b)
                        const localKey = submissionKey(submissionWave, b)
                        const pulse = savePulses[localKey]
                        const saving = Boolean(pulse && nowTick - pulse.at < 5000)
                        const changes = pulse?.count ?? 0
                        return (
                          <div key={b} className={clsx('admin-submission-card flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2.5',
                            done ? 'border-green-300 bg-green-50' : 'border-amber-200 bg-amber-50')}>
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono font-black text-white"
                              style={{background:HOUSE_COLORS[b]}}>
                              {b}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold" style={{color:HOUSE_COLORS[b]}}>{HOUSE_NAMES[b]}</div>
                              <div className="text-xs text-slate-500">
                                {changes ? `${changes} changes${localSub?.timestamp ? ` - ${localSub.timestamp}` : ''}` : 'No local changes yet'}
                              </div>
                            </div>
                            <span className={clsx('badge shrink-0', saving ? 'badge-blue' : done ? 'badge-green' : 'badge-red')}>
                              {saving ? 'Saving' : done ? 'Saved' : 'no data'}
                            </span>
                            {done ? <CheckCircle2 className="shrink-0 text-green-500" size={18}/> : <Clock className="shrink-0 text-amber-500" size={18}/>} 
                          </div>
                        )
                      })}
                    </div>
                    <div className="admin-submission-summary mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded bg-green-50 px-3 py-2 text-green-700">Saved: {submittedBaans.length}/12</div>
                      <div className="rounded bg-amber-50 px-3 py-2 text-amber-700">Waiting: {12-submittedBaans.length}</div>
                    </div>
                  </div>
                )}
                {tab==='map' && (
                  <div className="admin-map-tab">
                    <div className="map-wave-filter flex flex-wrap gap-2">
                      {Array.from({length:TOTAL_WAVES},(_,i)=>i+1).map(w=>(
                        <button key={w} onClick={()=>setMapWave(w)}
                          className={clsx('btn px-3', mapWave===w ? 'btn-success' : 'btn-ghost')}>
                          {w}
                        </button>
                      ))}
                    </div>
                    <GameMap ownership={sheetOwnership.ownership} filterDisaster={filterDis}
                      kingDisaster={getActiveDisasterForWave(mapWave)}
                      currentKing={waveMeta[mapWave]?.king ?? null}
                      readOnly compact />
                  </div>
                )}

                {tab==='ownership' && (
                  <OwnershipHistory />
                )}

                {tab==='lieHistory' && (
                  <LieHistory />
                )}

                {tab==='history' && (
                  <div className="wire-panel bg-white p-4 admin-history-panel">
                    <FinanceHistory showResults enableBetReturnRanking maxSelectableWave={TOTAL_WAVES} />
                  </div>
                )}

                {tab==='leaderboard' && (
                  <div className="wire-panel admin-scoreboard-fit colorful-box colorful-box-sky bg-white p-5">
                    <SharedScoreboard
                      title="Afternoon Scoreboard"
                      subtitle="อันดับคะแนนเกมช่วงบ่าย"
                      bgColor="bg-[#9cd4f7]"
                      csvUrlTotal={AFTERNOON_SCORE_CSV_URL}
                      showDetails={false}
                      showNumbers
                      mode="embedded"
                    />
                  </div>
                )}
              </div>
            </div>

            <aside className="admin-control-stack">
              <div className="wire-panel wire-panel-green wire-sidebar-fill">
              <div className="admin-control-panel w-full space-y-4">
                <div className={clsx('admin-status-corner badge', gs.isOpen?'badge-green':'badge-red')}>
                  <span className={clsx('status-dot', gs.isOpen?'online':'offline')} />
                  {gs.isOpen?'OPEN':'CLOSED'}
                </div>
                <div className="admin-control-title">Admin Control</div>
                <div className="admin-control-tabs">
                  <button type="button" onClick={() => setControlTab('games')}
                    className={clsx('btn', controlTab === 'games' ? 'btn-primary' : 'btn-ghost')}>
                    Games
                  </button>
                  <button type="button" onClick={() => setControlTab('etc')}
                    className={clsx('btn', controlTab === 'etc' ? 'btn-primary' : 'btn-ghost')}>
                    Etc.
                  </button>
                </div>
                {controlTab === 'games' ? (
                  <>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={selectBidMode}
                    className={clsx('btn', gs.gameMode !== 'bet' && gs.gamePhase !== 'select-disaster' ? 'btn-primary' : 'btn-ghost')}>
                    Bid game
                  </button>
                  <button onClick={selectBetMode}
                    className={clsx('btn', gs.gameMode === 'bet' ? 'btn-primary' : 'btn-ghost')}>
                    Bet game
                  </button>
                </div>
                {gs.gameMode === 'bid' && (
                  <button
                    onClick={startDisasterSelect}
                    className={clsx('btn admin-select-disaster-button', gs.gamePhase === 'select-disaster' ? 'btn-success' : 'btn-ghost')}
                  >
                    Select disaster (king only, 3 min)
                  </button>
                )}
                <div className="wire-panel admin-wave-card colorful-box colorful-box-sky bg-white p-4">
                  <div className="mb-4 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
                    <button onClick={()=>gs.currentWave>1&&gotoWave(gs.currentWave-1)} className="btn btn-ghost admin-wave-arrow"><ChevronLeft size={18}/></button>
                    <div className="admin-wave-label">Wave {gs.currentWave}/{TOTAL_WAVES}</div>
                    <button onClick={()=>gs.currentWave<TOTAL_WAVES&&gotoWave(gs.currentWave+1)} className="btn btn-ghost admin-wave-arrow"><ChevronRight size={18}/></button>
                  </div>
                  <div className="mb-3 flex items-center gap-2">
                    <input type="number" min={1} max={120} value={duration}
                      onChange={e=>setDuration(e.target.value)} className="input-base text-center" />
                    <span>นาที</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={startTimer} className="btn btn-success"><Play size={14}/> เปิด</button>
                    <button onClick={stopTimer} className="btn btn-danger"><Square size={14}/> ปิด</button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button onClick={()=>addTime(5)} className="btn btn-ghost">+5s</button>
                    <button onClick={()=>addTime(60)} className="btn btn-ghost">+1 min</button>
                  </div>
                  <button
                    onClick={() => {
                      applyGS({ showResults: !gs.showResults })
                      notify(!gs.showResults ? 'Showing player results' : 'Hiding player results')
                    }}
                    className={clsx('btn mt-3 w-full', gs.showResults ? 'btn-success' : 'btn-ghost')}
                  >
                    {gs.showResults ? 'Hide result' : 'Show result'}
                  </button>
                </div>
                <button onClick={processWave} disabled={processing} className="btn btn-primary w-full">
                  <Zap size={15}/> Refresh Sheet Wave {gs.currentWave}
                </button>
                  </>
                ) : (
                  <>
                <div className="wire-panel admin-ambassador-visibility-card bg-white p-3">
                  <div className="mb-2">
                    <div className="font-display text-sm font-bold text-slate-800">Ambassador visibility</div>
                    <div className="text-2xs font-semibold text-slate-500">Choose what players can see.</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {AMBASSADOR_TAB_CONTROLS.map(item => (
                      <button
                        key={item.key}
                        onClick={() => toggleAmbassadorTab(item.key)}
                        className={clsx('btn min-h-10 px-2 text-xs', ambassadorVisibility.tabs[item.key] ? 'btn-success' : 'btn-ghost')}
                      >
                        {ambassadorVisibility.tabs[item.key] ? 'Show' : 'Hide'} {item.label}
                      </button>
                    ))}
                    <button
                      onClick={() => setAmbassadorVisibility({
                        ...ambassadorVisibility,
                        scoreboardNumbers: !ambassadorVisibility.scoreboardNumbers,
                      })}
                      className={clsx('btn min-h-10 px-2 text-xs', ambassadorVisibility.scoreboardNumbers ? 'btn-success' : 'btn-ghost')}
                    >
                      {ambassadorVisibility.scoreboardNumbers ? 'Show' : 'Hide'} score numbers
                    </button>
                  </div>
                </div>
                <div className="wire-panel admin-chat-permissions-card bg-white p-3">
                  <div className="mb-2">
                    <div className="font-display text-sm font-bold text-slate-800">Chat permissions</div>
                    <div className="text-2xs font-semibold text-slate-500">Control what player chat channels are available.</div>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {CHAT_PERMISSION_CONTROLS.map(item => (
                      <button
                        key={item.key}
                        onClick={() => setChatPermissions({
                          ...chatPermissions,
                          [item.key]: !chatPermissions[item.key],
                        })}
                        className={clsx('btn admin-chat-permission-button px-2 text-xs', chatPermissions[item.key] ? 'btn-success' : 'btn-ghost')}
                      >
                        <span>{chatPermissions[item.key] ? 'Allow' : 'Block'} {item.label}</span>
                        <small>{item.detail}</small>
                      </button>
                    ))}
                  </div>
                </div>
                  </>
                )}
              </div>
              </div>
            </aside>
          </section>
        </div>
      </main>
    </div>
  )

}

export default function AdminPage() {
  return (
    <AuthGuard pageKey="web5"
      title="Admin Panel" subtitle="กรอกรหัส Admin เพื่อเข้าสู่ระบบ"
      accentColor="#3b82f6">
      <AdminContent />
    </AuthGuard>
  )
}
