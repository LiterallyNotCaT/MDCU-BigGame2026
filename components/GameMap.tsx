'use client'
import { memo } from 'react'
import clsx from 'clsx'
import { HOUSE_COLORS, DISASTER_AREAS } from '@/lib/constants'

interface MapProps {
  ownership:       Record<string, number>
  selected?:       string[]
  onSelect?:       (area: string) => void
  filterDisaster?: number | null
  readOnly?:       boolean
  kingDisaster?:   number | null
  kingDisasterTone?: 'selection' | 'result'
  currentKing?:    number | null
  compact?:        boolean
}

const GROUPS = [
  { id:'A', areas:['A1','A2','A3','A4','A5'],               income:'180%', dis:'90%' },
  { id:'B', areas:['B1','B2','B3','B4','B5','B6'],          income:'160%', dis:'80%' },
  { id:'C', areas:['C1','C2','C3','C4','C5','C6','C7','C8','C9'], income:'140%', dis:'70%' },
  { id:'D', areas:['KING'],                                 income:'King', dis:'choose D' },
]

function getAreaDisasters(area: string): number[] {
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

function getAffected(dn: number | null): Set<string> {
  if (!dn || !DISASTER_AREAS[dn]) return new Set()
  const s = new Set<string>()
  const d = DISASTER_AREAS[dn]
  d.A.forEach(n => s.add(`A${n}`))
  d.B.forEach(n => s.add(`B${n}`))
  d.C.forEach(n => s.add(`C${n}`))
  return s
}

function GameMap({
  ownership, selected=[], onSelect, filterDisaster, readOnly, kingDisaster, kingDisasterTone = 'result', currentKing = null, compact,
}: MapProps) {
  const filterSet = filterDisaster != null ? getAffected(filterDisaster) : null
  const kingSet   = kingDisaster   != null ? getAffected(kingDisaster)   : null

  const tileClass = compact ? 'map-tile-deluxe-compact' : 'map-tile-deluxe-regular'
  const gridTileSize = compact
    ? 'clamp(44px, 5.2vw, 76px)'
    : 'clamp(56px, 7vw, 116px)'

  return (
    <div className={clsx('game-map select-none', compact ? 'game-map-compact' : 'game-map-regular')}>
      {kingDisaster != null && !filterDisaster && (
        <div className="map-king-disaster-notice">
          <span>King บ้าน {currentKing ?? '-'} เลือก disaster {kingDisaster}</span>
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
                <div className="map-group-meta">
                  <span className="badge badge-green text-green-500" style={{ fontSize: '0.55rem' }}>+{group.income}</span>
                  <span className="badge badge-red text-red-500" style={{ fontSize: '0.55rem' }}>dis {group.dis}</span>
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
                const owner       = isKingIsland ? currentKing ?? ownership[area] ?? 0 : ownership[area] || 0
                const isSelected  = selected.includes(area)
                const disasters   = getAreaDisasters(area)
                const isFiltered  = filterSet?.has(area) ?? false
                const isKingHit   = kingSet?.has(area)   ?? false
                const dimmed      = filterSet != null && !isFiltered

                // Compute visual state
                let bg        = isKingIsland ? 'rgba(245,158,11,0.12)' : 'rgba(19,25,34,0.9)'
                let border    = 'rgba(255,255,255,0.06)'
                let textColor = isKingIsland ? '#b45309' : '#475569'

                if (owner > 0 && !dimmed) {
                  const c = HOUSE_COLORS[owner]
                  bg = `${c}1a`; border = `${c}55`; textColor = c
                }
                if (filterSet != null) {
                  if (isFiltered)  { bg='#111827'; border='#fde047'; textColor='#ffffff' }
                  if (dimmed)      { bg='rgba(226,232,240,0.52)'; border='rgba(148,163,184,0.26)'; textColor='#94a3b8' }
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
                if (isSelected) {
                  const preserveHighlight = isFiltered || isKingHit
                  bg = preserveHighlight ? bg : isKingIsland ? 'rgba(245,158,11,0.32)' : 'rgba(245,158,11,0.15)'
                  border = preserveHighlight ? border : 'rgba(245,158,11,0.86)'
                  textColor = preserveHighlight ? textColor : '#92400e'
                }

                return (
                  <button key={area}
                    onClick={() => !readOnly && onSelect?.(area)}
                    disabled={readOnly}
                    title={[
                      area,
                      owner ? `บ้าน ${owner}` : 'ว่าง',
                      isKingIsland ? 'King island' : '',
                      disasters.length ? 'Disaster ' + disasters.join(', ') : ''
                    ].filter(Boolean).join(' · ')}
                    className={clsx(
                      tileClass,
                      'map-tile-deluxe relative flex flex-col items-center justify-center transition-all duration-150',
                      !readOnly && !dimmed && 'map-tile cursor-pointer',
                      readOnly && 'cursor-default',
                      isSelected && 'map-tile-selected ring-2 ring-yellow-300/80 ring-offset-2 ring-offset-[#07090f]',
                      isKingIsland && 'map-tile-king',
                      isFiltered && 'map-tile-filter-hit',
                      isKingHit && !filterSet && kingDisasterTone === 'selection' && 'map-tile-king-hit-selection',
                      isKingHit && !filterSet && kingDisasterTone === 'result' && 'map-tile-king-hit-result',
                    )}
                    style={{ background: bg, border: `1.5px solid ${border}` }}>

                    {owner > 0 && !dimmed && (
                      <span className="map-tile-owner font-mono text-[10px] font-black"
                        style={{ '--owner-color': HOUSE_COLORS[owner], background: `${HOUSE_COLORS[owner]}18` } as React.CSSProperties}>
                        บ้าน {owner}
                      </span>
                    )}

                    <span className="map-tile-area font-display font-black text-base leading-none" style={{ color: textColor }}>
                      {isKingIsland ? 'KING' : area}
                    </span>

                    {disasters.length > 0 && !dimmed && (
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
