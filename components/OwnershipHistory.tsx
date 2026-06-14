'use client'

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { HOUSE_COLORS, HOUSE_NAMES, HOUSE_TEXT_COLORS, SHEET_ID, TOTAL_WAVES, getWaveSheetQuery } from '@/lib/constants'

export interface OwnershipRow {
  baan: number
  areas: string[]
  disasterAreas: string[]
  eradicatedAreas: string[]
  count: number
}

const parseGViz = (text: string): any[] => {
  const js = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)?.[1]
  return js ? JSON.parse(js)?.table?.rows ?? [] : []
}

async function fetchRows(wave: number, range: string) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&${getWaveSheetQuery(wave)}&range=${encodeURIComponent(range)}&t=${Date.now()}`
  const text = await (await fetch(url, { cache: 'no-store' })).text()
  return parseGViz(text)
}

const cellValue = (cell: any) => cell?.v ?? cell?.f ?? ''

const parseAreaList = (value: unknown) => {
  const matches = String(value ?? '').toUpperCase().match(/[ABC]\s*[1-9]/g) ?? []
  return Array.from(new Set(matches.map(area => area.replace(/\s+/g, ''))))
}

export async function fetchWaveOwnership(wave: number): Promise<{ ownership: Record<string, number>; disasterOwnership: Record<string, number>; eradicatedOwnership: Record<string, number>; rows: OwnershipRow[] }> {
  const [sheetRows, eradicatedRows] = await Promise.all([
    fetchRows(wave, 'J20:N31'),
    wave === 4 ? fetchRows(wave, 'I20:J31') : Promise.resolve([]),
  ])
  const ownership: Record<string, number> = {}
  const disasterOwnership: Record<string, number> = {}
  const eradicatedOwnership: Record<string, number> = {}
  const rowsByBaan = new Map<number, OwnershipRow>()

  sheetRows.forEach((row: any) => {
    const cells = row?.c ?? []
    const baan = parseInt(String(cellValue(cells?.[0]) ?? ''))
    if (!baan || baan < 1 || baan > 12) return
    const areas = parseAreaList(cellValue(cells?.[1]))
    const disasterAreas = parseAreaList(cellValue(cells?.[4]))
    const count = parseFloat(String(cellValue(cells?.[2]) ?? areas.length)) || areas.length
    rowsByBaan.set(baan, { baan, areas, disasterAreas, eradicatedAreas: [], count })
    areas.forEach(area => { ownership[area] = baan })
    disasterAreas.forEach(area => { disasterOwnership[area] = baan })
  })

  eradicatedRows.forEach((row: any) => {
    const cells = row?.c ?? []
    const baan = parseInt(String(cellValue(cells?.[1]) ?? ''))
    if (!baan || baan < 1 || baan > 12) return
    const eradicatedAreas = parseAreaList(cellValue(cells?.[0]))
    if (!eradicatedAreas.length) return
    const existing = rowsByBaan.get(baan) ?? { baan, areas: [], disasterAreas: [], eradicatedAreas: [], count: 0 }
    existing.eradicatedAreas = eradicatedAreas
    rowsByBaan.set(baan, existing)
    eradicatedAreas.forEach(area => { eradicatedOwnership[area] = baan })
  })

  const rows = Array.from(rowsByBaan.values())
  return { ownership, disasterOwnership, eradicatedOwnership, rows: rows.sort((a, b) => a.baan - b.baan) }
}

export function useWaveOwnership(wave: number) {
  const [ownership, setOwnership] = useState<Record<string, number>>({})
  const [disasterOwnership, setDisasterOwnership] = useState<Record<string, number>>({})
  const [eradicatedOwnership, setEradicatedOwnership] = useState<Record<string, number>>({})
  const [rows, setRows] = useState<OwnershipRow[]>([])

  const refresh = useCallback(async () => {
    try {
      const data = await fetchWaveOwnership(wave)
      setOwnership(data.ownership)
      setDisasterOwnership(data.disasterOwnership)
      setEradicatedOwnership(data.eradicatedOwnership)
      setRows(data.rows)
    } catch (e) {
      console.error(e)
    }
  }, [wave])

  useEffect(() => {
    refresh()
    const t = window.setInterval(refresh, 20000)
    return () => window.clearInterval(t)
  }, [refresh])

  return { ownership, disasterOwnership, eradicatedOwnership, rows, refresh }
}

export default function OwnershipHistory({ visibleThroughWave = TOTAL_WAVES, className }: { wave?: number; visibleThroughWave?: number; className?: string }) {
  const [matrix, setMatrix] = useState<Record<number, Record<number, { areas: string[]; disasterAreas: string[]; eradicatedAreas: string[] }>>>({})
  const maxVisibleWave = Math.max(1, Math.min(TOTAL_WAVES, visibleThroughWave))

  const refreshAll = useCallback(async () => {
    try {
      const next: Record<number, Record<number, { areas: string[]; disasterAreas: string[]; eradicatedAreas: string[] }>> = {}
      await Promise.all(Array.from({ length: TOTAL_WAVES }, async (_, i) => {
        const wave = i + 1
        if (wave > maxVisibleWave) return
        const data = await fetchWaveOwnership(wave)
        next[wave] = {}
        data.rows.forEach(row => {
          next[wave][row.baan] = { areas: row.areas, disasterAreas: row.disasterAreas, eradicatedAreas: row.eradicatedAreas }
        })
      }))
      setMatrix(next)
    } catch (e) {
      console.error(e)
    }
  }, [maxVisibleWave])

  useEffect(() => {
    refreshAll()
    const t = window.setInterval(refreshAll, 20000)
    return () => window.clearInterval(t)
  }, [refreshAll])

  return (
    <div className={clsx('ownership-history wire-panel bg-white p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="font-display text-sm font-bold text-slate-800">Ownership history</div>
        <button onClick={refreshAll} className="btn btn-ghost py-1.5 px-2 text-xs">Refresh</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-3 py-2 text-left">House</th>
              {Array.from({ length: TOTAL_WAVES }, (_, i) => (
                <th key={i + 1} className="px-3 py-2 text-left">Wave {i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(baan => (
              <tr key={baan} className="border-b border-slate-100">
                <td className="whitespace-nowrap px-3 py-2 font-semibold">
                  <span
                    className="inline-flex min-w-[4.75rem] items-center justify-center rounded-md border px-2 py-1 text-xs font-black"
                    style={{ background: HOUSE_COLORS[baan], color: HOUSE_TEXT_COLORS[baan], borderColor: 'rgba(15, 23, 42, 0.28)' }}
                  >
                    {HOUSE_NAMES[baan]}
                  </span>
                </td>
                {Array.from({ length: TOTAL_WAVES }, (_, i) => {
                  const wave = i + 1
                  const cell = matrix[wave]?.[baan]
                  const areas = cell?.areas ?? []
                  const disasterAreas = cell?.disasterAreas ?? []
                  const eradicatedAreas = cell?.eradicatedAreas ?? []
                  return (
                    <td key={wave} className="min-w-28 px-3 py-2 text-slate-700">
                      {wave > maxVisibleWave ? '-' : areas.length || disasterAreas.length || eradicatedAreas.length ? (
                        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          {areas.length > 0 && <span>{areas.join(', ')}</span>}
                          {disasterAreas.length > 0 && (
                            <span className="ownership-disaster-areas">
                              {disasterAreas.join(', ')}
                            </span>
                          )}
                          {eradicatedAreas.length > 0 && (
                            <span className="ownership-eradicated-areas">
                              {eradicatedAreas.join(', ')}
                            </span>
                          )}
                        </span>
                      ) : '-'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
