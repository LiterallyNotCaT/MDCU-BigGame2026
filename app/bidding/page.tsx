'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import HomeButton from '@/components/HomeButton'
import GameMap from '@/components/GameMap'
import BiddingCart from '@/components/BiddingCart'
import FinanceHistory from '@/components/FinanceHistory'
import FullscreenButton from '@/components/FullscreenButton'
import GroupChat from '@/components/GroupChat'
import { useWaveOwnership } from '@/components/OwnershipHistory'
import Timer from '@/components/Timer'
import clsx from 'clsx'
import { CheckCircle2, Crown, Landmark, LogOut, Sparkles, Maximize, Minimize } from 'lucide-react'
import { HOUSE_NAMES, SHEET_ID, getWaveSheetQuery } from '@/lib/constants'
import {
  getGameState, saveSubmission, deleteSubmissionForBaanWave, getSubmissionsForBaan,
  subscribeStore, getActiveDisasterForWave, setActiveDisaster, startCloudSync,
} from '@/lib/store'
import { fetchWaveInfo, fetchWaveInputs, writeToSheet, type WaveInputRow } from '@/lib/sheets'
import { verifyBaanPassword, verifyPasswordSession } from '@/lib/passwords'

const DISASTER_IDS = Array.from({ length: 9 }, (_, i) => i + 1)

function sanitizeMoneyInput(value: string) {
  return value.replace(/[^\d]/g, '')
}

/* ── Login screen ──────────────────────────────────────────── */
function BaanLogin({ onLogin }: { onLogin:(b:number)=>void }) {
  const [baan,  setBaan]  = useState('')
  const [pass,  setPass]  = useState('')
  const [err,   setErr]   = useState('')
  const [shake, setShake] = useState(false)
  const [checkingPassword, setCheckingPassword] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const b = parseInt(baan)
    if (isNaN(b)||b<1||b>12) { setErr('กรอกเลขบ้าน 1–12 เท่านั้น'); return }
    setCheckingPassword(true)
    const result = await verifyBaanPassword(b, pass).catch(error => {
      console.error(error)
      return { ok: false, token: undefined, message: String(error) }
    })
    setCheckingPassword(false)
    if (!result.ok || !result.token) {
      setErr('รหัสไม่ถูกต้อง'); setShake(true)
      setTimeout(()=>setShake(false),500); return
    }
    sessionStorage.setItem('baan_login',String(b))
    sessionStorage.setItem('baan_login_token', result.token)
    onLogin(b)
  }

  return (
    <div className="min-h-screen app-shell flex items-center justify-center px-4 py-6">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full blur-[100px] bg-violet-600/10" />
      </div>

      <div className={clsx('relative z-10 w-full max-w-[22rem] content-card compact-auth-card p-5 sm:p-6',
        shake && 'animate-[shake_0.4s_ease-in-out]')}>

        <div className="text-center mb-5">
          <div className="text-4xl mb-3 animate-float">🏛️</div>
          <h1 className="font-display font-bold text-xl text-white">เข้าสู่ระบบ</h1>
          <p className="text-sm text-slate-500 mt-1.5">เกมลงทุนพื้นที่ · ช่วงบ่าย</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-label block mb-2">เลขบ้าน (1–12)</label>
            <input type="number" min={1} max={12} value={baan}
              onChange={e=>setBaan(e.target.value)} placeholder="กรอกเลขบ้าน" autoFocus
              className="input-base text-center font-mono text-xl tracking-widest" />
          </div>
          <div>
            <label className="text-label block mb-2">รหัสผ่าน</label>
            <input type="password" value={pass}
              onChange={e=>setPass(e.target.value)} placeholder="รหัสผ่าน"
              className="input-base text-center font-mono tracking-[0.3em]" />
          </div>
          {err && <p className="text-xs text-red-400 text-center">{err}</p>}
          <button type="submit" disabled={checkingPassword} className="btn w-full py-2.5 text-sm font-semibold"
            style={{ background:'linear-gradient(135deg,#7c3aed,#a78bfa)', boxShadow:'0 0 20px rgba(124,58,237,0.3)' }}>
            เข้าสู่เกม
          </button>
        </form>
        <div className="flex justify-center mt-4"><HomeButton /></div>
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>
    </div>
  )
}

/* ── Game screen ───────────────────────────────────────────── */
function BaanLoginV2({ onLogin }: { onLogin:(b:number)=>void }) {
  const [baan, setBaan] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [shake, setShake] = useState(false)
  const [checkingPassword, setCheckingPassword] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const b = parseInt(baan)
    if (isNaN(b) || b < 1 || b > 12) {
      setErr('กรอกเลขบ้าน 1-12 เท่านั้น')
      return
    }
    setCheckingPassword(true)
    const result = await verifyBaanPassword(b, pass).catch(error => {
      console.error(error)
      return { ok: false, token: undefined, message: String(error) }
    })
    setCheckingPassword(false)
    if (!result.ok || !result.token) {
      setErr('รหัสผ่านไม่ถูกต้อง')
      setShake(true)
      setTimeout(() => setShake(false), 500)
      return
    }
    sessionStorage.setItem('baan_login', String(b))
    sessionStorage.setItem('baan_login_token', result.token)
    onLogin(b)
  }

  return (
    <div className="auth-page min-h-screen app-shell flex items-center justify-center px-4 py-6">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute top-1/3 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-violet-600/10 blur-[100px]" />
      </div>

      <div className={clsx('auth-card auth-card-baan relative z-10 w-full', shake && 'animate-[shake_0.4s_ease-in-out]')}>
        <div className="auth-icon mx-auto flex items-center justify-center rounded-2xl border bg-white">
          <Landmark size={24} />
        </div>

        <div className="auth-heading text-center">
          <h1 className="font-display font-black text-slate-950">เข้าสู่ระบบ</h1>
          <p className="font-semibold text-slate-500">เกมลงทุนพื้นที่ · ช่วงบ่าย</p>
        </div>

        <form onSubmit={submit} className="auth-form">
          <div className="auth-field">
            <label className="auth-label">เลขบ้าน (1-12)</label>
            <input
              type="number"
              min={1}
              max={12}
              value={baan}
              onChange={e => setBaan(e.target.value)}
              placeholder="กรอกเลขบ้าน"
              autoFocus
              className="input-base auth-input text-center text-lg"
            />
          </div>

          <div className="auth-field">
            <label className="auth-label">รหัสผ่าน</label>
            <input
              type="password"
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="รหัสผ่าน"
              className="input-base auth-input text-center"
            />
          </div>

          {err && <p className="auth-error text-center text-xs font-bold text-red-500">{err}</p>}

          <button
            type="submit"
            disabled={checkingPassword}
            className="btn auth-submit w-full"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#a78bfa)', boxShadow: '0 16px 34px rgba(124,58,237,0.28)' }}
          >
            {checkingPassword ? 'กำลังตรวจสอบ...' : 'เข้าสู่เกม'}
          </button>
        </form>

        <div className="auth-home"><HomeButton /></div>
      </div>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>
    </div>
  )
}

interface CartItem { area:string; amount:number }
type GoogleSheetCell = { v?: string | number | null } | null
type GoogleSheetRow = { c?: GoogleSheetCell[] }
type BiddingDraft = {
  cart?: CartItem[]
  kingDis?: number | null
  betTarget?: string
  betAmount?: string
  updatedAt?: number
}

const BIDDING_DRAFT_TTL_MS = 10 * 60 * 1000

function readBiddingDraft(key: string): BiddingDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const draft = JSON.parse(window.localStorage.getItem(key) || 'null') as BiddingDraft | null
    if (!draft) return null
    if (!draft.updatedAt || Date.now() - draft.updatedAt > BIDDING_DRAFT_TTL_MS) {
      window.localStorage.removeItem(key)
      return null
    }
    return draft
  } catch {
    return null
  }
}

function writeBiddingDraft(key: string, draft: BiddingDraft) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify({ ...draft, updatedAt: Date.now() }))
}

function clearBiddingDraft(key: string) {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(key)
}

function sheetInputToCart(row: WaveInputRow | null): CartItem[] {
  if (!row) return []
  const islands = row.islands
    .filter(item => /^[ABC][1-9]$/.test(item.name) && item.amount > 0)
    .slice(0, 3)
    .map(item => ({ area: item.name, amount: item.amount }))
  const king = row.kingAmount > 0 ? [{ area: 'KING', amount: row.kingAmount }] : []
  return [...islands, ...king]
}

function normalizeSheetBetTarget(value: string) {
  const match = String(value || '').match(/\d{1,2}/)
  const baan = Number(match?.[0] ?? '')
  return Number.isInteger(baan) && baan >= 1 && baan <= 12 ? String(baan) : ''
}

type EventRank = { rank: number; baan: number; saving?: boolean }
type EventStatus = {
  wave: number
  questionReady?: boolean
  solutionVisible?: boolean
  results?: EventRank[]
}

function EventGamePanel({ baan, wave, isOpen, showSolution }: { baan: number; wave: number; isOpen: boolean; showSolution: boolean }) {
  const [status, setStatus] = useState<EventStatus | null>(null)
  const [answer, setAnswer] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const currentEventRef = useRef({ wave, showSolution })
  const ownRank = status?.results?.find(item => item.baan === baan)?.rank ?? null
  const canSubmit = isOpen && !submitting && Boolean(answer.trim()) && !ownRank

  const refreshStatus = useCallback(async () => {
    if (wave !== 2 && wave !== 4) return
    try {
      const res = await fetch(`/api/event/status?wave=${wave}&t=${Date.now()}`, { cache: 'no-store' })
      const data = await res.json()
      const current = currentEventRef.current
      if (current.wave !== wave) return
      if (res.ok && data.status !== 'error') {
        const safeData: EventStatus = {
          wave: Number(data.wave),
          questionReady: data.questionReady === true,
          solutionVisible: current.showSolution && data.solutionVisible === true,
          results: Array.isArray(data.results) ? data.results : [],
        }
        setStatus(safeData)
      }
    } catch (error) {
      console.error(error)
    }
  }, [wave])

  useEffect(() => {
    currentEventRef.current = { wave, showSolution }
  }, [wave, showSolution])

  useEffect(() => {
    setStatus(null)
    setAnswer('')
    setMessage('')
  }, [wave])

  useEffect(() => {
    if (!showSolution) {
      setStatus(prev => prev ? { ...prev, solutionVisible: false } : prev)
    }
  }, [showSolution])

  useEffect(() => {
    void refreshStatus()
    const interval = window.setInterval(refreshStatus, isOpen ? 2500 : 6000)
    return () => window.clearInterval(interval)
  }, [isOpen, refreshStatus])

  useEffect(() => {
    void refreshStatus()
  }, [showSolution, refreshStatus])

  const submitAnswer = async (event: React.FormEvent) => {
    event.preventDefault()
    const cleaned = answer.trim()
    if (!isOpen || !cleaned || submitting || ownRank) return
    setSubmitting(true)
    setMessage('')
    try {
      const res = await fetch('/api/event/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wave,
          baan,
          answer: cleaned,
          token: sessionStorage.getItem('baan_login_token') || '',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.status === 'error') throw new Error(data.message || 'Submit failed')
      if (data.correct) {
        if (Array.isArray(data.results)) {
          setStatus(prev => ({
            wave,
            questionReady: prev?.questionReady,
            solutionVisible: prev?.solutionVisible,
            results: data.results,
          }))
        }
        setMessage(data.saving || data.queued ? `Correct! Rank ${data.rank ?? '-'} - Saving...` : `Correct! Rank ${data.rank ?? '-'}`)
        setAnswer('')
        void refreshStatus()
      } else {
        setMessage('Wrong answer')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="event-game-panel">
      <div className="event-main-column">
        <div className="event-question-frame">
        {status?.questionReady ? (
          <img
            key={`question-${wave}`}
            src={`/api/event/image?wave=${wave}&type=question&v=${wave}`}
            alt="Event question"
            className="event-question-image"
            draggable={false}
          />
        ) : (
          <div className="event-question-placeholder">Event question</div>
        )}
        </div>
      {showSolution && status?.solutionVisible ? (
        <div className="event-question-frame">
          <img
            key={`solution-${wave}-${showSolution ? 'shown' : 'hidden'}`}
            src={`/api/event/image?wave=${wave}&type=solution&v=${wave}-${status?.solutionVisible ? '1' : '0'}`}
            alt="Event solution"
            className="event-question-image"
            draggable={false}
          />
        </div>
      ) : showSolution ? (
        <div className="event-solution-missing">Solution image is not configured.</div>
      ) : null}
      <form onSubmit={submitAnswer} className="event-answer-form">
        <input
          value={answer}
          onChange={event => setAnswer(event.target.value)}
          disabled={!isOpen || submitting || Boolean(ownRank)}
          className="input-base event-answer-input"
          placeholder={ownRank ? `Already correct: rank ${ownRank}` : isOpen ? 'Type answer' : 'Waiting for admin to open'}
        />
        <button type="submit" disabled={!canSubmit} className="btn btn-primary event-answer-button">
          {submitting ? 'Checking...' : 'submit&check'}
        </button>
      </form>
      {message && (
        <div className={clsx('event-answer-message', message.toLowerCase().includes('wrong') ? 'bad' : 'good')}>
          {message}
        </div>
      )}
      </div>

      <aside className="event-rank-sidebar" aria-live="polite">
        <div className="event-rank-sidebar-title">Rank</div>
        <div className="event-rank-list">
        {(status?.results ?? []).length ? (status?.results ?? []).map(item => (
          <div
            key={`${item.rank}-${item.baan}`}
            className={clsx(
              'event-rank-item',
              item.rank <= 3 && 'is-top-rank',
              item.rank === 1 && 'is-rank-1',
              item.rank === 2 && 'is-rank-2',
              item.rank === 3 && 'is-rank-3',
            )}
          >
            <span className="event-rank-number">{item.rank}</span>
            <strong>
              {HOUSE_NAMES[item.baan]}
              {item.saving && <span className="ml-1 text-[10px] font-bold text-blue-600">Saving...</span>}
            </strong>
          </div>
        )) : (
          <div className="event-rank-empty">No correct answers yet.</div>
        )}
        </div>
      </aside>
    </div>
  )
}

/* ── Welcome & Rules Screens ────────────────────────────────── */
function WelcomeScreen({ baan }: { baan: number }) {
  return (
    <div className="welcome-rules-page text-slate-800 w-full min-w-full">
      <header className="wire-topbar flex items-center justify-between w-full">
        <div className="flex items-center gap-8">
          <HomeButton className="bg-white/10 border-white/20 text-white hover:text-white" />
          <div className="wire-title text-white">Welcome to BigGame 2026</div>
          <div className="wire-title text-white flex items-center gap-3">
            {HOUSE_NAMES[baan]}
          </div>
        </div>
        <button onClick={()=>{sessionStorage.removeItem('baan_login');sessionStorage.removeItem('baan_login_token');window.location.reload()}}
          className="btn btn-ghost text-white/90 hover:text-red-300 hover:bg-white/10 flex items-center gap-1.5 font-bold">
          <LogOut size={16} /> Logout
        </button>
      </header>

      <main className="welcome-rules-main flex-1 flex items-center justify-center w-full my-auto">
        <div className="auth-card auth-card-baan text-center w-full relative z-10">
          <div className="text-5xl mb-4 animate-bounce">🏛️</div>
          <h2 className="text-3xl font-black text-slate-950 mb-1">{HOUSE_NAMES[baan]}</h2>
          <p className="font-semibold text-slate-500 mb-6">ยินดีต้อนรับเข้าสู่ระบบเกมลงทุนช่วงบ่าย</p>
          
          <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-cyan-50 border border-cyan-100 shadow-sm mb-4">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
            </span>
            <span className="font-mono font-bold tracking-wider text-cyan-600 text-sm">WAITING FOR START</span>
          </div>

          <p className="text-xs font-semibold text-slate-400 mt-2 leading-relaxed">
            กรุณารอผู้ควบคุมระบบ (Admin) เริ่มต้นวิดีโออธิบายกติกา
          </p>
        </div>
      </main>

      <footer className="w-full text-center text-xs text-slate-400 font-semibold mt-6 mb-4">
        MDCU Freshy Camp 2026
      </footer>

      <style>{`
        .welcome-rules-page {
          background:
            radial-gradient(circle at 50% 30%, rgba(255,255,255,0.82), transparent 34rem),
            linear-gradient(135deg, rgba(219,234,254,0.95), rgba(245,243,255,0.95) 46%, rgba(236,253,245,0.95)),
            #eef4ff;
          min-height: 100vh;
          width: 100% !important;
          min-width: 100% !important;
          max-width: 100vw !important;
          display: flex;
          flex-direction: column;
        }
        .welcome-rules-main {
          padding: clamp(20px, 4vh, 40px) clamp(16px, 4vw, 36px);
        }
      `}</style>
    </div>
  )
}

interface RulesVideoScreenProps {
  baan: number
  timerEnd: string | null
}

function RulesVideoScreen({ baan, timerEnd }: RulesVideoScreenProps) {
  const playerRef = useRef<any>(null)
  const [videoState, setVideoState] = useState<'loading' | 'playing' | 'ended'>('loading')
  const [playerState, setPlayerState] = useState<number>(-1)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const handleFullscreen = () => {
    const el = document.getElementById('video-wrapper')
    if (el) {
      if (document.fullscreenElement) {
        document.exitFullscreen()
      } else {
        el.requestFullscreen().catch(err => {
          console.error('Error entering fullscreen:', err)
        })
      }
    }
  }

  const handlePlayClick = () => {
    if (playerRef.current && playerRef.current.playVideo) {
      playerRef.current.playVideo()
    }
  }

  useEffect(() => {
    // 1. Load the YouTube Iframe API if not already loaded
    if (!(window as any).YT) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      const firstScriptTag = document.getElementsByTagName('script')[0]
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag)
    }

    // 2. Set up the callback for when the API is ready
    const previousCallback = (window as any).onYouTubeIframeAPIReady
    ;(window as any).onYouTubeIframeAPIReady = () => {
      if (previousCallback) previousCallback()
      initPlayer()
    }

    // If YT is already loaded, init immediately
    if ((window as any).YT && (window as any).YT.Player) {
      initPlayer()
    }

    function initPlayer() {
      if (playerRef.current) return
      playerRef.current = new (window as any).YT.Player('youtube-rules-player', {
        videoId: 'Nq69KlCbHXo',
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,
        },
        events: {
          onReady: (event: any) => {
            setVideoState('playing')
            setPlayerState(event.target.getPlayerState())
            syncVideoTime(event.target)
          },
          onStateChange: (event: any) => {
            setPlayerState(event.data)
            if (event.data === (window as any).YT.PlayerState.ENDED) {
              setVideoState('ended')
            }
          },
        },
      })
    }

    // Periodically enforce sync and unskippability (every 1 second)
    const interval = setInterval(() => {
      if (playerRef.current) {
        if (playerRef.current.getPlayerState) {
          setPlayerState(playerRef.current.getPlayerState())
        }
        if (playerRef.current.getCurrentTime && videoState === 'playing' && playerRef.current.getPlayerState() === 1) {
          syncVideoTime(playerRef.current)
        }
      }
    }, 1000)

    function syncVideoTime(player: any) {
      if (!timerEnd) return
      const duration = (player.getDuration() || 720) + 60 // Video duration + 1m buffer (total 13m = 780s)
      const endMs = new Date(timerEnd).getTime()
      const remainingSeconds = Math.max(0, (endMs - Date.now()) / 1000)
      const expectedTime = Math.max(0, duration - remainingSeconds)

      const currentTime = player.getCurrentTime()
      if (Math.abs(currentTime - expectedTime) > 2) {
        player.seekTo(expectedTime, true)
      }
    }

    return () => {
      clearInterval(interval)
      if (playerRef.current && playerRef.current.destroy) {
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  }, [timerEnd, videoState])

  const showPlayOverlay = videoState === 'playing' && (playerState === -1 || playerState === 2 || playerState === 5)

  return (
    <div className="welcome-rules-page text-slate-800 w-full min-w-full">
      <header className="wire-topbar flex items-center justify-between w-full">
        <div className="flex items-center gap-8">
          <HomeButton className="bg-white/10 border-white/20 text-white hover:text-white" />
          <div className="wire-title text-white">คำอธิบายกติกา</div>
          <div className="wire-title text-white flex items-center gap-3">
            {HOUSE_NAMES[baan]}
          </div>
        </div>
        <div className="wire-time">
          <Timer endTime={timerEnd} isOpen={true} compact />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center welcome-rules-main w-full max-w-4xl mx-auto my-auto">
        <div className="w-full flex flex-col items-center">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-black text-slate-950 tracking-tight mb-2">กรุณารับชมกติกาการแข่งขันอย่างตั้งใจ</h2>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold shadow-sm">
              <span>📢</span> วิดีโอนี้กำลังเล่นแบบเรียลไทม์และไม่สามารถกดข้ามได้
            </div>
          </div>

          <div id="video-wrapper" className="relative w-full aspect-video rounded-2xl overflow-hidden border border-slate-200/80 shadow-2xl bg-black group">
            <div id="youtube-rules-player" className="w-full h-full" />
            
            {/* Invisible click overlay to prevent standard player actions */}
            <div className="absolute inset-0 z-40 bg-transparent cursor-default pointer-events-auto" />

            {/* Play Button Overlay (shown when paused or cued due to autoplay block) */}
            {showPlayOverlay && (
              <div 
                onClick={handlePlayClick}
                className="absolute inset-0 z-50 bg-black/60 flex flex-col items-center justify-center cursor-pointer hover:bg-black/70 transition-all text-center px-4"
              >
                <div className="w-20 h-20 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-2xl transition-all transform hover:scale-105 mb-4">
                  <svg className="w-10 h-10 fill-current ml-1" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <p className="font-bold text-lg text-white">คลิกเพื่อเริ่มเล่นวิดีโอกติกา</p>
                <p className="text-sm text-slate-300 mt-1">Click to play rules video</p>
              </div>
            )}

            {/* Fullscreen Button Overlay */}
            <button 
              onClick={handleFullscreen}
              className="absolute bottom-4 right-4 z-50 p-2.5 rounded-lg bg-black/60 hover:bg-black/80 text-white border border-white/15 transition-all cursor-pointer shadow-lg flex items-center justify-center backdrop-blur-sm"
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>

            {videoState === 'loading' && (
              <div className="absolute inset-0 z-40 bg-slate-950 flex flex-col items-center justify-center gap-4">
                <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                <p className="font-mono text-sm text-cyan-300">กำลังเชื่อมต่อสตรีมกติกา...</p>
              </div>
            )}

            {videoState === 'ended' && (
              <div className="absolute inset-0 z-40 bg-slate-950/90 flex flex-col items-center justify-center gap-3">
                <div className="text-5xl animate-pulse">📢</div>
                <p className="font-bold text-lg text-white">วิดีโอกติกาจบลงแล้ว</p>
                <p className="text-sm text-slate-400">กรุณารอผู้ดูแลระบบเริ่มต้นเปิดการลงทุน</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="w-full text-center text-xs text-slate-400 font-semibold mt-6 mb-4">
        MDCU Freshy Camp 2026
      </footer>

      <style>{`
        .welcome-rules-page {
          background:
            radial-gradient(circle at 50% 30%, rgba(255,255,255,0.82), transparent 34rem),
            linear-gradient(135deg, rgba(219,234,254,0.95), rgba(245,243,255,0.95) 46%, rgba(236,253,245,0.95)),
            #eef4ff;
          min-height: 100vh;
          width: 100% !important;
          min-width: 100% !important;
          max-width: 100vw !important;
          display: flex;
          flex-direction: column;
        }
        .welcome-rules-main {
          padding: clamp(20px, 4vh, 40px) clamp(16px, 4vw, 36px);
        }
        #video-wrapper:fullscreen {
          width: 100vw !important;
          max-width: 100vw !important;
          height: 100vh !important;
          border-radius: 0 !important;
          border: none !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          background: #000 !important;
        }
      `}</style>
    </div>
  )
}

function BiddingGame({ baan }: { baan:number }) {
  const [gs,        setGS]        = useState(getGameState)
  const [cart,      setCart]      = useState<CartItem[]>([])
  const [kingDis,   setKingDis]   = useState<number|null>(null)
  const [filterDis, setFilterDis] = useState<number|null>(null)
  const [balance,   setBalance]   = useState(0)
  const [isKing,    setIsKing]    = useState(false)
  const [currentKing, setCurrentKing] = useState<number | null>(null)
  const [kingOwner, setKingOwner] = useState<number | null>(null)
  const [bidContextMeta, setBidContextMeta] = useState<{ wave: number; king: number | null; viewingKing: number | null; disaster: number | null }>({
    wave: 0,
    king: null,
    viewingKing: null,
    disaster: null,
  })
  const [isSaved,   setIsSaved]   = useState(true)
  const [savedAt,   setSavedAt]   = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncReason, setSyncReason] = useState<'manual' | 'auto' | null>(null)
  const [draftReady, setDraftReady] = useState(false)
  const [betTarget, setBetTarget] = useState('')
  const [betAmount, setBetAmount] = useState('')
  const [sheetBetSpend, setSheetBetSpend] = useState(0)
  const [sheetInput, setSheetInput] = useState<WaveInputRow | null>(null)
  const [sheetSnapshotLoaded, setSheetSnapshotLoaded] = useState(false)
  const [isLoaded] = useState(true)
  const [resultToast, setResultToast] = useState<{ wave: number; key: number; leaving?: boolean } | null>(null)
  const [highlightedResultWave, setHighlightedResultWave] = useState<{ wave: number; leaving?: boolean } | null>(null)
  const saveInFlight = useRef(false)
  const lastSuccessfulSaveAt = useRef(0)
  const pendingSheetWriteUntil = useRef(0)
  const hydratedSubmissionKey = useRef('')
  const historySectionRef = useRef<HTMLElement | null>(null)
  const previousResultState = useRef<{ wave: number; showResults: boolean } | null>(null)
  const previousOpenState = useRef(getGameState().isOpen)
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const totalBet = useMemo(() => cart.reduce((s,i)=>s+i.amount,0), [cart])
  const islandCart = useMemo(() => cart.filter(i => i.area !== 'KING'), [cart])
  const kingBid = useMemo(() => cart.find(i => i.area === 'KING'), [cart])
  const selectedAreaKey = cart.map(i => i.area).join('|')
  const selectedAreas = useMemo(() => selectedAreaKey ? selectedAreaKey.split('|') : [], [selectedAreaKey])
  const kingBidAmount = kingBid?.amount || 0
  const betAmountNumber = betAmount.trim() === '' ? NaN : Number(betAmount)
  const betSpend = Number.isFinite(betAmountNumber) ? betAmountNumber : 0
  const minBetAmount = balance > 0 ? Math.ceil(balance * 0.1) : 0
  const isBetAmountValid = balance > 0 && Number.isFinite(betAmountNumber) && betAmountNumber >= minBetAmount && betAmountNumber <= balance
  const isBetMode = gs.gameMode === 'bet'
  const isEventMode = gs.gameMode === 'event'
  const isSelectDisasterPhase = !isBetMode && gs.gamePhase === 'select-disaster'
  const bidContextWave = Math.max(1, gs.currentWave - 1)
  const draftMode = isBetMode ? 'bet' : isEventMode ? 'event' : isSelectDisasterPhase ? 'select-disaster' : 'bid'
  const draftKey = `biggame_bidding_draft:${baan}:${gs.currentWave}:${draftMode}`
  const currentSubmission = getSubmissionsForBaan(baan).find(s => s.wave === gs.currentWave)
  const canUseLocalSubmittedData = !sheetSnapshotLoaded || saveInFlight.current || isSyncing || Date.now() - lastSuccessfulSaveAt.current < 5000
  const priorBetSpend = !isBetMode ? sheetBetSpend || (canUseLocalSubmittedData ? currentSubmission?.betAmount || 0 : 0) : 0
  const sheetFinalBalance = sheetInput?.currentBalance || balance
  const effectiveBalance = Math.max(0, balance - priorBetSpend)
  const cartDisplayBalance = gs.showResults === true ? sheetFinalBalance : effectiveBalance - totalBet
  const betBalance = gs.showResults === true ? sheetFinalBalance : balance
  const betAfterBalance = gs.showResults === true ? sheetFinalBalance : balance - betSpend
  const canChooseKingDisaster = isKing || currentKing === baan
  const canEditBid = gs.isOpen && !isBetMode && !isEventMode && !isSelectDisasterPhase
  const canSelectKingDisaster = gs.isOpen && isSelectDisasterPhase && canChooseKingDisaster
  const canSeeCurrentOwnership = gs.showResults === true || canSelectKingDisaster
  const canSeePreviousBidOwnership = canEditBid && gs.currentWave > 1
  const currentSheetOwnership = useWaveOwnership(gs.currentWave)
  const previousSheetOwnership = useWaveOwnership(bidContextWave)
  const visibleOwnershipSource = canSeeCurrentOwnership
    ? currentSheetOwnership
    : canSeePreviousBidOwnership
      ? previousSheetOwnership
      : null
  const visibleOwnership = visibleOwnershipSource?.ownership ?? {}
  const visibleDisasterOwnership = visibleOwnershipSource?.disasterOwnership ?? {}
  const visibleEradicatedOwnership = visibleOwnershipSource?.eradicatedOwnership ?? {}
  const activeSheetDisaster = getActiveDisasterForWave(gs.currentWave)
  const hasBidContextMeta = bidContextMeta.wave === bidContextWave
  const mapKingDisaster = canSeeCurrentOwnership
    ? isSelectDisasterPhase && canChooseKingDisaster
      ? kingDis
      : gs.showResults === true
        ? activeSheetDisaster
        : null
    : canSeePreviousBidOwnership && hasBidContextMeta
      ? bidContextMeta.disaster
      : null
  const mapCurrentKing = canSeeCurrentOwnership
    ? currentKing
    : canSeePreviousBidOwnership && hasBidContextMeta
      ? bidContextMeta.viewingKing
      : null
  const mapKingOwner = canSeeCurrentOwnership
    ? kingOwner
    : canSeePreviousBidOwnership && hasBidContextMeta
      ? bidContextMeta.king
      : null
  const hasBetSheetInput = Boolean(sheetInput?.hasBetInput)
  const hasFreshLocalBetInput = Boolean(
    savedAt
      && currentSubmission?.betTarget
      && currentSubmission?.betAmount
      && canUseLocalSubmittedData,
  )
  const hasExistingBetInput = hasBetSheetInput || hasFreshLocalBetInput
  const isBetSubmitSaved = isBetMode && isSaved && hasExistingBetInput
  const isBetSubmitDisabled = !gs.isOpen || isSyncing || !betTarget || !isBetAmountValid || isBetSubmitSaved
  const betSubmitVerb = hasExistingBetInput ? 'Resubmit' : 'Submit'

  useEffect(() => {
    const hydrateKey = `${gs.currentWave}:${baan}:${draftMode}`
    if (hydratedSubmissionKey.current === hydrateKey) return
    hydratedSubmissionKey.current = hydrateKey
    setDraftReady(false)
    setSheetSnapshotLoaded(false)

    const draft = readBiddingDraft(draftKey)
    if (draft) {
      if (isBetMode) {
        setBetTarget(draft.betTarget ?? '')
        setBetAmount(draft.betAmount ?? '')
      } else if (isSelectDisasterPhase) {
        setKingDis(draft.kingDis ?? null)
      } else {
        setCart(draft.cart ?? [])
      }
      setIsSaved(false)
      setSavedAt('')
      setSaveMessage('Recovered local draft')
      setIsSyncing(false)
      setDraftReady(true)
      return
    }

    const saved = getSubmissionsForBaan(baan).find(s => s.wave === gs.currentWave)
    if (!saved) {
      if (isBetMode) {
        setBetTarget('')
        setBetAmount('')
      } else if (isSelectDisasterPhase) {
        setKingDis(null)
      } else {
        setCart([])
      }
      setIsSaved(true)
      setSavedAt('')
      setSaveMessage('')
      setIsSyncing(false)
      setDraftReady(true)
      return
    }

    if (isBetMode) {
      setBetTarget(saved.betTarget ? String(saved.betTarget) : '')
      setBetAmount(saved.betAmount ? String(saved.betAmount) : '')
    } else if (isSelectDisasterPhase) {
      if (saved.kingDisaster) setKingDis(saved.kingDisaster)
    } else {
      setCart(saved.bets ?? [])
    }

    setIsSaved(true)
    setSavedAt(saved.timestamp ?? '')
    setSaveMessage('')
    setIsSyncing(false)
    setDraftReady(true)
  }, [baan, gs.currentWave, draftMode, draftKey, isBetMode, isSelectDisasterPhase])

  useEffect(() => {
    if (!draftReady) return
    const hasDraft = isBetMode
      ? betTarget !== '' || betAmount !== ''
      : isSelectDisasterPhase
        ? kingDis !== null
        : cart.length > 0

    if (!hasDraft || isSaved) {
      if (!hasDraft) clearBiddingDraft(draftKey)
      return
    }

    writeBiddingDraft(draftKey, {
      cart,
      kingDis,
      betTarget,
      betAmount,
    })
  }, [draftReady, draftKey, isBetMode, isSelectDisasterPhase, betTarget, betAmount, kingDis, cart, isSaved])

  const applySheetInput = useCallback((row: WaveInputRow | null, info: { king: number | null; viewingKing: number | null; kingDisaster: number | null }) => {
    setSheetInput(row)
    setSheetSnapshotLoaded(true)
    setCurrentKing(info.viewingKing)
    setKingOwner(info.king)
    setIsKing(info.viewingKing === baan)
    setActiveDisaster(gs.currentWave, info.kingDisaster)
    setSheetBetSpend(row?.betAmount || 0)
    if (row) setBalance(row.balance || 0)

    const state = getGameState()
    let hasStoredDraft = readBiddingDraft(draftKey) !== null
    const sheetHasCurrentMode = isBetMode
      ? row?.hasBetInput === true
      : state.gamePhase === 'select-disaster'
        ? info.kingDisaster != null
        : row?.hasBidInput === true
    if (sheetHasCurrentMode) {
      pendingSheetWriteUntil.current = 0
      if (hasStoredDraft && isSaved) {
        clearBiddingDraft(draftKey)
        hasStoredDraft = false
      }
    }
    const hasLocalDraft = hasStoredDraft && Date.now() < pendingSheetWriteUntil.current
    const mayHydrateFromSheet = !hasLocalDraft && !saveInFlight.current && isSaved && !isSyncing
    const saveRecentlySucceeded = Date.now() - lastSuccessfulSaveAt.current < 5000
    const canAcceptSheetBlank = mayHydrateFromSheet && !saveRecentlySucceeded

    if (isBetMode && canAcceptSheetBlank && !row?.hasBetInput) {
      if (currentSubmission?.betTarget || currentSubmission?.betAmount) {
        deleteSubmissionForBaanWave(baan, gs.currentWave)
      }
      clearBiddingDraft(draftKey)
      setBetTarget('')
      setBetAmount('')
      setSavedAt('')
      setSaveMessage('')
      setIsSaved(true)
      return
    }

    if (state.gamePhase === 'select-disaster') {
      if (!(state.isOpen && info.viewingKing === baan && !isSaved)) {
        setKingDis(info.kingDisaster)
      }
      if (mayHydrateFromSheet) {
        const sheetCart = sheetInputToCart(row)
        setCart(sheetCart)
        if (sheetCart.length > 0 || info.kingDisaster != null) {
          setSavedAt('Sheet')
          setSaveMessage('')
        }
      }
      return
    }

    if (!mayHydrateFromSheet) return

    if (isBetMode) {
      if (row?.hasBetInput) {
        const nextTarget = normalizeSheetBetTarget(row.betTarget)
        if (nextTarget) setBetTarget(nextTarget)
        if (row.betAmount > 0) setBetAmount(String(row.betAmount))
        setSavedAt('Sheet')
        setSaveMessage('')
      }
      return
    }

    if (canAcceptSheetBlank && !row?.hasBidInput) {
      if (currentSubmission?.bets?.length) {
        deleteSubmissionForBaanWave(baan, gs.currentWave)
      }
      clearBiddingDraft(draftKey)
      setCart([])
      setSavedAt('')
      setSaveMessage('')
      setIsSaved(true)
      return
    }

    if (row?.hasBidInput) {
      const sheetCart = sheetInputToCart(row)
      setCart(sheetCart)
      setSavedAt('Sheet')
      setSaveMessage('')
    }
  }, [baan, currentSubmission, draftKey, gs.currentWave, isBetMode, isSaved, isSyncing])

  const fetchSheetSnapshot = useCallback(async () => {
    try {
      const wave = getGameState().currentWave
      const data = await fetchWaveInputs(wave)
      if (wave !== getGameState().currentWave) return
      const row = data.rows.find(item => item.baan === baan) ?? null
      applySheetInput(row, { king: data.king, viewingKing: data.viewingKing, kingDisaster: data.kingDisaster })
    } catch (e) {
      console.error(e)
    }
  }, [applySheetInput, baan])

  useEffect(() => {
    const refresh = () => { void fetchSheetSnapshot() }
    const initial = setTimeout(refresh, 0)
    const t = setInterval(refresh, 12000)
    return () => { clearTimeout(initial); clearInterval(t) }
  }, [fetchSheetSnapshot])

  /* fetch balance from Wave sheet */
  const fetchBalance = useCallback(async()=>{
    try {
      const wave = getGameState().currentWave
      const url  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&${getWaveSheetQuery(wave)}&t=${Date.now()}`
      const text = await (await fetch(url,{cache:'no-store'})).text()
      const js   = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)?.[1]
      if(!js) return
      const rows = (JSON.parse(js)?.table?.rows??[]) as GoogleSheetRow[]
      const row = rows.find((r)=>parseInt(String(r?.c?.[0]?.v??''))===baan)
      if(row){
        const startingBalance = parseFloat(String(row?.c?.[1]?.v??0))||0
        setBalance(startingBalance)
        setSheetBetSpend(parseFloat(String(row?.c?.[3]?.v??0))||0)
      } else {
        setSheetBetSpend(0)
      }
    }catch(e){console.error(e)}
  },[baan])

  useEffect(()=>{
    const refresh = () => { void fetchBalance() }
    const initial = setTimeout(refresh, 0)
    const t=setInterval(refresh,20000)
    return()=>{ clearTimeout(initial); clearInterval(t) }
  },[fetchBalance])

  const fetchKingInfo = useCallback(async () => {
    try {
      const state = getGameState()
      const wave = state.currentWave
      const info = await fetchWaveInfo(wave)
      setCurrentKing(info.viewingKing)
      setKingOwner(info.king)
      setIsKing(info.viewingKing === baan)
      if (!(state.isOpen && state.gamePhase === 'select-disaster' && info.viewingKing === baan && !isSaved)) {
        setKingDis(info.disaster)
      }
      setActiveDisaster(wave, info.disaster)
    } catch(e) { console.error(e) }
  }, [baan, isSaved])

  useEffect(()=>{
    const refresh = () => { void fetchKingInfo() }
    const initial = setTimeout(refresh, 0)
    const t=setInterval(refresh,20000)
    return()=>{ clearTimeout(initial); clearInterval(t) }
  },[fetchKingInfo])
  useEffect(()=>{
    const t = setTimeout(() => { void fetchKingInfo() }, 0)
    return () => clearTimeout(t)
  },[fetchKingInfo, gs.currentWave])

  useEffect(() => {
    if (gs.currentWave <= 1) {
      setBidContextMeta({ wave: 0, king: null, viewingKing: null, disaster: null })
      return
    }
    const contextWave = gs.currentWave - 1
    let cancelled = false
    fetchWaveInfo(contextWave)
      .then(info => {
        if (cancelled) return
        setBidContextMeta({
          wave: contextWave,
          king: info.king,
          viewingKing: info.viewingKing,
          disaster: info.disaster,
        })
        setActiveDisaster(contextWave, info.disaster)
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [gs.currentWave])

  /* subscribe store */
  useEffect(()=>{
    if (!isLoaded) return
    const u=subscribeStore(()=>{ setGS(getGameState()) })
    return u
  },[isLoaded])

  useEffect(() => {
    const previous = previousResultState.current
    const showResults = gs.showResults === true
    const justRevealed = showResults && previous?.showResults === false

    previousResultState.current = { wave: gs.currentWave, showResults }

    if (!justRevealed) return

    const wave = gs.currentWave
    setResultToast({ wave, key: Date.now() })
    setHighlightedResultWave({ wave })
    clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => {
      setHighlightedResultWave(current => current?.wave === wave ? { ...current, leaving: true } : current)
    }, 10000)
    const scrollTimer = setTimeout(() => {
      historySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)

    return () => clearTimeout(scrollTimer)
  }, [gs.currentWave, gs.showResults])

  useEffect(() => {
    if (!resultToast) return
    const toastKey = resultToast.key
    const leaveTimer = setTimeout(() => {
      setResultToast(current => current?.key === toastKey ? { ...current, leaving: true } : current)
    }, 5000)
    const removeTimer = setTimeout(() => {
      setResultToast(current => current?.key === toastKey ? null : current)
    }, 6100)
    return () => {
      clearTimeout(leaveTimer)
      clearTimeout(removeTimer)
    }
  }, [resultToast?.key])

  useEffect(() => () => clearTimeout(highlightTimer.current), [])

  useEffect(() => {
    if (!highlightedResultWave?.leaving) return
    const wave = highlightedResultWave.wave
    const t = setTimeout(() => {
      setHighlightedResultWave(current => current?.wave === wave ? null : current)
    }, 900)
    return () => clearTimeout(t)
  }, [highlightedResultWave])

  /* map select */
  const handleSelect = (area:string)=>{
    if(!canEditBid) return
    if(saveInFlight.current) return
    const alreadySelected = cart.some(i=>i.area===area)
    if (!alreadySelected && effectiveBalance - totalBet < 100) {
      setSaveMessage('Balance is still loading or below minimum')
      return
    }
    if (!alreadySelected && area !== 'KING' && islandCart.length >= 3) return
    setCart(prev=>prev.find(i=>i.area===area)?prev.filter(i=>i.area!==area):[...prev,{area,amount:100}])
    setSaveMessage('')
    setIsSaved(false)
  }

  const handleCartUpdate = useCallback((items: CartItem[]) => {
    const state = getGameState()
    if (!state.isOpen || state.gameMode === 'bet' || state.gamePhase === 'select-disaster') return
    if (saveInFlight.current) return
    setCart([...items.filter(x=>x.area !== 'KING').slice(0,3), ...items.filter(x=>x.area === 'KING').slice(0,1)])
    setSaveMessage('')
    setIsSaved(false)
  }, [])

  const handleKingDisasterUpdate = useCallback((disaster: number | null) => {
    const state = getGameState()
    if (!state.isOpen || state.gameMode === 'bet' || state.gamePhase !== 'select-disaster' || !canChooseKingDisaster) return
    if (saveInFlight.current) return
    setKingDis(disaster)
    setSaveMessage('')
    setIsSaved(false)
  }, [canChooseKingDisaster])

  /* save — local store + write to Google Sheet */
  const handleSave = useCallback(async (mode: 'manual' | 'auto' = 'manual')=>{
    if(!gs.isOpen && mode !== 'auto') return
    if(isEventMode) return
    const recentSuccessfulSave = Date.now() - lastSuccessfulSaveAt.current < 5000
    const hasSheetInputForCurrentMode = isBetMode
      ? hasBetSheetInput
      : isSelectDisasterPhase
        ? kingDis != null
        : sheetInput?.hasBidInput === true
    const hasCompleteBetInputForAuto = isBetMode && mode === 'auto' && Boolean(betTarget) && isBetAmountValid
    const betTargetForSave = isBetMode && mode === 'auto'
      ? hasCompleteBetInputForAuto ? betTarget : betTarget || String(baan)
      : betTarget
    const betTargetNumberForSave = Number.parseInt(betTargetForSave, 10)
    const hasBetTargetForSave = Number.isFinite(betTargetNumberForSave)
    const autoBetSpend = isBetMode && mode === 'auto'
      ? hasCompleteBetInputForAuto
        ? betSpend
        : Math.min(balance, Math.max(minBetAmount, Number.isFinite(betAmountNumber) ? betSpend : minBetAmount))
      : betSpend
    const betSpendForSave = isBetMode && mode === 'auto' ? autoBetSpend : betSpend
    const isBetAmountValidForSave = balance > 0
      && Number.isFinite(betSpendForSave)
      && betSpendForSave >= minBetAmount
      && betSpendForSave <= balance
    if (isBetMode && mode === 'auto' && !hasCompleteBetInputForAuto && balance > 0 && betSpendForSave > 0 && betSpendForSave !== betSpend) {
      setBetAmount(String(betSpendForSave))
    }
    if (isBetMode && mode === 'auto' && !hasCompleteBetInputForAuto && !betTarget && hasBetTargetForSave) {
      setBetTarget(String(betTargetNumberForSave))
    }
    if(mode === 'auto' && isSaved && (hasSheetInputForCurrentMode || recentSuccessfulSave)) return
    if(saveInFlight.current) return
    const hasInvalidBidAmount = cart.some(i => !Number.isFinite(i.amount) || i.amount < 100)
    if(isBetMode && (!hasBetTargetForSave || !isBetAmountValidForSave)) return
    const canSubmitDisaster = canSelectKingDisaster || (mode === 'auto' && isSelectDisasterPhase && canChooseKingDisaster)
    if(isSelectDisasterPhase && (!canSubmitDisaster || !kingDis)) return
    if(!isBetMode && !isSelectDisasterPhase && (hasInvalidBidAmount || !Number.isFinite(totalBet) || totalBet <= 0 || totalBet > effectiveBalance)) return

    const timestamp = new Date().toLocaleTimeString('th-TH')
    saveInFlight.current = true
    setIsSyncing(true)
    setSyncReason(mode)
    setSaveMessage(mode === 'auto' ? 'Autosaving...' : 'Sending to admin...')

    // 1. Save locally (instant, always works)
    saveSubmission({
      baan,
      wave: gs.currentWave,
      bets: isBetMode || isSelectDisasterPhase ? currentSubmission?.bets ?? [] : cart,
      isKing: canChooseKingDisaster,
      kingDisaster: canSubmitDisaster ? kingDis ?? undefined : currentSubmission?.kingDisaster,
      betTarget: isBetMode && hasBetTargetForSave ? betTargetNumberForSave : currentSubmission?.betTarget,
      betAmount: isBetMode ? betSpendForSave : currentSubmission?.betAmount,
      timestamp,
      balance: isBetMode ? balance - betSpendForSave : currentSubmission?.balance ?? effectiveBalance,
    })
    if (isSelectDisasterPhase) setActiveDisaster(gs.currentWave, kingDis)

    // 2. Write to Google Sheet via GAS (async, non-blocking)
    // Map cart items to up to 3 islands (areas)
    const islands = islandCart.slice(0,3).map(i=>({ name: i.area, amount: i.amount }))
    const submittedDraft: BiddingDraft = isBetMode
      ? {
        betTarget: hasBetTargetForSave ? String(betTargetNumberForSave) : betTarget,
        betAmount: String(betSpendForSave),
      }
      : isSelectDisasterPhase
        ? { kingDis }
        : { cart }
    writeBiddingDraft(draftKey, submittedDraft)
    const payload = isSelectDisasterPhase
      ? {
        action: 'writeWave' as const,
        wave: gs.currentWave,
        baan,
        kingDisaster: kingDis,
      }
      : {
      action: 'writeWave' as const,
      wave:   gs.currentWave,
      baan,
      betTarget: isBetMode && hasBetTargetForSave ? betTargetNumberForSave : undefined,
      betAmount: isBetMode ? betSpendForSave : undefined,
      kingAmount: !isBetMode && kingBid ? kingBidAmount : undefined,
      kingDisaster: undefined,
      islands: isBetMode ? undefined : islands,
    }
    writeToSheet(payload).then(res => {
      saveInFlight.current = false
      setIsSyncing(false)
      setSyncReason(null)
      if (res.queued) pendingSheetWriteUntil.current = Date.now() + 90_000
      else pendingSheetWriteUntil.current = 0
      setSaveMessage(res.ok ? (res.queued ? 'Sending to sheet...' : 'Sent to admin') : `Admin sync error: ${res.message ?? 'not sent'}`)
      if (!res.ok) {
        setIsSaved(false)
        console.warn('Sheet write failed:', res.message)
        return
      }
      setIsSaved(true)
      setSavedAt(timestamp)
      lastSuccessfulSaveAt.current = Date.now()
      if (!res.queued) clearBiddingDraft(draftKey)
      setTimeout(() => {
        void fetchBalance()
        void fetchSheetSnapshot()
      }, res.queued ? 2500 : 300)
    }).catch(e => {
      saveInFlight.current = false
      pendingSheetWriteUntil.current = 0
      setIsSyncing(false)
      setSyncReason(null)
      setSaveMessage('Admin sync error')
      setIsSaved(false)
      console.error(e)
    })
  },[baan,cart,gs.currentWave,gs.isOpen,isSaved,canChooseKingDisaster,canSelectKingDisaster,kingDis,balance,minBetAmount,totalBet,isBetMode,isEventMode,isSelectDisasterPhase,betTarget,isBetAmountValid,betAmountNumber,betSpend,hasBetSheetInput,sheetInput,fetchBalance,fetchSheetSnapshot,effectiveBalance,currentSubmission,islandCart,kingBid,kingBidAmount,draftKey])

  const normalizeBetAmount = () => {
    if (betAmount.trim() === '') return
    const raw = Number(betAmount)
    if (!Number.isFinite(raw)) {
      setBetAmount('')
      return
    }
    setBetAmount(String(Math.min(Math.max(minBetAmount, raw), balance)))
  }

  useEffect(() => {
    const wasOpen = previousOpenState.current
    previousOpenState.current = gs.isOpen
    if (wasOpen && !gs.isOpen) {
      void handleSave('auto')
    }
  }, [gs.isOpen, handleSave])

  if (!isLoaded) return (
    <div className="wire-page-full">
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    </div>
  )

  if (gs.gamePhase === 'welcome') {
    return <WelcomeScreen baan={baan} />
  }

  if (gs.gamePhase === 'rules') {
    return <RulesVideoScreen baan={baan} timerEnd={gs.timerEnd} />
  }

  return (
    <div className="wire-page-full">
      <div className="bidding-result-toast-region" aria-live="polite" aria-atomic="true">
        {resultToast && (
          <div key={resultToast.key} className={clsx('bidding-result-toast', resultToast.leaving && 'is-leaving')}>
            <Sparkles size={18} />
            <span>ประกาศผลรอบที่ {resultToast.wave} แล้ว</span>
          </div>
        )}
      </div>
      <header className={clsx('wire-topbar', currentKing === baan && 'is-king')}>
        <div className="flex items-center gap-8">
          <HomeButton className="bg-white/10 border-white/20 text-white hover:text-white" />
          <div className="wire-title">ลงทุนเกาะรอบที่ {gs.currentWave}</div>
          <div className="wire-title flex items-center gap-3">
            {currentKing === baan && <Crown size={26} className="text-yellow-200 drop-shadow-sm" />}
            {HOUSE_NAMES[baan]}
          </div>
        </div>
        <div className="wire-time">
          <Timer endTime={gs.timerEnd} isOpen={gs.isOpen} onExpire={isEventMode ? undefined : () => { void handleSave('auto') }} compact />
        </div>
      </header>

      <main className="wire-scroll">
        <div className="wire-content">
          <div className={clsx('wire-pill-row', isBetMode && 'wire-pill-row-bet', isEventMode && 'wire-pill-row-event')}>
            <div className="wire-pill-status-group">
              <div className="wire-pill wire-pill-game">{isEventMode ? 'Event game' : isBetMode ? 'Bet game' : 'Bid game'}</div>
              {!isBetMode && !isEventMode && currentKing && (
                <div className="wire-pill wire-pill-king">King : {HOUSE_NAMES[currentKing]}</div>
              )}
              <div className={clsx('wire-pill-state badge', gs.isOpen?'badge-green':'badge-red')}>
                <span className={clsx('status-dot', gs.isOpen?'online':'offline')} />
                {gs.isOpen?'OPEN':'CLOSED'}
              </div>
            </div>
            {!isEventMode && (
              <div className="ml-auto">
                <GroupChat actor={baan} />
              </div>
            )}
            <button onClick={()=>{sessionStorage.removeItem('baan_login');sessionStorage.removeItem('baan_login_token');window.location.reload()}}
              className={clsx('btn btn-ghost', isEventMode && 'wire-edge-logout')}>
              <LogOut size={14} /> Logout
            </button>
          </div>

          <section className={clsx('wire-layout-bidding', isBetMode && 'wire-layout-bet-only', isEventMode && 'wire-layout-event-only')}>
            <div id="bidding-main-fullscreen" className="space-y-3 fullscreen-scope">
              <FullscreenButton targetId="bidding-main-fullscreen" />
              {(!gs.isOpen || (!isBetMode && isSelectDisasterPhase)) && (
                <div className="bidding-status-notice-row">
                  {!gs.isOpen && (
                    <span className="event-closed-notice">
                      รอ admin เปิดรอบ
                    </span>
                  )}
                  {!isBetMode && isSelectDisasterPhase && (
                  <span className={clsx('event-closed-notice disaster-phase-notice', canChooseKingDisaster ? 'is-king' : 'is-waiting')}>
                    {canChooseKingDisaster ? 'You are choosing disaster' : 'King is choosing disaster. Please wait.'}
                  </span>
                  )}
                </div>
              )}
              <div className="wire-panel wire-panel-soft">
                <div className="wire-panel-body">
                  {isEventMode ? (
                    <EventGamePanel baan={baan} wave={gs.currentWave} isOpen={gs.isOpen} showSolution={gs.showEventSolution === true} />
                  ) : isBetMode ? (
                    <div className="mx-auto grid max-w-xl gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-label mb-2 block">House to bet on</label>
                        <select value={betTarget} onChange={e=>{setBetTarget(e.target.value); setSaveMessage(''); setIsSaved(false)}}
                          disabled={!gs.isOpen || isSyncing}
                          className="input-base">
                          <option value="">Choose house</option>
                          {Array.from({length:12},(_,i)=>i+1).map(b=><option key={b} value={b}>{HOUSE_NAMES[b]}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-label mb-2 block">Bet amount</label>
                        <input type="text" inputMode="numeric" pattern="[0-9]*" value={betAmount} disabled={!gs.isOpen || isSyncing}
                          onChange={e=>{
                            setBetAmount(sanitizeMoneyInput(e.target.value))
                            setSaveMessage('')
                            setIsSaved(false)
                          }}
                          onBlur={normalizeBetAmount}
                          className="input-base font-mono" placeholder="0" />
                        {betAmount && !isBetAmountValid && (
                          <div className="mt-1 text-xs font-semibold text-red-600">
                            Amount must be {minBetAmount.toLocaleString()} - {balance.toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div className="sm:col-span-2 grid grid-cols-2 gap-3">
                        <div className="colorful-box colorful-box-blue rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                          <div className="text-label">Balance</div>
                          <div className="font-mono text-xl font-bold text-slate-900">{betBalance.toLocaleString()}</div>
                        </div>
                        <div className="colorful-box colorful-box-gold rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                          <div className="text-label">After Bet</div>
                          <div className={clsx('font-mono text-xl font-bold', betAfterBalance < 0 ? 'text-red-600' : 'text-slate-900')}>
                            {betAfterBalance.toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => { void handleSave('manual') }} disabled={isBetSubmitDisabled}
                        className={clsx(
                          'cart-save-button btn sm:col-span-2',
                          isBetSubmitSaved
                            ? 'is-saved'
                            : isBetSubmitDisabled
                              ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500 border border-transparent'
                              : 'btn-primary',
                        )}>
                        {isSyncing ? (syncReason === 'auto' ? 'Autosaving...' : 'Sending to admin...')
                          : isBetSubmitSaved ? (
                            <span className="flex items-center justify-center gap-2">
                              <CheckCircle2 size={16} />
                              Saved
                            </span>
                          )
                          : `${betSubmitVerb} bet`}
                      </button>
                      {saveMessage && (
                        <div className="sm:col-span-2 px-2 py-1 text-center text-xs font-semibold text-emerald-700">
                          {saveMessage}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                    <GameMap ownership={visibleOwnership} selected={selectedAreas}
                      disasterOwnership={visibleDisasterOwnership}
                      eradicatedOwnership={visibleEradicatedOwnership}
                      onSelect={handleSelect} filterDisaster={filterDis}
                      readOnly={!canEditBid}
                      kingDisaster={mapKingDisaster}
                      kingDisasterTone={isSelectDisasterPhase && canChooseKingDisaster ? 'selection' : 'result'}
                      currentKing={mapCurrentKing}
                      kingOwner={mapKingOwner}
                      compact />
                    </>
                  )}
                </div>
              </div>

              {!isBetMode && !isEventMode && <div className="flex flex-wrap items-center gap-1.5">
                <span className="wire-toolbar-panel text-sm">Filter</span>
                {DISASTER_IDS.map((id)=>(
                  <button key={id} onClick={()=>setFilterDis(filterDis===id?null:id)}
                    className={clsx('btn disaster-filter', filterDis===id ? 'active' : '')}>
                    {id}
                  </button>
                ))}
                {filterDis && <button onClick={()=>setFilterDis(null)} className="btn btn-ghost">Clear</button>}
              </div>}
            </div>

            {!isBetMode && !isEventMode && (
              <aside className="wire-panel wire-side-panel">
                <BiddingCart baan={baan} balance={effectiveBalance} displayBalance={cartDisplayBalance} items={cart} isKing={canChooseKingDisaster}
                  kingDisaster={kingDis}
                  onUpdate={handleCartUpdate}
                  onKingDisaster={handleKingDisasterUpdate}
                  onSubmit={() => { void handleSave('manual') }} isSaved={isSaved} savedAt={savedAt} isOpen={gs.isOpen}
                  isSyncing={isSyncing}
                  syncLabel={syncReason === 'auto' ? 'Autosaving...' : 'Sending to admin...'}
                  bidOpen={canEditBid}
                  disasterOpen={canSelectKingDisaster}
                  isDisasterPhase={isSelectDisasterPhase} />
              </aside>
            )}
          </section>
          {!isBetMode && !isEventMode && <section ref={historySectionRef} id="history-panel" className="wire-history wire-panel">
            <div className="wire-history-body">
              <FinanceHistory
                initialBaan={baan}
                lockBaan
                showFilters={false}
                showResults={gs.showResults === true}
                enableBetReturnRanking
                highlightedRevealWave={highlightedResultWave?.wave ?? null}
                isRevealHighlightLeaving={highlightedResultWave?.leaving === true}
              />
            </div>
          </section>}
        </div>
      </main>
    </div>
  )

}

/* Page root */
export default function BiddingPage() {
  const [baan,     setBaan]     = useState<number|null>(null)
  const [checking, setChecking] = useState(true)
  useEffect(() => startCloudSync(1500), [])
  useEffect(()=>{
    let cancelled = false
    const t = setTimeout(async () => {
      const s=sessionStorage.getItem('baan_login')
      const storedBaan = s ? parseInt(s) : NaN
      if(storedBaan >= 1 && storedBaan <= 12) {
        const token = sessionStorage.getItem('baan_login_token') || ''
        const result = token
          ? await verifyPasswordSession({ kind: 'baan', baan: storedBaan, token }).catch(() => ({ ok: false }))
          : { ok: false }
        if (!cancelled && result.ok) {
          setBaan(storedBaan)
        } else {
          sessionStorage.removeItem('baan_login')
          sessionStorage.removeItem('baan_login_token')
        }
      }
      if(!cancelled) setChecking(false)
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  },[])
  if (checking) return (
    <div className="min-h-screen app-shell flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-cyan-300 border-t-transparent rounded-full animate-spin shadow-[0_0_26px_rgba(34,211,238,0.55)]" />
    </div>
  )
  return baan ? <BiddingGame baan={baan} /> : <BaanLoginV2 onLogin={setBaan} />
}
