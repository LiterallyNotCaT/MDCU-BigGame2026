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
import { Landmark, LogOut, Sparkles } from 'lucide-react'
import { HOUSE_NAMES, SHEET_ID, getWaveSheetQuery } from '@/lib/constants'
import {
  getGameState, saveSubmission, getSubmissionsForBaan,
  subscribeStore, getActiveDisasterForWave, setActiveDisaster, startCloudSync,
} from '@/lib/store'
import { fetchWaveInfo, fetchWaveInputs, writeToSheet, type WaveInputRow } from '@/lib/sheets'
import { getBaanPasswordFromSheet, passwordSessionToken } from '@/lib/passwords'

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
    const expectedPassword = await getBaanPasswordFromSheet(b, true).catch(error => {
      console.error(error)
      return ''
    })
    setCheckingPassword(false)
    if (!expectedPassword || pass !== expectedPassword) {
      setErr('รหัสไม่ถูกต้อง'); setShake(true)
      setTimeout(()=>setShake(false),500); return
    }
    sessionStorage.setItem('baan_login',String(b))
    sessionStorage.setItem('baan_login_token', await passwordSessionToken(`baan:${b}`, expectedPassword))
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
    const expectedPassword = await getBaanPasswordFromSheet(b, true).catch(error => {
      console.error(error)
      return ''
    })
    setCheckingPassword(false)
    if (!expectedPassword || pass !== expectedPassword) {
      setErr('รหัสผ่านไม่ถูกต้อง')
      setShake(true)
      setTimeout(() => setShake(false), 500)
      return
    }
    sessionStorage.setItem('baan_login', String(b))
    sessionStorage.setItem('baan_login_token', await passwordSessionToken(`baan:${b}`, expectedPassword))
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

function readBiddingDraft(key: string): BiddingDraft | null {
  if (typeof window === 'undefined') return null
  try {
    return JSON.parse(window.localStorage.getItem(key) || 'null') as BiddingDraft | null
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

function BiddingGame({ baan }: { baan:number }) {
  const [gs,        setGS]        = useState(getGameState)
  const [cart,      setCart]      = useState<CartItem[]>([])
  const [kingDis,   setKingDis]   = useState<number|null>(null)
  const [filterDis, setFilterDis] = useState<number|null>(null)
  const [balance,   setBalance]   = useState(0)
  const [isKing,    setIsKing]    = useState(false)
  const [currentKing, setCurrentKing] = useState<number | null>(null)
  const [isSaved,   setIsSaved]   = useState(true)
  const [savedAt,   setSavedAt]   = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [isSyncing, setIsSyncing] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const [betTarget, setBetTarget] = useState('')
  const [betAmount, setBetAmount] = useState('')
  const [sheetBetSpend, setSheetBetSpend] = useState(0)
  const [sheetInput, setSheetInput] = useState<WaveInputRow | null>(null)
  const [isLoaded] = useState(true)
  const [resultToast, setResultToast] = useState<{ wave: number; key: number; leaving?: boolean } | null>(null)
  const [highlightedResultWave, setHighlightedResultWave] = useState<{ wave: number; leaving?: boolean } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const saveInFlight = useRef(false)
  const hydratedSubmissionKey = useRef('')
  const historySectionRef = useRef<HTMLElement | null>(null)
  const previousResultState = useRef<{ wave: number; showResults: boolean } | null>(null)
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
  const isSelectDisasterPhase = !isBetMode && gs.gamePhase === 'select-disaster'
  const draftMode = isBetMode ? 'bet' : isSelectDisasterPhase ? 'select-disaster' : 'bid'
  const draftKey = `biggame_bidding_draft:${baan}:${gs.currentWave}:${draftMode}`
  const currentSubmission = getSubmissionsForBaan(baan).find(s => s.wave === gs.currentWave)
  const priorBetSpend = !isBetMode ? sheetBetSpend || currentSubmission?.betAmount || 0 : 0
  const effectiveBalance = Math.max(0, balance - priorBetSpend)
  const canChooseKingDisaster = isKing || currentKing === baan
  const canEditBid = gs.isOpen && !isBetMode && !isSelectDisasterPhase
  const canSelectKingDisaster = gs.isOpen && isSelectDisasterPhase && canChooseKingDisaster
  const canSeeCurrentOwnership = gs.showResults === true || canSelectKingDisaster
  const sheetOwnership = useWaveOwnership(gs.currentWave)
  const visibleOwnership = canSeeCurrentOwnership ? sheetOwnership.ownership : {}
  const activeSheetDisaster = getActiveDisasterForWave(gs.currentWave)
  const mapKingDisaster = isSelectDisasterPhase && canChooseKingDisaster
    ? kingDis
    : gs.showResults === true
      ? activeSheetDisaster
      : null

  useEffect(() => {
    const hydrateKey = `${gs.currentWave}:${baan}:${draftMode}`
    if (hydratedSubmissionKey.current === hydrateKey) return
    hydratedSubmissionKey.current = hydrateKey
    setDraftReady(false)

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

  const applySheetInput = useCallback((row: WaveInputRow | null, info: { king: number | null; kingDisaster: number | null }) => {
    setSheetInput(row)
    setCurrentKing(info.king)
    setIsKing(info.king === baan)
    setActiveDisaster(gs.currentWave, info.kingDisaster)
    setSheetBetSpend(row?.betAmount || 0)
    if (row) setBalance(row.balance || 0)

    const state = getGameState()
    const hasLocalDraft = readBiddingDraft(draftKey) !== null
    const mayHydrateFromSheet = !hasLocalDraft && !saveInFlight.current && isSaved && !isSyncing

    if (state.gamePhase === 'select-disaster') {
      if (!(state.isOpen && info.king === baan && !isSaved)) {
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

    if (row?.hasBidInput) {
      const sheetCart = sheetInputToCart(row)
      setCart(sheetCart)
      setSavedAt('Sheet')
      setSaveMessage('')
    }
  }, [baan, draftKey, gs.currentWave, isBetMode, isSaved, isSyncing])

  const fetchSheetSnapshot = useCallback(async () => {
    try {
      const wave = getGameState().currentWave
      const data = await fetchWaveInputs(wave)
      if (wave !== getGameState().currentWave) return
      const row = data.rows.find(item => item.baan === baan) ?? null
      applySheetInput(row, { king: data.king, kingDisaster: data.kingDisaster })
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
      setCurrentKing(info.king)
      setIsKing(info.king === baan)
      if (!(state.isOpen && state.gamePhase === 'select-disaster' && info.king === baan && !isSaved)) {
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
  const handleSave = useCallback(async ()=>{
    if(!gs.isOpen) return
    if(saveInFlight.current) return
    const hasInvalidBidAmount = cart.some(i => !Number.isFinite(i.amount) || i.amount < 100)
    if(isBetMode && !isBetAmountValid) return
    if(isSelectDisasterPhase && (!canSelectKingDisaster || !kingDis)) return
    if(!isBetMode && !isSelectDisasterPhase && (hasInvalidBidAmount || !Number.isFinite(totalBet) || totalBet <= 0 || totalBet > effectiveBalance)) return

    const timestamp = new Date().toLocaleTimeString('th-TH')
    saveInFlight.current = true
    setIsSyncing(true)
    setSaveMessage('Sending to admin...')

    // 1. Save locally (instant, always works)
    saveSubmission({
      baan,
      wave: gs.currentWave,
      bets: isBetMode || isSelectDisasterPhase ? currentSubmission?.bets ?? [] : cart,
      isKing: canChooseKingDisaster,
      kingDisaster: canSelectKingDisaster ? kingDis ?? undefined : currentSubmission?.kingDisaster,
      betTarget: isBetMode && betTarget ? parseInt(betTarget) : currentSubmission?.betTarget,
      betAmount: isBetMode ? betSpend : currentSubmission?.betAmount,
      timestamp,
      balance: isBetMode ? balance - betSpend : currentSubmission?.balance ?? effectiveBalance,
    })
    if (isSelectDisasterPhase) setActiveDisaster(gs.currentWave, kingDis)

    // 2. Write to Google Sheet via GAS (async, non-blocking)
    // Map cart items to up to 3 islands (areas)
    const islands = islandCart.slice(0,3).map(i=>({ name: i.area, amount: i.amount }))
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
      betTarget: isBetMode && betTarget ? parseInt(betTarget) : undefined,
      betAmount: isBetMode ? betSpend : undefined,
      kingAmount: !isBetMode && kingBid ? kingBidAmount : undefined,
      kingDisaster: undefined,
      islands: isBetMode ? undefined : islands,
    }
    writeToSheet(payload).then(res => {
      saveInFlight.current = false
      setIsSyncing(false)
      setSaveMessage(res.ok ? 'Sent to admin' : `Admin sync error: ${res.message ?? 'not sent'}`)
      if (!res.ok) {
        setIsSaved(false)
        console.warn('Sheet write failed:', res.message)
        return
      }
      setIsSaved(true)
      setSavedAt(timestamp)
      clearBiddingDraft(draftKey)
      setTimeout(() => {
        void fetchBalance()
        void fetchSheetSnapshot()
      }, 300)
    }).catch(e => {
      saveInFlight.current = false
      setIsSyncing(false)
      setSaveMessage('Admin sync error')
      setIsSaved(false)
      console.error(e)
    })
  },[baan,cart,gs.currentWave,gs.isOpen,canChooseKingDisaster,canSelectKingDisaster,kingDis,balance,totalBet,isBetMode,isSelectDisasterPhase,betTarget,betSpend,isBetAmountValid,fetchBalance,fetchSheetSnapshot,effectiveBalance,currentSubmission,islandCart,kingBid,kingBidAmount,draftKey])

  /* autosave */
  useEffect(()=>{
    clearTimeout(saveTimer.current)
    if(!gs.isOpen) {
      return
    }
    if(isBetMode) return
    if(isSaved || isSyncing) return
    if(isSelectDisasterPhase && !canSelectKingDisaster) return
    if(!isSelectDisasterPhase && cart.length===0) return
    if(isSelectDisasterPhase && !kingDis) return
    saveTimer.current=setTimeout(handleSave,5000)
    return()=>{ clearTimeout(saveTimer.current) }
  },[cart,kingDis,gs.isOpen,isBetMode,isSelectDisasterPhase,canSelectKingDisaster,isSaved,isSyncing,handleSave])

  const normalizeBetAmount = () => {
    if (betAmount.trim() === '') return
    const raw = Number(betAmount)
    if (!Number.isFinite(raw)) {
      setBetAmount('')
      return
    }
    setBetAmount(String(Math.min(Math.max(minBetAmount, raw), balance)))
  }

  if (!isLoaded) return (
    <div className="wire-page-full">
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    </div>
  )

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
      <header className="wire-topbar">
        <div className="flex items-center gap-8">
          <HomeButton className="bg-white/10 border-white/20 text-white hover:text-white" />
          <div className="wire-title">ลงทุนเกาะรอบที่ {gs.currentWave}</div>
          <div className="wire-title flex items-center gap-3">
            {canChooseKingDisaster && <Sparkles size={24} className="text-yellow-200" />}
            {HOUSE_NAMES[baan]}
          </div>
        </div>
        <div className="wire-time">
          <Timer endTime={gs.timerEnd} isOpen={gs.isOpen} onExpire={handleSave} compact />
        </div>
      </header>

      <main className="wire-scroll">
        <div className="wire-content">
          <div className="wire-pill-row">
            <div className="wire-pill">{isBetMode ? 'Bet game' : 'Bid game'}</div>
            <div className="wire-pill">Balance : {effectiveBalance.toLocaleString()}</div>
            {!isBetMode && <div className="wire-pill">King : {currentKing ? HOUSE_NAMES[currentKing] : '-'}</div>}
            <div className={clsx('badge', gs.isOpen?'badge-green':'badge-red')}>
              <span className={clsx('status-dot', gs.isOpen?'online':'offline')} />
              {gs.isOpen?'OPEN':'CLOSED'}
            </div>
            {!isBetMode && (
              <div className="ml-auto">
                <GroupChat actor={baan} />
              </div>
            )}
            <button onClick={()=>{sessionStorage.removeItem('baan_login');sessionStorage.removeItem('baan_login_token');window.location.reload()}}
              className={clsx('btn btn-ghost', isBetMode && 'ml-auto')}>
              <LogOut size={14} /> Logout
            </button>
          </div>

          <section className={clsx('wire-layout-bidding', isBetMode && 'wire-layout-bet-only')}>
            <div id="bidding-main-fullscreen" className="space-y-3 fullscreen-scope">
              <FullscreenButton targetId="bidding-main-fullscreen" />
              {!isBetMode && <div className="flex flex-wrap gap-2">
                <span className={clsx('badge', !isBetMode ? 'badge-blue' : 'badge-green')}>
                  {isSelectDisasterPhase ? 'Select disaster phase' : 'Bid mode: choose up to 3 islands'}
                </span>
                {isSelectDisasterPhase && (
                  <span className={clsx('badge', canChooseKingDisaster ? 'badge-gold' : 'badge-red')}>
                    {canChooseKingDisaster ? 'You are choosing disaster' : 'King is choosing disaster'}
                  </span>
                )}
              </div>}
              <div className="wire-panel wire-panel-soft">
                <div className="wire-panel-body">
                  {!gs.isOpen && (
                    <div className="mb-4 rounded bg-white/80 px-4 py-3 text-sm text-slate-700">
                      ยังไม่เปิดรับการลงทุน - รอ Admin เปิดรอบ
                    </div>
                  )}
                  {isBetMode ? (
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
                          <div className="font-mono text-xl font-bold text-slate-900">{balance.toLocaleString()}</div>
                        </div>
                        <div className="colorful-box colorful-box-gold rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                          <div className="text-label">After Bet</div>
                          <div className={clsx('font-mono text-xl font-bold', balance - betSpend < 0 ? 'text-red-600' : 'text-slate-900')}>
                            {(balance - betSpend).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <button onClick={handleSave} disabled={!gs.isOpen || isSyncing || !betTarget || !isBetAmountValid}
                        className="btn btn-primary sm:col-span-2">
                        {isSyncing ? 'Sending to admin...' : `Submit bet ${betSpend ? `· ${betSpend.toLocaleString()}` : ''}`}
                      </button>
                      {saveMessage && (
                        <div className="sm:col-span-2 px-2 py-1 text-center text-xs font-semibold text-emerald-700">
                          {saveMessage}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {isSelectDisasterPhase && !canChooseKingDisaster && (
                        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                          King is choosing disaster. Please wait.
                        </div>
                      )}
                      {!canSeeCurrentOwnership && (
                        <div className="mb-4 rounded-lg border border-slate-200 bg-white/85 px-4 py-3 text-sm font-semibold text-slate-700">
                          Ownerships are hidden until admin shows results.
                        </div>
                      )}
                    <GameMap ownership={visibleOwnership} selected={selectedAreas}
                      onSelect={handleSelect} filterDisaster={filterDis}
                      readOnly={!canEditBid}
                      kingDisaster={mapKingDisaster}
                      kingDisasterTone={isSelectDisasterPhase && canChooseKingDisaster ? 'selection' : 'result'}
                      currentKing={canSeeCurrentOwnership ? currentKing : null}
                      compact />
                    </>
                  )}
                </div>
              </div>

              {!isBetMode && <div className="flex flex-wrap items-center gap-1.5">
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

            {!isBetMode && (
              <aside className="wire-panel wire-side-panel">
                <div className="wire-section-title">พื้นที่ที่เลือก</div>
                <BiddingCart baan={baan} balance={effectiveBalance} items={cart} isKing={canChooseKingDisaster}
                  kingDisaster={kingDis}
                  onUpdate={handleCartUpdate}
                  onKingDisaster={handleKingDisasterUpdate}
                  onSubmit={handleSave} isSaved={isSaved} savedAt={savedAt} isOpen={gs.isOpen}
                  isSyncing={isSyncing}
                  bidOpen={canEditBid}
                  disasterOpen={canSelectKingDisaster}
                  isDisasterPhase={isSelectDisasterPhase} />
                <div className="wire-section-title bg-blue-500 text-white">
                  {isSyncing
                    ? 'Sending to admin...'
                    : saveMessage === 'Sent to admin'
                      ? 'Sent to admin'
                      : isSaved
                        ? (savedAt ? `Saved at ${savedAt}` : 'Saved')
                        : 'Unsaved / autosave in 5s'}
                </div>
                {saveMessage && <div className="px-4 pb-3 text-center text-xs font-semibold text-emerald-700">{saveMessage}</div>}
              </aside>
            )}
          </section>
          {!isBetMode && <section ref={historySectionRef} id="history-panel" className="wire-history wire-panel">
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
  useEffect(() => startCloudSync(800), [])
  useEffect(()=>{
    let cancelled = false
    const t = setTimeout(async () => {
      const s=sessionStorage.getItem('baan_login')
      const storedBaan = s ? parseInt(s) : NaN
      if(storedBaan >= 1 && storedBaan <= 12) {
        const password = await getBaanPasswordFromSheet(storedBaan).catch(() => '')
        const token = password ? await passwordSessionToken(`baan:${storedBaan}`, password) : ''
        if (!cancelled && token && sessionStorage.getItem('baan_login_token') === token) {
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
