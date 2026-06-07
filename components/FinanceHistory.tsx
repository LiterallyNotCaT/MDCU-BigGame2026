'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import HistoryPanel from './HistoryPanel'
import { DISASTER_AREAS, HOUSE_NAMES, SHEET_ID, TOTAL_WAVES, getWaveSheetQuery } from '@/lib/constants'
import { withCompetitionRanks } from '@/lib/ranking'
import { getGameState, subscribeStore } from '@/lib/store'
import { X } from 'lucide-react'

type HistoryType = 'income' | 'bet' | 'reward' | 'lose' | 'start' | 'disaster'

interface HistoryDetailLine {
  area?: string
  text: string
  deleted?: boolean
}

interface HistoryEntry {
  wave?: number
  label: string
  detail?: string
  detailLines?: HistoryDetailLine[]
  detailItems?: string[]
  amount: number
  type: HistoryType
  timestamp?: string
  betTarget?: number
  revealResult?: boolean
  hideAmount?: boolean
}

interface OrderedHistoryEntry extends HistoryEntry {
  order: number
}

interface MiniGameRank {
  rank: number | null
  baan: number | null
  score?: number | null
  reward: number | null
}

type RankingModalKind = 'bet-return' | 'ladder'

interface FinanceHistoryProps {
  initialBaan?: number | null
  initialWave?: number | 'all'
  lockBaan?: boolean
  showFilters?: boolean
  showResults?: boolean
  enableBetReturnRanking?: boolean
  maxSelectableWave?: number
  highlightedRevealWave?: number | null
  isRevealHighlightLeaving?: boolean
  className?: string
}

const HIDDEN_RESULTS_NOTICE =
  'Current wave results are hidden'

const parseGViz = (text: string): any[] => {
  const js = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/)?.[1]
  return js ? JSON.parse(js)?.table?.rows ?? [] : []
}

const fetchSheetRows = async (query: string) => {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&${query}`
  const text = await (await fetch(url, { cache: 'no-store' })).text()
  return parseGViz(text)
}

const cellValue = (cell: any) => cell?.v ?? cell?.f ?? ''

const parseBaanList = (value: unknown) => {
  const seen = new Set<number>()
  return (String(value ?? '').match(/\d{1,2}/g) ?? [])
    .map(raw => parseInt(raw, 10))
    .filter(baan => {
      if (!Number.isInteger(baan) || baan < 1 || baan > 12 || seen.has(baan)) return false
      seen.add(baan)
      return true
    })
}

const parseSheetNumber = (value: unknown) => {
  const parsed = parseFloat(String(value ?? '').replace(/,/g, '').replace('%', ''))
  return Number.isFinite(parsed) ? parsed : null
}

const fetchMiniGameRanking = async (wave: number): Promise<MiniGameRank[]> => {
  const query = `${getWaveSheetQuery(wave)}&range=${encodeURIComponent('A20:D31')}`
  const rows = await fetchSheetRows(query)
  const groupedRows = Array.from({ length: 12 }, (_, i) => {
    const cells = rows?.[i]?.c ?? []
    const rank = parseInt(String(cellValue(cells[0]) || i + 1), 10)
    const baanText = String(cellValue(cells[1]) ?? '')
    const baans = parseBaanList(baanText)
    const score = parseSheetNumber(cellValue(cells[2]))
    const reward = parseSheetNumber(cellValue(cells[3]))
    return {
      rank: Number.isFinite(rank) ? rank : i + 1,
      baans,
      score,
      reward,
    }
  })

  const expandedRows = groupedRows.flatMap(row =>
    row.baans.map(baan => ({
      rank: row.rank,
      baan,
      score: row.score,
      reward: row.reward,
    }))
  )
  const hasGroupedBaanCells = groupedRows.some(row => row.baans.length > 1)
  if (hasGroupedBaanCells) {
    return expandedRows.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || (a.baan ?? 99) - (b.baan ?? 99))
  }

  const rankedRows = expandedRows
    .map(row => ({
      ...row,
      scoreForRank: row.score ?? row.reward ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((a, b) => b.scoreForRank - a.scoreForRank || a.baan - b.baan)

  const ranked = withCompetitionRanks(rankedRows, row => row.scoreForRank)

  return ranked.map(({ scoreForRank: _scoreForRank, ...row }) => row)
}

const fetchLadderRanking = async (wave: number): Promise<MiniGameRank[]> => {
  const query = `${getWaveSheetQuery(wave)}&range=${encodeURIComponent('Y5:Y16')}`
  const rows = await fetchSheetRows(query)
  const ladderRows = Array.from({ length: 12 }, (_, i) => {
    const amountRaw = cellValue(rows?.[i]?.c?.[0])
    return {
      rank: null,
      baan: i + 1,
      reward: parseSheetNumber(amountRaw) ?? 0,
    }
  }).sort((a, b) => {
    const amountA = a.reward ?? Number.NEGATIVE_INFINITY
    const amountB = b.reward ?? Number.NEGATIVE_INFINITY
    return amountB - amountA || (a.baan ?? 99) - (b.baan ?? 99)
  })
  return withCompetitionRanks(ladderRows, row => row.reward ?? Number.NEGATIVE_INFINITY)
}

const formatSignedMoney = (amount: number | null) => {
  if (amount === null) return '-'
  if (amount > 0) return `+${amount.toLocaleString()}`
  if (amount < 0) return `-${Math.abs(amount).toLocaleString()}`
  return '0'
}

const fetchEventRank = async (wave: number, baan: number) => {
  if (wave !== 2 && wave !== 4) return null
  try {
    const res = await fetch(`/api/event/status?wave=${wave}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    const match = Array.isArray(data?.results)
      ? data.results.find((item: any) => Number(item?.baan) === baan)
      : null
    const rank = Number(match?.rank)
    return Number.isFinite(rank) && rank > 0 ? rank : null
  } catch {
    return null
  }
}

const affectedAreasFor = (disaster: number | null) => {
  const rule = disaster ? DISASTER_AREAS[disaster] : null
  const affected = new Set<string>()
  if (!rule) return affected
  ;(['A', 'B', 'C'] as const).forEach(group => {
    rule[group].forEach(n => affected.add(`${group}${n}`))
  })
  return affected
}

const formatPercent = (returnAmount: number, spent: number) => {
  if (!spent || !returnAmount) return '0%'
  const pct = (returnAmount / spent) * 100
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`
}

const disownedGroupFromRows = (rows: any[]) => {
  const row20 = rows?.[19]?.c ?? []
  return String(row20?.[14]?.v ?? row20?.[15]?.v ?? row20?.[405]?.v ?? '').trim()
}

const bonusIslandFromRows = (rows: any[]) => {
  const row20 = rows?.[19]?.c ?? []
  return String(cellValue(row20?.[14]) ?? '').trim()
}

const fetchDisownedGroup = async (wave: number, rows: any[]) => {
  const fromVisibleColumns = disownedGroupFromRows(rows)
  if (fromVisibleColumns) return fromVisibleColumns
  const opRows = await fetchSheetRows(`${getWaveSheetQuery(wave)}&range=${encodeURIComponent('OP20:OP20')}`)
  return String(opRows?.[0]?.c?.[0]?.v ?? '').trim()
}

const fetchBonusIslandNames = async (wave: number, rows: any[]) => {
  const fromVisibleColumns = bonusIslandFromRows(rows)
  if (fromVisibleColumns) return fromVisibleColumns
  const oRows = await fetchSheetRows(`${getWaveSheetQuery(wave)}&range=${encodeURIComponent('O20:O20')}`)
  return String(cellValue(oRows?.[0]?.c?.[0]) ?? '').trim()
}

function FinanceHistory({
  initialBaan = null,
  initialWave = 'all',
  lockBaan = false,
  showFilters = true,
  showResults: showResultsOverride,
  enableBetReturnRanking = false,
  maxSelectableWave,
  highlightedRevealWave = null,
  isRevealHighlightLeaving = false,
  className,
}: FinanceHistoryProps) {
  const [selectedBaan, setSelectedBaan] = useState<number | null>(initialBaan)
  const [selectedWave, setSelectedWave] = useState<number | 'all'>(initialWave)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [balance, setBalance] = useState<number | undefined>(undefined)
  const [lastRefresh, setLastRefresh] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentWave, setCurrentWave] = useState(getGameState().currentWave)
  const [stateShowResults, setStateShowResults] = useState(getGameState().showResults === true)
  const [rankingKind, setRankingKind] = useState<RankingModalKind>('bet-return')
  const [rankingWave, setRankingWave] = useState<number | null>(null)
  const [rankingBetTarget, setRankingBetTarget] = useState<number | null>(null)
  const [miniGameRanking, setMiniGameRanking] = useState<MiniGameRank[]>([])
  const [rankingLoading, setRankingLoading] = useState(false)
  const [rankingError, setRankingError] = useState('')
  const showResults = showResultsOverride ?? stateShowResults
  const selectableWaveLimit = Math.max(1, Math.min(TOTAL_WAVES, maxSelectableWave ?? currentWave))

  useEffect(() => setSelectedBaan(initialBaan), [initialBaan])
  useEffect(() => setSelectedWave(initialWave), [initialWave])
  useEffect(() => {
    const update = () => {
      const state = getGameState()
      setCurrentWave(state.currentWave)
      setStateShowResults(state.showResults === true)
    }
    const unsub = subscribeStore(update)
    return unsub
  }, [])
  useEffect(() => {
    if (selectedWave !== 'all' && selectedWave > selectableWaveLimit) setSelectedWave(selectableWaveLimit)
  }, [selectableWaveLimit, selectedWave])

  const wavesToRead = useMemo(
    () => selectedWave === 'all'
      ? Array.from({ length: selectableWaveLimit }, (_, i) => i + 1)
      : [Math.min(selectedWave, selectableWaveLimit)],
    [selectableWaveLimit, selectedWave],
  )

  const refresh = useCallback(async () => {
    if (!selectedBaan) {
      setEntries([])
      setBalance(undefined)
      return
    }

    setLoading(true)
    try {
      const nextEntries: OrderedHistoryEntry[] = []
      let latestBalance: number | undefined
      let morningAdded = false

      for (const wave of wavesToRead) {
        const [rows, islandRangeRows, financeRangeRows] = await Promise.all([
          fetchSheetRows(getWaveSheetQuery(wave)),
          fetchSheetRows(`${getWaveSheetQuery(wave)}&range=${encodeURIComponent('A5:P16')}`),
          fetchSheetRows(`${getWaveSheetQuery(wave)}&range=${encodeURIComponent('A5:AB16')}`),
        ])
        const row = rows.find((r: any) => parseInt(String(cellValue(r?.c?.[0]) ?? '')) === selectedBaan)
        if (!row) continue

        const c = row.c ?? []
        const islandRangeRow = islandRangeRows.find((r: any) => parseInt(String(cellValue(r?.c?.[0]) ?? '')) === selectedBaan)
        const islandRangeCells = islandRangeRow?.c ?? []
        const financeRow = financeRangeRows.find((r: any) => parseInt(String(cellValue(r?.c?.[0]) ?? '')) === selectedBaan)
        const financeCells = financeRow?.c ?? []
        const read = (idx: number) => cellValue(c?.[idx])
        const readFinance = (idx: number) => cellValue(financeCells?.[idx])
        const hasTextValue = (value: unknown) => String(value ?? '').trim() !== ''
        const numberAt = (idx: number) => parseSheetNumber(read(idx)) ?? 0
        const textAt = (idx: number) => String(read(idx) ?? '').trim()
        const hasCellValue = (idx: number) => textAt(idx) !== ''
        const financeNumberAt = (idx: number) => parseSheetNumber(readFinance(idx)) ?? numberAt(idx)
        const financeTextAt = (idx: number) => String(readFinance(idx) ?? read(idx) ?? '').trim()
        const hasFinanceCellValue = (idx: number) => financeTextAt(idx) !== ''
        const islandRangeRead = (localIdx: number) => {
          return cellValue(islandRangeCells?.[localIdx + 7])
        }
        const islandRangeTextAt = (localIdx: number) => String(islandRangeRead(localIdx) ?? '').trim()
        const islandRangeNumberAt = (localIdx: number) => parseSheetNumber(islandRangeRead(localIdx)) ?? 0
        const areaAt = (nameIdx: number, amountIdx: number, returnIdx: number) => {
          const normalizeArea = (value: string) => {
            const match = value.toUpperCase().match(/\b[ABC][1-9]\b/)
            return match?.[0] ?? ''
          }
          const direct = normalizeArea(textAt(nameIdx))
          if (direct) return direct

          // GViz can sometimes expose formatted cells oddly. Keep the fixed sheet map,
          // but scan the neighboring island cells so the amount never shows as "-: 100".
          const candidates = [
            nameIdx - 1,
            nameIdx,
            nameIdx + 1,
            amountIdx - 1,
            amountIdx + 1,
            returnIdx - 2,
            returnIdx - 1,
          ]
          for (const idx of candidates) {
            if (idx < 0 || idx >= c.length) continue
            const area = normalizeArea(textAt(idx))
            if (area) return area
          }
          return ''
        }
        const startingBalance = numberAt(1)
        const isCurrentWave = wave === currentWave
        const revealWave = showResults || !isCurrentWave

        if (!morningAdded && wave === 1) {
          latestBalance = startingBalance
          nextEntries.push({
            order: 0,
            label: 'เงินสุทธิ จากเกมเช้า',
            amount: startingBalance,
            type: startingBalance >= 0 ? 'income' : 'lose',
          })
          morningAdded = true
        }

        const waveKing = parseInt(String(cellValue(rows?.[19]?.c?.[7]) ?? ''))
        const kingHouse = isNaN(waveKing) ? null : waveKing
        const waveDisasterRaw = parseInt(String(cellValue(rows?.[21]?.c?.[7]) ?? ''))
        const waveDisaster = isNaN(waveDisasterRaw) ? null : waveDisasterRaw
        const affectedAreas = affectedAreasFor(waveDisaster)
        const winnerRow = rows.find((r: any) => String(cellValue(r?.c?.[6]) ?? '').trim() === '1')
        const winningKingHouse = winnerRow ? parseInt(String(cellValue(winnerRow?.c?.[0]) ?? '')) : null
        const winningKingBid = winnerRow ? parseSheetNumber(cellValue(winnerRow?.c?.[5])) ?? 0 : 0
        const lastKingBonus = wave === 5 ? financeNumberAt(21) : 0
        const totalOccupationBonus = wave === 5 ? financeNumberAt(22) : 0
        const currentKingGain = financeNumberAt(23)
        const bonusIslandAmount = wave === 2 ? financeNumberAt(22) : 0
        const ladderAmount = wave === 2 || wave === 4 ? financeNumberAt(24) : 0
        const honestyAmount = financeNumberAt(25)
        const adminLabel = financeTextAt(26)
        const adminAmount = financeNumberAt(27)
        const hasAdminAmount = hasFinanceCellValue(27)
        const disownedGroup = wave === 4 ? await fetchDisownedGroup(wave, rows) : ''
        const bonusIslandNames = wave === 2 ? await fetchBonusIslandNames(wave, rows) : ''

        const betHouse = textAt(2)
        const betAmountSheet = numberAt(3)
        const betReturn = numberAt(4)
        if (betHouse || betAmountSheet) {
          const betHouseNumber = parseInt(betHouse)
          nextEntries.push({
            order: wave * 100 + 10,
            wave,
            label: 'ลงเงิน เกมแทงม้า',
            detail: !isNaN(betHouseNumber) ? `แทงบ้าน ${betHouseNumber}` : undefined,
            amount: -betAmountSheet,
            type: 'bet',
          })
        }

        const kingAmount = numberAt(5)
        const kingResult = textAt(6)
        if (kingAmount) {
          nextEntries.push({
            order: wave * 100 + 20,
            wave,
            label: 'ลงทุนประมูล วิหาร King',
            amount: -kingAmount,
            type: 'bet',
          })
        }

        const islandBidLines: string[] = []
        const islandReturnLines: HistoryDetailLine[] = []
        let islandSpentTotal = 0
        let islandReturnTotal = 0
        ;[
          { range: [0, 1, 2], full: [7, 8, 9] },
          { range: [3, 4, 5], full: [10, 11, 12] },
          { range: [6, 7, 8], full: [13, 14, 15] },
        ].forEach(({ range, full }) => {
          const [rangeNameIdx, rangeAmountIdx, rangeReturnIdx] = range
          const [nameIdx, amountIdx, returnIdx] = full
          const exactArea = islandRangeTextAt(rangeNameIdx).toUpperCase().match(/\b[ABC][1-9]\b/)?.[0] ?? ''
          const area = exactArea || areaAt(nameIdx, amountIdx, returnIdx)
          const spent = hasTextValue(islandRangeRead(rangeAmountIdx)) ? islandRangeNumberAt(rangeAmountIdx) : numberAt(amountIdx)
          const got = hasTextValue(islandRangeRead(rangeReturnIdx)) ? islandRangeNumberAt(rangeReturnIdx) : numberAt(returnIdx)
          if (area || spent) {
            islandBidLines.push(`${area || '-'}: ${spent.toLocaleString()}`)
            islandSpentTotal += spent
          }
          if (area || spent || got) {
            const disasteredWin = got > 0 && Boolean(area) && affectedAreas.has(area)
            const statusText = got <= 0
              ? 'ประมูลแพ้'
              : disasteredWin
                ? `ประมูลชนะ แต่โดน disaster${kingHouse ? ` โดยบ้าน ${kingHouse}` : ''}`
                : 'ประมูลชนะ'
            islandReturnLines.push({
              area: area || '-',
              text: `${got.toLocaleString()} (${statusText})`,
              deleted: disasteredWin,
            })
            islandReturnTotal += got
          }
        })
        if (islandBidLines.length) {
          nextEntries.push({
            order: wave * 100 + 30,
            wave,
            label: 'ลงทุนประมูล พื้นที่',
            detail: islandBidLines.join('\n'),
            amount: -islandSpentTotal,
            type: 'bet',
          })
        }

        const visibleResultAdjustments =
          betReturn +
          islandReturnTotal +
          lastKingBonus +
          totalOccupationBonus +
          currentKingGain +
          bonusIslandAmount +
          ladderAmount +
          honestyAmount +
          (adminLabel && hasAdminAmount ? adminAmount : 0)

        if (revealWave) {
          latestBalance = read(20) != null && String(read(20)).trim() !== ''
            ? numberAt(20)
            : startingBalance - betAmountSheet - kingAmount - islandSpentTotal + visibleResultAdjustments
        } else {
          latestBalance = startingBalance - betAmountSheet - kingAmount - islandSpentTotal
        }

        const eventAmount = numberAt(19)
        const eventRank = revealWave && eventAmount ? await fetchEventRank(wave, selectedBaan) : null
        const extras = [
          { label: 'เงินได้ จากนักเล่นเกมเดี่ยว (Board Game)', amount: numberAt(17) },
          { label: 'เงินได้ จากนักเล่นเกมทีม (Money Drop)', amount: numberAt(18) },
          {
            label: eventRank ? `เงินโบนัส จาก Event (ตอบถูกเป็นลำดับที่ ${eventRank})` : 'เงินโบนัส จาก Event',
            amount: eventAmount,
          },
        ].filter(x => x.amount)
        if (revealWave) extras.forEach((x, idx) => nextEntries.push({
          order: wave * 100 + 40 + idx,
          wave,
          label: x.label,
          amount: x.amount,
          type: x.amount >= 0 ? 'income' : 'lose',
          revealResult: isCurrentWave,
        }))

        if (revealWave && (wave === 2 || wave === 4)) {
          nextEntries.push({
            order: wave * 100 + 45,
            wave,
            label: 'เงินได้ จากคนพลิกเกม (บันไดงูพิสดาร)',
            amount: ladderAmount,
            type: 'income',
            revealResult: isCurrentWave,
          })
        }

        if (revealWave) {
          const resultEntries = [
            {
              label: 'เงินโบนัส ครอบครองพื้นที่',
              detail: '+10000/occupied area',
              amount: totalOccupationBonus,
              order: wave * 100 + 43.2,
            },
            {
              label: 'เงินได้ จากพื้นที่ที่โดนภัยพิบัติ',
              detail: 'จาก 50% ของเงินที่ประมูลชนะในพื่นที่ที่คุณทำลาย',
              amount: currentKingGain,
              order: wave * 100 + 44,
            },
            {
              label: 'เงินโบนัส เกาะพิเศษ (Money Drop)',
              detail: bonusIslandNames
                ? `From Money Drop\nBonus Island : ${bonusIslandNames}`
                : 'From Money Drop',
              amount: bonusIslandAmount,
              order: wave * 100 + 46,
            },
            {
              label: 'เงินโบนัส จากนักทูต (คุณพูดความจริง!)',
              detail: '+1000/พื้นที่ ถ้าลงทุนตามที่สัญญาในห้องทูต',
              amount: honestyAmount,
              order: wave * 100 + 47,
            },
          ].filter(x => x.amount !== 0)

          resultEntries.forEach(x => nextEntries.push({
            order: x.order,
            wave,
            label: x.label,
            detail: x.detail,
            amount: x.amount,
            type: x.amount >= 0 ? 'income' : 'lose',
            revealResult: isCurrentWave,
          }))

          if (adminLabel && hasAdminAmount) {
            nextEntries.push({
              order: wave * 100 + 48,
              wave,
              label: adminLabel,
              amount: adminAmount,
              type: adminAmount >= 0 ? 'income' : 'lose',
              revealResult: isCurrentWave,
            })
          }

          if (wave === 4 && disownedGroup) {
            nextEntries.push({
              order: wave * 100 + 49,
              wave,
              label: 'พื้นที่ของคุณโดนภัยพิบัติจาก King!',
              detail: disownedGroup,
              amount: 0,
              type: 'disaster',
              revealResult: isCurrentWave,
              hideAmount: true,
            })
          }
        }

        if (revealWave && (betHouse || betAmountSheet || betReturn)) {
          const parsedBetTarget = parseInt(betHouse)
          nextEntries.push({
            order: wave * 100 + 60,
            wave,
            label: `ผลตอบแทน เกมแทงม้า: +${formatPercent(betReturn, betAmountSheet)}`,
            amount: betReturn,
            type: betReturn > 0 ? 'reward' : 'lose',
            betTarget: !isNaN(parsedBetTarget) ? parsedBetTarget : undefined,
            revealResult: isCurrentWave,
          })
        }
        if (revealWave && islandReturnLines.length) {
          nextEntries.push({
            order: wave * 100 + 70,
            wave,
            label: 'ผลตอบแทน จากการลงทุนพื้นที่',
            detailLines: islandReturnLines,
            amount: islandReturnTotal,
            type: islandReturnTotal > 0 ? 'income' : 'lose',
            revealResult: isCurrentWave,
          })
        }
        if (revealWave && (kingAmount || kingResult || winningKingHouse)) {
          const wonKing = kingResult === '1'
          const kingResultAmount = wonKing && wave === TOTAL_WAVES ? lastKingBonus : 0
          const kingDetail = kingResult === '1'
            ? wave === TOTAL_WAVES
              ? `คุณชนะประมูล King ด้วยเงิน ${winningKingBid.toLocaleString()} - ซึ่งได้ Bonus ${lastKingBonus.toLocaleString()}`
              : `คุณชนะประมูล King ด้วยเงิน ${winningKingBid.toLocaleString()} - จะได้เป็น King ในรอบถัดไป`
            : `คุณไม่ชนะการประมูล King${winningKingHouse ? `, บ้าน ${winningKingHouse} ชนะด้วยเงิน ${winningKingBid.toLocaleString()}` : ''}`
          nextEntries.push({
            order: wave * 100 + 80,
            wave,
            label: 'ผลการประมูล วิหาร King',
            detail: kingDetail,
            amount: kingResultAmount,
            type: wonKing ? 'reward' : 'lose',
            revealResult: isCurrentWave,
          })
        }
      }

      setBalance(latestBalance)
      setEntries(nextEntries.sort((a, b) => a.order - b.order))
      setLastRefresh(new Date().toLocaleTimeString('th-TH'))
    } catch (e) {
      console.error(e)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [selectedBaan, wavesToRead, showResults, currentWave])

  useEffect(() => {
    refresh()
    const t = window.setInterval(refresh, 45000)
    return () => window.clearInterval(t)
  }, [refresh])

  const openMiniGameRanking = useCallback(async (wave: number, betTarget?: number) => {
    setRankingKind('bet-return')
    setRankingWave(wave)
    setRankingBetTarget(betTarget ?? null)
    setMiniGameRanking([])
    setRankingError('')
    setRankingLoading(true)
    try {
      setMiniGameRanking(await fetchMiniGameRanking(wave))
    } catch (e) {
      console.error(e)
      setRankingError('ไม่สามารถโหลดอันดับการเล่นเกมเดี่ยวได้')
    } finally {
      setRankingLoading(false)
    }
  }, [])
  const openLadderRanking = useCallback(async (wave: number) => {
    setRankingKind('ladder')
    setRankingWave(wave)
    setRankingBetTarget(null)
    setMiniGameRanking([])
    setRankingError('')
    setRankingLoading(true)
    try {
      setMiniGameRanking(await fetchLadderRanking(wave))
    } catch (e) {
      console.error(e)
      setRankingError('ไม่สามารถโหลดอันดับเงินจากเกมบันไดงูได้')
    } finally {
      setRankingLoading(false)
    }
  }, [])
  const rankingColumns = [
    miniGameRanking.slice(0, 6),
    miniGameRanking.slice(6, 12),
  ]
  const showRankingRewards = rankingKind === 'bet-return'
  const showLadderAmounts = rankingKind === 'ladder'
  const showRankingRightValue = showRankingRewards || showLadderAmounts
  const rankingTitle = rankingKind === 'ladder'
    ? 'ประกาศอันดับเงินจากการเล่น "เกมพลิกเกม - บันไดงูพิสดาร"'
    : 'ประกาศผลการเล่นเกมเดี่ยว (นำมาคิดผลการแทงม้า)'

  return (
    <div className={clsx('finance-history space-y-3', className)}>
      {!showResults && HIDDEN_RESULTS_NOTICE && (
        <div className="history-hidden-notice">
          {HIDDEN_RESULTS_NOTICE}
        </div>
      )}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {!lockBaan && (
            <select value={selectedBaan ?? ''} onChange={e => setSelectedBaan(e.target.value ? parseInt(e.target.value) : null)}
              className="input-base w-auto min-w-40">
              <option value="">เลือกบ้าน</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(b => (
                <option key={b} value={b}>{HOUSE_NAMES[b]}</option>
              ))}
            </select>
          )}
          <button onClick={() => setSelectedWave('all')} className={clsx('btn', selectedWave === 'all' ? 'btn-primary' : 'btn-ghost')}>
            All
          </button>
          {Array.from({ length: selectableWaveLimit }, (_, i) => i + 1).map(w => (
            <button key={w} onClick={() => setSelectedWave(w)}
              className={clsx('btn', selectedWave === w ? 'btn-primary' : 'btn-ghost')}>
              W{w}
            </button>
          ))}
          <button onClick={refresh} disabled={loading} className="btn btn-ghost ml-auto">
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          {lastRefresh && <span className="text-xs text-slate-500">updated {lastRefresh}</span>}
        </div>
      )}

      {selectedBaan ? (
        <HistoryPanel
          entries={entries}
          baan={selectedBaan}
          balance={balance}
          title="ประวัติการเงิน"
          maxHeight="none"
          onBetReturnRankingClick={enableBetReturnRanking ? openMiniGameRanking : undefined}
          onLadderRankingClick={enableBetReturnRanking ? openLadderRanking : undefined}
          highlightedRevealWave={highlightedRevealWave}
          isRevealHighlightLeaving={isRevealHighlightLeaving}
        />
      ) : (
        <div className="wire-panel bg-white p-8 text-center text-slate-600">
          เลือกบ้านเพื่อดูประวัติการเงิน
        </div>
      )}

      {rankingWave !== null && (
        <div className="mini-game-modal-backdrop">
          <div className="mini-game-modal-panel">
            <div className={clsx('mini-game-modal-header', rankingKind === 'ladder' && 'is-ladder')}>
              <div>
                <h2 className="mini-game-modal-title">
                  {rankingTitle}
                </h2>
                <p className="mini-game-modal-subtitle">รอบที่ {rankingWave}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRankingWave(null)
                  setRankingBetTarget(null)
                }}
                className="mini-game-modal-close"
                aria-label="Close ranking popup"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mini-game-modal-body">
              {rankingLoading ? (
                <div className="mini-game-ranking-state">
                  กำลังโหลดอันดับ...
                </div>
              ) : rankingError ? (
                <div className="mini-game-ranking-error">
                  {rankingError}
                </div>
              ) : (
                <div className="mini-game-ranking-columns">
                  {rankingColumns.map((column, columnIndex) => (
                    <div key={columnIndex} className="mini-game-ranking-column">
                      {column.map((row, rowIndex) => (
                        <div
                          key={`${row.baan ?? 'unknown'}-${row.rank ?? 'blank'}-${columnIndex}-${rowIndex}`}
                          className={clsx(
                            'mini-game-ranking-row',
                            !showRankingRightValue && 'is-no-reward',
                            row.rank !== null && row.rank <= 3 && 'is-top-rank',
                            row.rank === 1 && 'is-rank-1',
                            row.rank === 2 && 'is-rank-2',
                            row.rank === 3 && 'is-rank-3',
                            showRankingRewards && row.baan === rankingBetTarget && 'is-player-bet'
                          )}
                        >
                          <div className="mini-game-ranking-number">{row.rank ?? '-'}</div>
                          <div className="mini-game-ranking-copy">
                            <div className="mini-game-ranking-house">
                              {row.baan ? HOUSE_NAMES[row.baan] : '-'}
                            </div>
                            {showRankingRewards && row.baan === rankingBetTarget && (
                              <div className="mini-game-ranking-player-note">บ้านที่คุณแทง</div>
                            )}
                          </div>
                          {showRankingRightValue && (
                            <div className={clsx('mini-game-ranking-reward', showLadderAmounts && 'is-ladder-amount')}>
                              <div className="mini-game-ranking-reward-label">
                                {showLadderAmounts ? 'เงินที่ได้' : 'ผลตอบแทน'}
                              </div>
                              <div
                                className={clsx(
                                  'mini-game-ranking-reward-value',
                                  showRankingRewards && row.reward !== null && row.reward >= 100 && 'is-reward-good',
                                  showRankingRewards && row.reward !== null && row.reward < 99 && 'is-reward-bad',
                                  showLadderAmounts && row.reward !== null && row.reward > 0 && 'is-reward-good',
                                  showLadderAmounts && row.reward !== null && row.reward < 0 && 'is-reward-bad'
                                )}
                              >
                                {showLadderAmounts
                                  ? formatSignedMoney(row.reward)
                                  : row.reward !== null ? `${row.reward.toLocaleString()}%` : '-'}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(FinanceHistory)
