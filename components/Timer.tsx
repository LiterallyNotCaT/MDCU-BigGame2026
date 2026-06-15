'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Timer as TimerIcon } from 'lucide-react'
import clsx from 'clsx'
import { getGameState, subscribeStore } from '@/lib/store'

interface TimerProps {
  endTime:   string | null
  isOpen:    boolean
  onExpire?: () => void
  compact?:  boolean
}

export default function Timer({ endTime, isOpen, onExpire, compact }: TimerProps) {
  const [remaining, setRemaining] = useState(0)
  const [expired,   setExpired]   = useState(false)
  const [phase,     setPhase]     = useState<'welcome' | 'rules' | 'play' | 'select-disaster'>('welcome')
  const totalRef    = useRef(0)
  const expiredRef  = useRef(false)
  const onExpireRef = useRef(onExpire)

  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    const syncPhase = () => {
      const nextPhase = getGameState().gamePhase || 'welcome'
      setPhase(current => current === nextPhase ? current : nextPhase)
    }
    syncPhase()
    const unsub = subscribeStore(() => {
      syncPhase()
    })
    return unsub
  }, [])

  const tick = useCallback(() => {
    if (!endTime || !isOpen) {
      setRemaining(current => current === 0 ? current : 0)
      return
    }
    const diff = new Date(endTime).getTime() - Date.now()
    if (diff <= 0) {
      setRemaining(current => current === 0 ? current : 0)
      if (!expiredRef.current) { expiredRef.current = true; setExpired(true); onExpireRef.current?.() }
    } else {
      setRemaining(diff); setExpired(current => current ? false : current); expiredRef.current = false
    }
  }, [endTime, isOpen])

  useEffect(() => {
    if (endTime && isOpen) {
      const diff = new Date(endTime).getTime() - Date.now()
      if (diff > 0 && totalRef.current === 0) totalRef.current = diff
    } else {
      totalRef.current = 0
    }
    expiredRef.current = false; setExpired(current => current ? false : current)
    tick()
  }, [endTime, isOpen]) // eslint-disable-line

  useEffect(() => { tick(); const t = setInterval(tick, 500); return () => clearInterval(t) }, [tick])

  const mins    = Math.floor(remaining / 60000)
  const secs    = Math.floor((remaining % 60000) / 1000)
  const display = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
  const pct     = totalRef.current > 0 ? Math.min(1, remaining / totalRef.current) : 0
  const urgent  = isOpen && remaining > 0 && remaining <= 30000
  const active  = isOpen && !expired && remaining > 0

  const colorClass = !isOpen ? 'text-slate-600'
    : expired       ? 'text-red-400'
    : urgent        ? 'text-red-400'
    :                 'text-cyan-400'

  if (compact) {
    let standbyText = 'STANDBY'
    if (phase === 'welcome') standbyText = 'WELCOME'
    else if (phase === 'rules') standbyText = 'RULES END'

    return (
      <div 
        className={clsx(
          'timer-capsule flex items-center gap-2 font-mono font-bold tracking-widest transition-all duration-300',
          !isOpen && 'is-standby',
          isOpen && expired && 'is-expired',
          isOpen && !expired && urgent && 'is-urgent',
          isOpen && !expired && !urgent && 'is-active'
        )}
      >
        <span className="timer-status-dot w-2 h-2 rounded-full shrink-0" />
        <span className="timer-text">
          {!isOpen ? standbyText : expired ? 'TIME UP' : (phase === 'rules' ? `RULES ${display}` : display)}
        </span>
      </div>
    )
  }

  return (
    <div className={clsx(
      'glass-light rounded-xl px-4 py-2.5 flex items-center gap-3 transition-all',
      urgent && 'border-red-500/30'
    )}
      style={urgent ? { boxShadow: '0 0 16px rgba(239,68,68,0.2)' } : undefined}>

      {/* Icon */}
      <TimerIcon size={16} className={colorClass} />

      {/* Time display */}
      <div>
        <div className="text-label mb-0.5">{phase === 'rules' ? 'Rules Video' : 'Timer'}</div>
        <div className={clsx('font-mono text-lg font-bold tracking-wider', colorClass, urgent && 'timer-urgent')}
        style={active ? { textShadow: urgent ? '0 0 14px rgba(239,68,68,0.78)' : '0 0 14px rgba(34,211,238,0.6)' } : undefined}>
          {!isOpen ? '--:--' : expired ? 'END' : display}
        </div>
      </div>

      {/* Progress bar */}
      {active && (
        <div className="w-1 h-10 rounded-full bg-slate-800 overflow-hidden ml-1">
          <div className="w-full rounded-full transition-all duration-500"
            style={{
              height: `${pct * 100}%`,
              marginTop: `${(1 - pct) * 100}%`,
              background: urgent
                ? 'linear-gradient(to bottom, #fb923c, #ef4444)'
                : 'linear-gradient(to bottom, #22d3ee, #3b82f6)',
            }} />
        </div>
      )}
    </div>
  )
}
