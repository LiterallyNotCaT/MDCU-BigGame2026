'use client'
import { useState, useEffect, useRef, type ReactNode } from 'react'
import AuthGuard from '@/components/AuthGuard'
import HomeButton from '@/components/HomeButton'
import FinanceHistory from '@/components/FinanceHistory'
import FullscreenButton from '@/components/FullscreenButton'
import GameMap from '@/components/GameMapView'
import LieHistory from '@/components/LieHistory'
import OwnershipHistory, { useWaveOwnership } from '@/components/OwnershipHistory'
import SharedScoreboard from '@/components/SharedScoreboard'
import Timer from '@/components/Timer'
import clsx from 'clsx'
import { CheckCircle2, KeyRound, Map, History, Trophy, MessageSquareWarning } from 'lucide-react'
import { TOTAL_WAVES, normalizeAmbassadorVisibility, type AmbassadorTabKey } from '@/lib/constants'
import { AFTERNOON_SCORE_CSV_URL } from '@/lib/scoreboardSources'
import { getGameState, subscribeStore, getActiveDisasterForWave, setActiveDisaster, startCloudSync } from '@/lib/store'
import { fetchWaveInfo } from '@/lib/sheets'
import { verifyKingProPassword, verifyPasswordSession } from '@/lib/passwords'

const DISASTER_IDS = Array.from({ length: 9 }, (_, i) => i + 1)
const TAB_META: Array<{ key: AmbassadorTabKey; label: string; icon: ReactNode }> = [
  { key: 'map', label: 'MAP', icon: <Map size={14}/> },
  { key: 'history', label: 'HISTORY', icon: <History size={14}/> },
  { key: 'scoreboard', label: 'SCORE', icon: <Trophy size={14}/> },
  { key: 'ownership', label: 'Ownership', icon: <Map size={14}/> },
  { key: 'lieHistory', label: 'Lie History', icon: <MessageSquareWarning size={14}/> },
]
const KING_PRO_SESSION_KEY = 'ambassador_king_pro'
const KING_PRO_RETURN_TAB_KEY = 'ambassador_king_pro_return_tab'

function AmbassadorContent() {
  const [tab,         setTab]         = useState<AmbassadorTabKey>('map')
  const [selWave,     setSelWave]     = useState(() => getGameState().currentWave)
  const [filterDis,   setFilterDis]   = useState<number|null>(null)
  const [currentKing, setCurrentKing]  = useState<number|null>(null)
  const [kingOwner,   setKingOwner]    = useState<number|null>(null)
  const [gs,          setGS]          = useState(getGameState)
  const [isLoaded]                    = useState(true)
  const [kingProInput, setKingProInput] = useState('')
  const [kingProUnlocked, setKingProUnlocked] = useState(false)
  const [kingProChecking, setKingProChecking] = useState(false)
  const [kingProError, setKingProError] = useState('')
  const tabBeforeKingProRef = useRef<AmbassadorTabKey>('map')
  const sheetOwnership = useWaveOwnership(selWave)
  const ambassadorVisibility = normalizeAmbassadorVisibility(gs.ambassadorVisibility)
  const effectiveVisibility = kingProUnlocked
    ? {
      tabs: Object.fromEntries(TAB_META.map(item => [item.key, true])) as Record<AmbassadorTabKey, boolean>,
      scoreboardNumbers: true,
    }
    : ambassadorVisibility
  const visibleTabs = TAB_META.filter(item => effectiveVisibility.tabs[item.key])
  const canSeeFullInfo = kingProUnlocked || gs.showResults === true

  useEffect(()=>{
    if (!isLoaded) return
    const unsub = subscribeStore(()=>{ setGS(getGameState()) })
    return unsub
  }, [isLoaded])

  useEffect(() => startCloudSync(1500), [])

  useEffect(() => {
    let cancelled = false
    const token = sessionStorage.getItem(KING_PRO_SESSION_KEY)
    if (!token) return () => { cancelled = true }
    verifyPasswordSession({ kind: 'kingPro', token })
      .then(result => {
        if (cancelled || !result.ok) return
          const storedTab = sessionStorage.getItem(KING_PRO_RETURN_TAB_KEY)
          if (TAB_META.some(item => item.key === storedTab)) {
            tabBeforeKingProRef.current = storedTab as AmbassadorTabKey
          }
          setKingProUnlocked(true)
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchWaveInfo(selWave)
      .then(info => {
        if (cancelled) return
        setCurrentKing(info.viewingKing)
        setKingOwner(info.king)
        setActiveDisaster(selWave, info.disaster)
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [selWave])

  useEffect(() => {
    if (effectiveVisibility.tabs[tab]) return
    setTab(visibleTabs[0]?.key ?? 'map')
  }, [effectiveVisibility.tabs, tab, visibleTabs])

  const disableKingPro = () => {
    const returnTab = tabBeforeKingProRef.current
    const fallbackTab = TAB_META.find(item => ambassadorVisibility.tabs[item.key])?.key ?? 'map'
    sessionStorage.removeItem(KING_PRO_SESSION_KEY)
    sessionStorage.removeItem(KING_PRO_RETURN_TAB_KEY)
    setKingProUnlocked(false)
    setKingProInput('')
    setKingProError('')
    setTab(ambassadorVisibility.tabs[returnTab] ? returnTab : fallbackTab)
  }

  const submitKingPro = async (event: React.FormEvent) => {
    event.preventDefault()
    const input = kingProInput.trim()
    if (!input) return

    setKingProChecking(true)
    setKingProError('')
    const result = await verifyKingProPassword(input).catch(error => {
      console.error(error)
      return { ok: false, token: undefined, message: String(error) }
    })
    setKingProChecking(false)

    if (!result.ok || !result.token) {
      setKingProError('Wrong password')
      return
    }

    tabBeforeKingProRef.current = tab
    sessionStorage.setItem(KING_PRO_RETURN_TAB_KEY, tab)
    sessionStorage.setItem(KING_PRO_SESSION_KEY, result.token)
    setKingProUnlocked(true)
    setKingProInput('')
  }

  if (!isLoaded) return (
    <div className="wire-page-full ambassador-fullscreen">
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    </div>
  )

  return (
    <div className="wire-page-full ambassador-fullscreen">
      <header className="wire-topbar">
        <div className="flex items-center gap-6">
          <HomeButton className="bg-white/10 border-white/20 text-white hover:text-white" />
          <div className="wire-title">Small Group Discussion</div>
        </div>
        <div className="wire-time">
          <Timer endTime={gs.timerEnd} isOpen={gs.isOpen} compact />
        </div>
      </header>

      <main className="wire-scroll ambassador-main">
        <div className="wire-content ambassador-content">
          <section className="wire-layout-two ambassador-tab-layout">
            <div id="ambassador-main-fullscreen" className="wire-panel wire-panel-soft ambassador-tab-panel fullscreen-scope">
              <FullscreenButton targetId="ambassador-main-fullscreen" />
              <div className="wire-panel-body ambassador-tab-body">
                <div className="ambassador-tab-toolbar">
                  <div className="ambassador-tabs flex flex-wrap items-center gap-2">
                    {visibleTabs.map(item => (
                      <button key={item.key} onClick={()=>setTab(item.key)}
                        className={clsx('btn', tab===item.key ? 'btn-primary' : 'btn-ghost')}>
                        {item.icon} {item.label}
                      </button>
                    ))}
                  </div>
                  <form onSubmit={submitKingPro} className={clsx('king-pro-unlock', kingProUnlocked && 'is-unlocked')}>
                    {kingProUnlocked ? (
                      <>
                        <div className="king-pro-status">
                          <CheckCircle2 size={15} />
                          <span>ALL</span>
                        </div>
                        <button type="button" onClick={disableKingPro} className="king-pro-disable">
                          disabled pro
                        </button>
                      </>
                    ) : (
                      <>
                        <label htmlFor="king-pro-password" className="king-pro-label">
                          <KeyRound size={14} />
                          รหัสเปิด pro for king
                        </label>
                        <input
                          id="king-pro-password"
                          type="password"
                          value={kingProInput}
                          onChange={event => {
                            setKingProInput(event.target.value)
                            setKingProError('')
                          }}
                          placeholder="Password"
                          className="king-pro-input"
                        />
                        <button type="submit" disabled={kingProChecking || !kingProInput.trim()} className="king-pro-button">
                          {kingProChecking ? 'Checking' : 'Unlock'}
                        </button>
                      </>
                    )}
                    {kingProError && <div className="king-pro-error">{kingProError}</div>}
                  </form>
                </div>

                {!visibleTabs.length ? (
                  <div className="ambassador-tab-view">
                    <div className="wire-panel colorful-box colorful-box-sky bg-white p-6 text-center">
                      <div className="text-label">Tabs hidden</div>
                      <div className="mt-2 text-sm font-semibold text-slate-700">
                        Admin has hidden all ambassador tabs.
                      </div>
                    </div>
                  </div>
                ) : tab==='map' && effectiveVisibility.tabs.map ? (
                  <div className="ambassador-tab-view ambassador-map-view">
                    <div className="map-wave-filter flex flex-wrap gap-2">
                      {Array.from({length:TOTAL_WAVES},(_,i)=>i+1).map(w=>(
                        <button key={w} onClick={()=>setSelWave(w)}
                          className={clsx('btn px-3', selWave===w ? 'btn-success' : 'btn-ghost')}>
                          {w}
                        </button>
                      ))}
                    </div>
                    <GameMap ownership={canSeeFullInfo ? sheetOwnership.ownership : {}}
                      disasterOwnership={canSeeFullInfo ? sheetOwnership.disasterOwnership : {}}
                      eradicatedOwnership={canSeeFullInfo ? sheetOwnership.eradicatedOwnership : {}}
                      filterDisaster={filterDis} readOnly
                      kingDisaster={canSeeFullInfo ? getActiveDisasterForWave(selWave) : null}
                      currentKing={canSeeFullInfo ? currentKing : null}
                      kingOwner={canSeeFullInfo ? kingOwner : null}
                      mode={gs.mapMode}
                      compact />
                    <div className="ambassador-filter-row flex flex-wrap gap-2">
                      {DISASTER_IDS.map(id=>(
                        <button key={id} onClick={()=>setFilterDis(filterDis===id?null:id)}
                          className={clsx('btn disaster-filter', filterDis===id ? 'active' : '')}>
                          {id}
                        </button>
                      ))}
                      {filterDis && (
                        <button onClick={()=>setFilterDis(null)} className="btn btn-ghost">
                          Clear filter
                        </button>
                      )}
                    </div>
                  </div>
                ) : tab==='history' && effectiveVisibility.tabs.history ? (
                  <div className="ambassador-tab-view space-y-3">
                    <FinanceHistory showResults />
                  </div>
                ) : tab==='ownership' && effectiveVisibility.tabs.ownership ? (
                  <div className="ambassador-tab-view space-y-3">
                    <OwnershipHistory visibleThroughWave={gs.currentWave} />
                  </div>
                ) : tab==='lieHistory' && effectiveVisibility.tabs.lieHistory ? (
                  <div className="ambassador-tab-view space-y-3">
                    <LieHistory />
                  </div>
                ) : tab==='scoreboard' && effectiveVisibility.tabs.scoreboard ? (
                  <div className="ambassador-tab-view">
                    <SharedScoreboard
                      title="Afternoon Scoreboard"
                      subtitle="อันดับคะแนนช่วงบ่าย"
                      bgColor="bg-[#9cd4f7]"
                      csvUrlTotal={AFTERNOON_SCORE_CSV_URL}
                      showDetails={false}
                      showNumbers={effectiveVisibility.scoreboardNumbers}
                      mode="embedded"
                    />
                  </div>
                ) : (
                  <div className="ambassador-tab-view" />
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )

}

export default function AmbassadorPage() {
  return (
    <AuthGuard pageKey="web4"
      title="ห้องทูต" subtitle="กรอกรหัสเพื่อดู Scoreboard"
      accentColor="#10b981">
      <AmbassadorContent />
    </AuthGuard>
  )
}
