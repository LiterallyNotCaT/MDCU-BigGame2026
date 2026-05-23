'use client'
import { memo, useEffect, useState } from 'react'
import clsx from 'clsx'
import { X, Minus, Plus, ChevronRight } from 'lucide-react'
import { HOUSE_COLORS } from '@/lib/constants'

interface CartItem { area: string; amount: number }

interface BiddingCartProps {
  baan:          number
  balance:       number
  items:         CartItem[]
  isKing:        boolean
  kingDisaster:  number | null
  onUpdate:      (items: CartItem[]) => void
  onKingDisaster:(d: number | null) => void
  onSubmit:      () => void
  isSaved:       boolean
  savedAt?:      string
  isOpen:        boolean
  isSyncing?:     boolean
  bidOpen?:      boolean
  disasterOpen?: boolean
  isDisasterPhase?: boolean
}

const PRESETS = [500, 1000, 5000]
const DISASTER_IDS = Array.from({ length: 9 }, (_, i) => i + 1)

function sanitizeMoneyInput(value: string) {
  return value.replace(/[^\d]/g, '')
}

function BiddingCart({
  baan, balance, items, isKing, kingDisaster,
  onUpdate, onKingDisaster, onSubmit, isSaved, savedAt, isOpen,
  isSyncing = false, bidOpen = isOpen, disasterOpen = isOpen && isKing, isDisasterPhase = false,
}: BiddingCartProps) {
  const color      = HOUSE_COLORS[baan]
  const maxAmountForArea = (area: string) => {
    const otherTotal = items.reduce((sum, item) => item.area === area ? sum : sum + item.amount, 0)
    return Math.max(0, balance - otherTotal)
  }
  const isAmountInvalid = (item: CartItem) => {
    const max = maxAmountForArea(item.area)
    return !Number.isFinite(item.amount) || item.amount < 100 || item.amount > max
  }
  const totalBet   = items.reduce((s,i)=>s+i.amount, 0)
  const remaining  = balance - totalBet
  const overBudget = remaining < 0
  const hasInvalidAmount = items.some(isAmountInvalid)
  const hasKingBid = items.some(i=>i.area === 'KING')
  const hasDisasterSummary = isDisasterPhase && kingDisaster != null
  const usagePct   = balance > 0 ? Math.min(1, totalBet / balance) : 0
  const amountControlsOpen = bidOpen && !isSyncing
  const disasterControlsOpen = disasterOpen && !isSyncing
  const submitEnabled = !isSyncing && (isDisasterPhase
    ? disasterOpen && kingDisaster != null
    : bidOpen && items.length > 0 && !overBudget && !hasInvalidAmount)
  const [draftAmounts, setDraftAmounts] = useState<Record<string, string>>({})

  useEffect(() => {
    setDraftAmounts(prev => Object.fromEntries(items.map(i => [i.area, prev[i.area] ?? String(i.amount)])))
  }, [items])

  const updateAmount = (area: string, raw: number) => {
    const max = maxAmountForArea(area)
    const val = max >= 100 && Number.isFinite(raw)
      ? Math.min(Math.max(100, raw), max)
      : 0
    onUpdate(items.map(i => i.area===area ? {...i, amount:val} : i))
    setDraftAmounts(prevDraft => ({ ...prevDraft, [area]: String(val) }))
  }
  const setRawAmount = (area: string, raw: string) => {
    const nextRaw = sanitizeMoneyInput(raw)
    const nextAmount = nextRaw === '' ? 0 : Number(nextRaw)
    setDraftAmounts(prevDraft => ({ ...prevDraft, [area]: nextRaw }))
    onUpdate(items.map(i => i.area===area ? {...i, amount:Number.isFinite(nextAmount) ? nextAmount : 0} : i))
  }
  const clampAmount = (area: string) => {
    const draft = draftAmounts[area] ?? ''
    if (draft.trim() === '') {
      onUpdate(items.map(i => i.area===area ? {...i, amount:0} : i))
      return
    }
    const val = Number(draft)
    if (!Number.isFinite(val)) {
      setDraftAmounts(prevDraft => ({ ...prevDraft, [area]: '' }))
      onUpdate(items.map(i => i.area===area ? {...i, amount:0} : i))
      return
    }
    updateAmount(area, val)
  }
  const remove = (area: string)  => onUpdate(items.filter(i=>i.area!==area))
  const step   = (area: string, d: number) => {
    const cur = items.find(i=>i.area===area)?.amount||0
    updateAmount(area, cur+d)
  }

  return (
    <div className="flex flex-col h-full gap-4 p-4 md:p-5">

      <div className="bidding-cart-header flex-shrink-0">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-black leading-none text-slate-950">
            {isDisasterPhase ? 'Disaster' : 'พื้นที่ที่เลือก'}
          </h2>
          <span className={clsx('badge', isOpen ? (isDisasterPhase ? 'badge-gold' : 'badge-green') : 'badge-red')}>
            {isOpen ? (isDisasterPhase ? 'King turn' : 'Live') : 'Closed'}
          </span>
        </div>
      </div>

      {/* ── Balance summary ────────── */}
      <div className="cart-card colorful-box colorful-box-balance rounded-3xl p-4">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <span className="text-label">Balance คงเหลือ</span>
          <span className={clsx('font-mono font-bold text-2xl leading-none',
            overBudget ? 'text-red-300' : 'text-green-300')}
            style={!overBudget ? { textShadow: '0 0 12px rgba(16,185,129,0.5)' } : undefined}>
            {remaining.toLocaleString()}
          </span>
        </div>

        {/* Usage bar */}
        <div className="h-2 rounded-full bg-slate-950/80 overflow-hidden mb-2 border border-white/5">
          <div className="progress-glow h-full rounded-full transition-all duration-500"
            style={{
              width: `${usagePct * 100}%`,
              color: overBudget ? '#ef4444' : color,
              background: overBudget
                ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                : `linear-gradient(90deg, ${color}dd, #22d3eeaa, #f59e0baa)`,
            }} />
        </div>

        {totalBet > 0 && (
          <div className="flex justify-between text-2xs text-slate-600">
            <span>ลงทุนแล้ว</span>
            <span className="text-orange-400 font-mono">−{totalBet.toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* ── King disaster picker ───── */}
      {isKing && (
        <div className="king-bid-card colorful-box colorful-box-gold cart-card rounded-3xl p-3 text-sm text-yellow-900">
          <div className="font-display font-bold">King control</div>
          <div className="mt-1 text-xs">
            {isDisasterPhase ? 'Select the disaster ID for this wave.' : 'KING bid is separate and can be added from the map.'}
          </div>
          {!isDisasterPhase && !hasKingBid && (
            <button type="button" onClick={()=>onUpdate([...items, { area: 'KING', amount: balance >= 100 ? 100 : 0 }])}
              disabled={!amountControlsOpen || balance < 100}
              className="btn btn-ghost mt-2 w-full">
              Add KING bid
            </button>
          )}
          {isDisasterPhase ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {DISASTER_IDS.map(n => {
              const active = kingDisaster === n
              return (
                <button key={n} onClick={()=>onKingDisaster(active?null:n)} disabled={!disasterControlsOpen}
                  className={clsx(
                    'min-h-14 rounded-2xl border-2 px-3 py-3 text-center font-mono text-lg font-black transition-all active:scale-95',
                    active
                      ? 'border-yellow-300 bg-fuchsia-700 text-white shadow-[0_12px_28px_rgba(190,24,93,0.42)] ring-4 ring-fuchsia-200'
                      : 'border-slate-300 bg-white text-slate-900 hover:border-fuchsia-500 hover:bg-fuchsia-50 disabled:opacity-40'
                  )}>
                  D{n}
                </button>
              )
            })}
          </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs font-semibold text-yellow-800">
              Disaster selection opens after the 10 min bid phase.
            </div>
          )}
        </div>
      )}
      {/* Area list ──────────────── */}
      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-label">รายการ <span className="text-blue-500">({items.length})</span></span>
          {items.length > 0 && (
            <button onClick={()=>onUpdate([])}
              disabled={!amountControlsOpen}
              className={clsx(
                'rounded-lg border px-3 py-1.5 text-2xs font-display font-semibold transition-colors',
                amountControlsOpen
                  ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700'
                  : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed',
              )}>
              ล้างทั้งหมด
            </button>
          )}
        </div>

        {/* Scroll area */}
        <div className="bidding-cart-scroll flex-1 overflow-y-auto space-y-2 pr-2">
          {hasDisasterSummary && (
            <div className="cart-card rounded-3xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm text-fuchsia-950">
              <div className="text-label text-fuchsia-700">Saved disaster</div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="font-display text-lg font-black">D{kingDisaster}</span>
                <span className="badge badge-gold">from sheet</span>
              </div>
            </div>
          )}

          {items.length === 0 && !hasDisasterSummary && (
            <div className="cart-card rounded-3xl flex flex-col items-center justify-center py-12 text-slate-600">
              <div className="text-3xl mb-3 opacity-60 animate-float">🗺️</div>
              <div className="text-sm text-center leading-relaxed">
                แตะพื้นที่บน Map<br />เพื่อเพิ่มการลงทุน
              </div>
            </div>
          )}

          {items.map(item => {
            const isKingItem = item.area === 'KING'
            const maxAmount = maxAmountForArea(item.area)

            return (
              <div key={item.area} className={clsx(
                'cart-card rounded-3xl p-3 space-y-2.5 toast-lift',
                isKingItem && 'king-bid-card colorful-box colorful-box-gold'
              )}>
                {/* Row 1: area name + disasters + remove */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display font-black text-base text-slate-950">{isKingItem ? 'KING' : item.area}</span>
                      {isKingItem && <span className="badge badge-gold" style={{ fontSize: '0.55rem' }}>KING</span>}
                    </div>
                  </div>
                  <button onClick={()=>remove(item.area)} disabled={!amountControlsOpen}
                    className="w-7 h-7 rounded-xl bg-red-500/10 text-red-500/60 hover:bg-red-500/20 hover:text-red-300
                      flex items-center justify-center transition-all disabled:opacity-30 flex-shrink-0">
                    <X size={11} />
                  </button>
                </div>

                {/* Row 2: amount stepper */}
                <div className="flex items-center gap-1.5">
                  <button onClick={()=>step(item.area,-100)} disabled={!amountControlsOpen||item.amount<=100}
                    className="w-8 h-8 rounded-xl glass-light action-pill flex items-center justify-center text-slate-400
                      hover:text-white hover:bg-white/8 transition-all disabled:opacity-25 active:scale-90">
                    <Minus size={12} />
                  </button>
                  <input type="text" inputMode="numeric" pattern="[0-9]*"
                    value={draftAmounts[item.area] ?? String(item.amount)} disabled={!amountControlsOpen}
                    onChange={e=>setRawAmount(item.area,e.target.value)}
                    onBlur={()=>clampAmount(item.area)}
                    className="flex-1 input-base text-center font-mono text-sm py-2 min-w-0" />
                  <button onClick={()=>step(item.area,100)} disabled={!amountControlsOpen||remaining<=0}
                    className="w-8 h-8 rounded-xl glass-light action-pill flex items-center justify-center text-slate-400
                      hover:text-white hover:bg-white/8 transition-all disabled:opacity-25 active:scale-90">
                    <Plus size={12} />
                  </button>
                </div>

                {/* Row 3: presets */}
                {amountControlsOpen && (
                  <div className="flex gap-1">
                    {PRESETS.map(p => (
                      <button key={p} onClick={()=>updateAmount(item.area,item.amount+p)}
                        disabled={!amountControlsOpen || item.amount + p > maxAmount}
                        className="flex-1 py-1.5 rounded-xl glass-light action-pill text-2xs font-display font-semibold
                          text-slate-600 hover:text-slate-300 hover:bg-white/6 transition-all disabled:opacity-20">
                        +{p}
                      </button>
                    ))}
                    <button onClick={()=>updateAmount(item.area,maxAmount)}
                      disabled={!amountControlsOpen || maxAmount < 100}
                      className="flex-1 py-1.5 rounded-xl action-pill text-2xs font-display font-semibold
                        text-cyan-700 hover:text-cyan-400 hover:bg-cyan-500/8 transition-all disabled:opacity-20">
                      MAX
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Footer ─────────────────── */}
      <div className="space-y-2.5 flex-shrink-0">
        {/* Save status */}
        <div className={clsx(
          'flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-display transition-all toast-lift',
          isSyncing
            ? 'bg-blue-500/10 text-blue-300 border border-blue-400/20'
            : isSaved
            ? 'bg-green-500/10 text-green-300 border border-green-400/20'
            : 'bg-yellow-500/10 text-yellow-300 border border-yellow-400/20'
        )}>
          <span className="text-base leading-none">{isSyncing ? '⏳' : isSaved ? '✓' : '⏳'}</span>
          <span className="flex-1 truncate text-2xs">
            {isSyncing
              ? 'Sending to admin...'
              : isSaved
                ? (savedAt ? `Saved · ${savedAt}` : 'Saved')
                : 'Unsaved — autosave ใน 5 วิ'}
          </span>
        </div>

        {/* Submit */}
        <button onClick={onSubmit}
          disabled={!submitEnabled}
          className={clsx(
            'btn w-full text-sm action-pill',
            submitEnabled
              ? 'btn-primary'
              : 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500 border border-transparent'
          )}
          style={submitEnabled ? {
            background: `linear-gradient(135deg, ${color}, ${color}aa)`,
            boxShadow: `0 0 20px ${color}30`,
          } : undefined}>
          {isSyncing ? 'Sending to admin...'
            : !isOpen ? '🔒 ปิดรับการลงทุน'
            : isDisasterPhase && !disasterOpen ? 'King is choosing disaster'
            : isDisasterPhase && kingDisaster == null ? 'Select disaster ID'
            : isDisasterPhase ? `Confirm disaster D${kingDisaster}`
            : overBudget ? '⚠ เงินไม่เพียงพอ'
            : hasInvalidAmount ? 'ขั้นต่ำ 100 ต่อพื้นที่'
            : items.length===0 ? 'เลือกพื้นที่ก่อน'
            : (
              <span className="flex items-center gap-2">
                ยืนยัน {items.length} พื้นที่ · {totalBet.toLocaleString()}
                <ChevronRight size={14} />
              </span>
            )}
        </button>
      </div>
    </div>
  )
}

export default memo(BiddingCart)
