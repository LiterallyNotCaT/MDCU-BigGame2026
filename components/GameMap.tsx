'use client'
import { memo } from 'react'
import clsx from 'clsx'
import { HOUSE_COLORS, HOUSE_TEXT_COLORS, DISASTER_AREAS } from '@/lib/constants'

export interface MapProps {
  ownership:       Record<string, number>
  disasterOwnership?: Record<string, number>
  eradicatedOwnership?: Record<string, number>
  selected?:       string[]
  onSelect?:       (area: string) => void
  filterDisaster?: number | null
  readOnly?:       boolean
  kingDisaster?:   number | null
  kingDisasterTone?: 'selection' | 'result'
  currentKing?:    number | null
  kingOwner?:      number | null
  compact?:        boolean
}

const GROUPS = [
  { id:'A', areas:['A1','A2','A3','A4','A5'],               income:'180%', dis:'50%' },
  { id:'B', areas:['B1','B2','B3','B4','B5','B6'],          income:'160%', dis:'50%' },
  { id:'C', areas:['C1','C2','C3','C4','C5','C6','C7','C8','C9'], income:'140%', dis:'50%' },
  { id:'D', areas:['KING'],                                 income:'King', dis:'choose D' },
]

export function getAreaDisasters(area: string): number[] {
  if (area === 'KING') return []
  const out: number[] = []
  for (const [num, data] of Object.entries(DISASTER_AREAS)) {
    const n = parseInt(num)
    const g = area[0] as 'A'|'B'|'C'
    const i = parseInt(area.slice(1))
    if (data[g]?.includes(i)) out.push(n)
  }
  return out
}

export function getAffected(dn: number | null): Set<string> {
  if (!dn || !DISASTER_AREAS[dn]) return new Set()
  const s = new Set<string>()
  const d = DISASTER_AREAS[dn]
  d.A.forEach(n => s.add(`A${n}`))
  d.B.forEach(n => s.add(`B${n}`))
  d.C.forEach(n => s.add(`C${n}`))
  return s
}

function GameMap({
  ownership, disasterOwnership = {}, eradicatedOwnership = {}, selected=[], onSelect, filterDisaster, readOnly, kingDisaster, kingDisasterTone = 'result', currentKing = null, kingOwner = null, compact,
}: MapProps) {
  const filterSet = filterDisaster != null ? getAffected(filterDisaster) : null
  const isFilterMode = filterSet != null
  const kingSet   = kingDisaster   != null ? getAffected(kingDisaster)   : null
  const hasSheetDisasterOwnership = Object.keys(disasterOwnership).length > 0

  const tileClass = compact ? 'map-tile-deluxe-compact' : 'map-tile-deluxe-regular'
  const gridTileSize = compact
    ? 'clamp(44px, 5.2vw, 76px)'
    : 'clamp(56px, 7vw, 116px)'

  return (
    <div className={clsx('game-map select-none', compact ? 'game-map-compact' : 'game-map-regular')}>
      {kingDisaster != null && currentKing != null && !filterDisaster && (
        <div className="map-king-disaster-notice">
          <span>King บ้าน {currentKing} เลือก disaster {kingDisaster}</span>
        </div>
      )}

      {/* Map groups */}
      <div className="map-infographic map-unified-board">
      {GROUPS.map(group => {
        return (
          <div key={group.id} className="map-group-card">
            {/* Group label */}
            <div className="map-group-header">
              <div className="map-group-copy min-w-0">
                <span className="font-display font-semibold text-sm text-slate-200">Group {group.id}</span>
                <div className="map-group-meta map-group-meta-stack">
                  <span className="badge badge-green text-green-500">+{group.income}</span>
                  {group.id === 'D' && (
                    <span className="badge badge-green text-green-500">+Choose Dis</span>
                  )}
                  {group.id !== 'D' && (
                    <span className="badge badge-red text-red-500">dis {group.dis}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Tiles */}
            <div
              className="map-tile-grid"
              style={{
                gridTemplateColumns: group.id === 'D'
                  ? `minmax(0, ${gridTileSize})`
                  : `repeat(${group.areas.length}, minmax(0, ${gridTileSize}))`,
              }}
            >
              {group.areas.map(area => {
                const isKingIsland = area === 'KING'
                const currentOwner = isKingIsland ? kingOwner ?? currentKing ?? ownership[area] ?? 0 : ownership[area] || 0
                const disasterOwner = isKingIsland ? 0 : disasterOwnership[area] || 0
                const eradicatedOwner = isKingIsland ? 0 : eradicatedOwnership[area] || 0
                const owner       = eradicatedOwner || disasterOwner || currentOwner
                const isSheetDisastered = disasterOwner > 0
                const isEradicated = eradicatedOwner > 0
                const ownerBadgeBg = isSheetDisastered || isEradicated ? '#ffffff' : owner > 0 ? HOUSE_COLORS[owner] : '#ffffff'
                const ownerBadgeFg = isSheetDisastered ? '#dc2626' : isEradicated ? '#1d4ed8' : owner > 0 ? HOUSE_TEXT_COLORS[owner] : '#111827'
                const isSelected  = selected.includes(area)
                const disasters   = getAreaDisasters(area)
                const isFiltered  = filterSet?.has(area) ?? false
                const isKingHitByRule = kingSet?.has(area) ?? false
                const isKingHit   = isKingHitByRule && (kingDisasterTone === 'selection' || !hasSheetDisasterOwnership)
                const dimmed      = isFilterMode && !isFiltered

                // Compute visual state
                let bg        = isKingIsland ? 'rgba(245,158,11,0.12)' : 'rgba(19,25,34,0.9)'
                let border    = 'rgba(255,255,255,0.06)'
                let textColor = isKingIsland ? '#744b00' : '#111827'

                if (owner > 0) {
                  const c = HOUSE_COLORS[owner]
                  bg = `${c}1a`
                  border = `${c}55`
                  textColor = isKingIsland ? '#744b00' : '#111827'
                }
                if (isFilterMode && isFiltered) {
                  border = '#06b6d4'
                  textColor = '#111827'
                }
                if (isKingHit && !filterSet) {
                  if (kingDisasterTone === 'selection') {
                    bg = '#881337'
                    border = '#22d3ee'
                    textColor = '#ffffff'
                  } else {
                    bg = '#fecaca'
                    border = '#991b1b'
                    textColor = '#450a0a'
                  }
                }
                if (isSheetDisastered) {
                  bg = '#fee2e2'
                  border = '#991b1b'
                  textColor = '#b91c1c'
                }
                if (isEradicated) {
                  bg = '#dbeafe'
                  border = '#1d4ed8'
                  textColor = '#1d4ed8'
                }
                if (isSelected) {
                  const preserveHighlight = isFiltered || isKingHit || isSheetDisastered || isEradicated
                  bg = preserveHighlight ? bg : isKingIsland ? 'rgba(245,158,11,0.32)' : 'rgba(245,158,11,0.15)'
                  border = preserveHighlight ? border : 'rgba(245,158,11,0.86)'
                  textColor = preserveHighlight ? textColor : isKingIsland ? '#744b00' : '#111827'
                }

                return (
                  <button key={area}
                    onClick={() => !readOnly && onSelect?.(area)}
                    disabled={readOnly}
                    title={[
                      area,
                      owner ? `บ้าน ${owner}` : 'ว่าง',
                      isKingIsland ? 'King island' : '',
                      isEradicated ? 'Eradicated by MoneyDrop' : '',
                      disasters.length ? 'Disaster ' + disasters.join(', ') : ''
                    ].filter(Boolean).join(' · ')}
                    className={clsx(
                      tileClass,
                      'map-tile-deluxe relative flex flex-col items-center justify-center transition-all duration-150',
                      !readOnly && 'map-tile cursor-pointer',
                      readOnly && 'cursor-default',
                      isSelected && 'map-tile-selected ring-2 ring-yellow-300/80 ring-offset-2 ring-offset-[#07090f]',
                      isKingIsland && 'map-tile-king',
                      isFilterMode && 'map-tile-filter-mode',
                      dimmed && 'map-tile-filter-dim',
                      isFiltered && 'map-tile-filter-hit',
                      isSheetDisastered && 'map-tile-sheet-disastered',
                      isEradicated && 'map-tile-eradicated',
                      isKingHit && !filterSet && kingDisasterTone === 'selection' && 'map-tile-king-hit-selection',
                      isKingHit && !filterSet && kingDisasterTone === 'result' && 'map-tile-king-hit-result',
                    )}
                    style={{ background: bg, border: `1.5px solid ${border}`, '--map-filter-hit-bg': bg } as React.CSSProperties}>

                    {owner > 0 && (
                      <span className={clsx('map-tile-owner font-mono text-[10px] font-black', isSheetDisastered && 'is-disastered', isEradicated && 'is-eradicated')}
                        style={{
                          '--owner-color': HOUSE_COLORS[owner],
                          '--owner-bg': ownerBadgeBg,
                          '--owner-fg': ownerBadgeFg,
                          backgroundColor: ownerBadgeBg,
                          color: ownerBadgeFg,
                        } as React.CSSProperties}>
                        บ้าน {owner}
                      </span>
                    )}

                    <span className={clsx('map-tile-area font-display font-black text-base leading-none', isSheetDisastered && 'is-disastered', isEradicated && 'is-eradicated')} style={{ color: textColor }}>
                      {isKingIsland ? 'KING' : area}
                    </span>

                    {disasters.length > 0 && (
                      <div className="map-tile-disasters flex max-w-full justify-center gap-px overflow-hidden">
                        <span className="rounded bg-slate-100 px-1 text-[9px] font-bold leading-tight text-slate-700">
                          {disasters.slice(0,3).join(',')}
                        </span>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      </div>

      {/* Legend */}
      <div className="hidden">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: 'rgba(19,25,34,0.9)', border: '1.5px solid rgba(255,255,255,0.10)' }} />
          <span className="text-2xs text-slate-700">ว่าง</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded ring-1 ring-yellow-400/70 ring-offset-1 ring-offset-[#07090f]"
            style={{ background: 'rgba(245,158,11,0.15)', border: '1.5px solid rgba(245,158,11,0.7)' }} />
          <span className="text-2xs text-slate-700">เลือก</span>
        </div>
        {Object.entries(HOUSE_COLORS).slice(0,4).map(([b,c]) => (
          <div key={b} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded" style={{ background: c+'1a', border: `1.5px solid ${c}55` }} />
            <span className="text-2xs text-slate-700">บ้าน{b}</span>
          </div>
        ))}
        <span className="text-2xs text-slate-800">…</span>
      </div>
    </div>
  )
}

export default memo(GameMap)
