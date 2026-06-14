'use client'

import { memo, useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import { HOUSE_COLORS, HOUSE_TEXT_COLORS } from '@/lib/constants'
import { getAffected, getAreaDisasters, type MapProps } from '@/components/GameMap'

type AreaShape = {
  id: string
  points: ReadonlyArray<readonly [number, number]>
  label: { x: number; y: number }
  badge: { x: number; y: number }
  tension?: number
}

type SvgZone = {
  d: string
  transform: string
}

const VIEWBOX_WIDTH = 2171
const VIEWBOX_HEIGHT = 1406
const SVG_ZONE_PATH = '/maps/biggame-island-zones.svg'
const HOUSE_LABEL = '\u0e1a\u0e49\u0e32\u0e19'
const EMPTY_LABEL = '\u0e27\u0e48\u0e32\u0e07'
const CHOOSE_LABEL = '\u0e40\u0e25\u0e37\u0e2d\u0e01'

const AREA_SHAPES: AreaShape[] = [
  { id: 'A1', points: [[636,184],[666,285],[741,274],[756,251],[773,269],[814,268],[880,331],[903,391],[900,411],[823,500],[807,501],[785,479],[754,480],[731,513],[676,533],[645,498],[589,486],[542,449],[532,425],[551,369],[587,302],[611,284]], label: { x: 735, y: 390 }, badge: { x: 735, y: 328 } },
  { id: 'A2', points: [[982,314],[993,347],[1037,407],[1135,425],[1139,464],[1063,466],[1032,495],[1002,506],[992,493],[973,493],[967,525],[921,538],[909,589],[884,585],[872,628],[710,548],[752,528],[772,498],[801,520],[849,512],[918,423],[949,399],[954,364],[971,359]], label: { x: 990, y: 512 }, badge: { x: 990, y: 450 } },
  { id: 'A3', points: [[1095,636],[1173,682],[1235,692],[1238,807],[1222,807],[1213,779],[1180,763],[1191,754],[1192,731],[1070,729],[1069,747],[1057,746],[1056,716],[995,676],[976,689],[989,714],[962,714],[919,737],[909,723],[925,704],[925,674],[903,651],[913,659],[934,652],[943,688],[961,699],[982,661],[1024,679],[1022,638],[1068,666]], label: { x: 1065, y: 650 }, badge: { x: 1065, y: 588 }, tension: 0.28 },
  { id: 'A4', points: [[1392,484],[1405,511],[1431,504],[1423,532],[1477,548],[1485,560],[1499,557],[1506,586],[1541,569],[1518,601],[1548,645],[1525,637],[1515,593],[1482,595],[1476,618],[1462,594],[1442,591],[1432,599],[1430,646],[1434,671],[1452,674],[1449,638],[1460,634],[1476,669],[1507,665],[1520,698],[1533,698],[1549,651],[1558,651],[1569,659],[1553,699],[1562,733],[1503,707],[1504,682],[1487,676],[1427,715],[1426,745],[1416,746],[1413,728],[1302,729],[1306,763],[1263,786],[1259,809],[1258,735],[1281,738],[1280,714],[1259,714],[1261,691],[1315,690],[1381,663],[1408,639],[1400,597],[1366,577],[1357,537],[1328,504],[1304,500],[1373,513]], label: { x: 1480, y: 630 }, badge: { x: 1480, y: 568 }, tension: 0.24 },
  { id: 'A5', points: [[1768,490],[1778,490],[1811,542],[1881,605],[1952,723],[1962,782],[1924,812],[1785,839],[1581,747],[1594,719],[1575,705],[1578,685],[1603,645],[1712,618],[1755,556]], label: { x: 1840, y: 665 }, badge: { x: 1840, y: 603 } },
  { id: 'B1', points: [[499,432],[510,471],[631,528],[665,566],[692,579],[622,671],[568,645],[485,726],[419,672],[390,666],[269,746],[253,735],[240,688],[180,663],[185,645],[170,641],[167,602],[184,589],[272,560],[388,450],[452,451]], label: { x: 420, y: 590 }, badge: { x: 420, y: 528 } },
  { id: 'B2', points: [[716,590],[802,622],[896,681],[885,724],[903,764],[929,764],[975,741],[1017,781],[1130,787],[1045,960],[972,990],[906,986],[867,967],[872,939],[823,902],[802,868],[774,757],[690,732],[636,689]], label: { x: 850, y: 735 }, badge: { x: 850, y: 673 } },
  { id: 'B3', points: [[1320,787],[1366,790],[1392,831],[1406,884],[1326,1076],[1324,1210],[1316,1212],[1274,1167],[1135,1070],[1096,1000],[1064,966],[1161,789],[1189,798],[1210,834],[1272,836],[1291,829],[1292,812]], label: { x: 1260, y: 952 }, badge: { x: 1248, y: 890 } },
  { id: 'B4', points: [[1427,902],[1514,977],[1604,1109],[1540,1142],[1550,1154],[1558,1136],[1567,1137],[1568,1181],[1523,1203],[1503,1180],[1472,1189],[1522,1205],[1526,1219],[1557,1236],[1528,1234],[1504,1208],[1473,1202],[1450,1184],[1398,1189],[1361,1206],[1344,1187],[1349,1092]], label: { x: 1556, y: 1092 }, badge: { x: 1556, y: 1030 }, tension: 0.32 },
  { id: 'B5', points: [[1511,734],[1715,840],[1790,865],[1915,848],[1959,828],[1996,789],[2005,827],[1962,912],[1882,1004],[1809,1048],[1672,1059],[1621,1092],[1540,970],[1439,886],[1389,795],[1459,781]], label: { x: 1720, y: 900 }, badge: { x: 1720, y: 838 } },
  { id: 'B6', points: [[1567,459],[1640,468],[1724,494],[1704,576],[1659,603],[1605,604],[1526,511],[1540,501],[1557,513],[1584,504],[1585,481],[1564,471]], label: { x: 1580, y: 505 }, badge: { x: 1580, y: 443 }, tension: 0.3 },
  { id: 'C1', points: [[985,181],[1058,219],[1091,330],[1129,396],[1072,381],[1036,357],[1013,314],[994,235],[974,237],[923,362],[899,300],[843,263],[880,238],[883,272],[920,280],[925,258],[906,253],[926,251],[927,237],[936,271],[950,272],[951,220],[932,217],[925,233],[913,222]], label: { x: 1018, y: 305 }, badge: { x: 1018, y: 243 }, tension: 0.3 },
  { id: 'C2', points: [[1141,200],[1238,258],[1229,363],[1163,405],[1115,321],[1084,214]], label: { x: 1228, y: 315 }, badge: { x: 1228, y: 253 }, tension: 0.3 },
  { id: 'C3', points: [[1345,148],[1364,181],[1454,216],[1503,314],[1567,381],[1597,436],[1419,416],[1346,274],[1164,180],[1259,186]], label: { x: 1390, y: 295 }, badge: { x: 1390, y: 233 }, tension: 0.3 },
  { id: 'C4', points: [[1579,346],[1610,353],[1614,375],[1628,375],[1638,354],[1661,385],[1724,430],[1728,450],[1629,440]], label: { x: 1640, y: 360 }, badge: { x: 1640, y: 298 }, tension: 0.28 },
  { id: 'C5', points: [[396,694],[430,737],[477,758],[356,922],[251,913],[211,895],[141,884],[304,778],[302,813],[316,845],[387,844],[400,827],[391,785],[320,763]], label: { x: 300, y: 835 }, badge: { x: 300, y: 773 }, tension: 0.3 },
  { id: 'C6', points: [[583,683],[646,742],[722,781],[581,966],[542,1044],[519,1066],[493,1068],[476,1034],[428,1009],[394,976],[336,971],[349,949],[375,940],[446,853],[499,765],[516,759]], label: { x: 555, y: 895 }, badge: { x: 555, y: 833 } },
  { id: 'C7', points: [[740,802],[757,857],[828,962],[829,988],[935,1029],[967,1031],[851,1151],[847,1142],[827,1151],[734,1119],[525,1093],[560,1077],[606,982]], label: { x: 760, y: 990 }, badge: { x: 760, y: 928 } },
  { id: 'C8', points: [[1049,994],[1072,1016],[1106,1086],[1139,1120],[1278,1219],[1232,1241],[1196,1279],[1119,1328],[1098,1283],[1023,1261],[936,1270],[822,1256],[773,1268],[747,1257],[758,1238],[881,1165],[943,1091]], label: { x: 1020, y: 1188 }, badge: { x: 1020, y: 1126 } },
  { id: 'C9', points: [[402,1075],[482,1110],[428,1106],[407,1129],[405,1160],[418,1182],[454,1182],[462,1164],[477,1164],[473,1187],[458,1190],[451,1205],[447,1237],[433,1242],[413,1234],[411,1202],[385,1142],[381,1085]], label: { x: 440, y: 1160 }, badge: { x: 440, y: 1098 }, tension: 0.28 },
  { id: 'KING', points: [[1259,473],[1267,475],[1270,511],[1331,541],[1335,582],[1374,617],[1293,665],[1204,667],[1120,610],[1143,583],[1155,534],[1214,508],[1214,477]], label: { x: 1308, y: 615 }, badge: { x: 1308, y: 553 }, tension: 0.36 },
]

type AreaStatus = 'normal' | 'disaster' | 'eradicated'

function formatPoint(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function smoothClosedPath(points: AreaShape['points'], tension = 0.45) {
  if (!points.length) return ''
  if (points.length < 3) return points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ') + ' Z'

  const commands = [`M${points[0][0]} ${points[0][1]}`]
  const size = points.length
  const curve = tension / 6

  for (let i = 0; i < size; i++) {
    const p0 = points[(i - 1 + size) % size]
    const p1 = points[i]
    const p2 = points[(i + 1) % size]
    const p3 = points[(i + 2) % size]
    const cp1x = p1[0] + (p2[0] - p0[0]) * curve
    const cp1y = p1[1] + (p2[1] - p0[1]) * curve
    const cp2x = p2[0] - (p3[0] - p1[0]) * curve
    const cp2y = p2[1] - (p3[1] - p1[1]) * curve
    commands.push(
      `C${formatPoint(cp1x)} ${formatPoint(cp1y)} ${formatPoint(cp2x)} ${formatPoint(cp2y)} ${p2[0]} ${p2[1]}`,
    )
  }

  commands.push('Z')
  return commands.join(' ')
}

function parseSvgViewBox(value: string | null) {
  const parts = String(value ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return null
  const [minX, minY, width, height] = parts
  if (width <= 0 || height <= 0) return null
  return { minX, minY, width, height }
}

function polygonPointsToPath(points: string | null) {
  const coords = String(points ?? '')
    .trim()
    .split(/\s+/)
    .map(point => point.split(',').map(Number))
    .filter(point => point.length === 2 && point.every(Number.isFinite))
  if (coords.length < 3) return ''
  return coords.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ') + ' Z'
}

function parseZoneSvg(text: string): Record<string, SvgZone> | null {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return null

  const viewBox = parseSvgViewBox(doc.documentElement.getAttribute('viewBox'))
  if (!viewBox) return null

  const scaleX = VIEWBOX_WIDTH / viewBox.width
  const scaleY = VIEWBOX_HEIGHT / viewBox.height
  const transform = `matrix(${scaleX} 0 0 ${scaleY} ${-viewBox.minX * scaleX} ${-viewBox.minY * scaleY})`
  const zones: Record<string, SvgZone> = {}

  AREA_SHAPES.forEach(shape => {
    const element = doc.getElementById(shape.id)
    if (!element) return

    const tag = element.tagName.toLowerCase()
    const d = tag === 'polygon'
      ? polygonPointsToPath(element.getAttribute('points'))
      : element.getAttribute('d')?.trim() ?? ''
    if (d) zones[shape.id] = { d, transform }
  })

  return Object.keys(zones).length ? zones : null
}

function ownerBadgeColors(owner: number, status: AreaStatus) {
  if (status === 'disaster') return { bg: '#ffffff', fg: '#dc2626', stroke: '#dc2626' }
  if (status === 'eradicated') return { bg: '#ffffff', fg: '#1d4ed8', stroke: '#1d4ed8' }
  return {
    bg: HOUSE_COLORS[owner] ?? '#ffffff',
    fg: HOUSE_TEXT_COLORS[owner] ?? '#111827',
    stroke: 'rgba(15, 23, 42, 0.32)',
  }
}

function shapeTitle(area: string, owner: number, disasters: number[], status: AreaStatus) {
  return [
    area,
    owner ? `${HOUSE_LABEL} ${owner}` : EMPTY_LABEL,
    status === 'disaster' ? 'disaster-ed' : '',
    status === 'eradicated' ? 'eradicated' : '',
    disasters.length ? `Disaster ${disasters.join(', ')}` : '',
  ].filter(Boolean).join(' - ')
}

function ImageGameMap({
  ownership,
  disasterOwnership = {},
  eradicatedOwnership = {},
  selected = [],
  onSelect,
  filterDisaster,
  readOnly,
  kingDisaster,
  kingDisasterTone = 'result',
  currentKing = null,
  kingOwner = null,
  compact,
}: MapProps) {
  const [svgZones, setSvgZones] = useState<Record<string, SvgZone> | null>(null)
  const filterSet = filterDisaster != null ? getAffected(filterDisaster) : null
  const isFilterMode = filterSet != null
  const kingSet = kingDisaster != null ? getAffected(kingDisaster) : null
  const hasSheetDisasterOwnership = Object.keys(disasterOwnership).length > 0
  const canClick = !readOnly && typeof onSelect === 'function'
  const orderedShapes = [...AREA_SHAPES].sort(
    (a, b) => Number(selected.includes(a.id)) - Number(selected.includes(b.id)),
  )

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    fetch(SVG_ZONE_PATH, { cache: 'no-store', signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load ${SVG_ZONE_PATH}: ${res.status}`)
        return res.text()
      })
      .then(text => {
        if (cancelled) return
        const zones = parseZoneSvg(text)
        if (zones) setSvgZones(zones)
      })
      .catch(error => {
        if ((error as { name?: string })?.name !== 'AbortError') {
          console.warn('Image map SVG zones unavailable, using fallback shapes.', error)
        }
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  const activateArea = (area: string) => {
    if (canClick) onSelect?.(area)
  }

  const handleAreaKeyDown = (area: string, event: KeyboardEvent<SVGGElement>) => {
    if (!canClick) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activateArea(area)
    }
  }

  const mapItems = orderedShapes.map(shape => {
    const isKingIsland = shape.id === 'KING'
    const currentOwner = isKingIsland ? kingOwner ?? currentKing ?? ownership[shape.id] ?? 0 : ownership[shape.id] || 0
    const disasterOwner = isKingIsland ? 0 : disasterOwnership[shape.id] || 0
    const eradicatedOwner = isKingIsland ? 0 : eradicatedOwnership[shape.id] || 0
    const owner = eradicatedOwner || disasterOwner || currentOwner
    const isSheetDisastered = disasterOwner > 0
    const isEradicated = eradicatedOwner > 0
    const status: AreaStatus = isSheetDisastered ? 'disaster' : isEradicated ? 'eradicated' : 'normal'
    const isSelected = selected.includes(shape.id)
    const disasters = getAreaDisasters(shape.id)
    const isFiltered = filterSet?.has(shape.id) ?? false
    const isKingHitByRule = kingSet?.has(shape.id) ?? false
    const isKingHit = isKingHitByRule && (kingDisasterTone === 'selection' || !hasSheetDisasterOwnership)
    const dimmed = isFilterMode && !isFiltered
    const labelColor = isSheetDisastered ? '#dc2626' : isEradicated ? '#1d4ed8' : isKingIsland ? '#744b00' : '#111827'
    const hasHighlight = isSelected || isFiltered || isKingHit || isSheetDisastered || isEradicated
    const outlineColor = isFiltered || (isKingHit && kingDisasterTone === 'selection')
      ? '#06b6d4'
      : isSheetDisastered
        ? '#dc2626'
        : isEradicated
          ? '#1d4ed8'
          : isSelected
            ? '#f59e0b'
            : 'rgba(15, 23, 42, 0)'
    const fillColor = isSheetDisastered
      ? 'rgba(254, 226, 226, 0.34)'
      : isEradicated
        ? 'rgba(219, 234, 254, 0.34)'
        : isKingHit && kingDisasterTone === 'selection'
          ? 'rgba(8, 145, 178, 0.18)'
          : isSelected
            ? 'rgba(245, 158, 11, 0.18)'
            : isFiltered
              ? 'rgba(6, 182, 212, 0.12)'
              : 'rgba(255, 255, 255, 0.001)'
    const svgZone = svgZones?.[shape.id]
    const path = svgZone?.d ?? smoothClosedPath(shape.points, shape.tension)
    const badge = owner > 0 ? ownerBadgeColors(owner, status) : null
    const title = shapeTitle(shape.id, owner, disasters, status)

    return {
      shape,
      owner,
      disasters,
      status,
      isKingIsland,
      isSelected,
      isFiltered,
      isKingHit,
      dimmed,
      labelColor,
      hasHighlight,
      outlineColor,
      fillColor,
      svgZone,
      path,
      badge,
      title,
    }
  })

  return (
    <div className={clsx('image-game-map game-map select-none', compact ? 'game-map-compact' : 'game-map-regular')}>
      {kingDisaster != null && currentKing != null && !filterDisaster && (
        <div className="map-king-disaster-notice">
          <span>{`King ${HOUSE_LABEL} ${currentKing} ${CHOOSE_LABEL} disaster ${kingDisaster}`}</span>
        </div>
      )}
      <div className="image-game-map-scroll">
        <div
          className="image-game-map-stage"
          style={{ position: 'relative', aspectRatio: `${VIEWBOX_WIDTH} / ${VIEWBOX_HEIGHT}`, '--map-viewbox-width': VIEWBOX_WIDTH, '--map-viewbox-height': VIEWBOX_HEIGHT } as CSSProperties}
        >
          <svg
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            className="image-game-map-svg"
            style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }}
            aria-label="Interactive island map"
          >
            <image
              href="/maps/biggame-island-map.png"
              x={0}
              y={0}
              width={VIEWBOX_WIDTH}
              height={VIEWBOX_HEIGHT}
              preserveAspectRatio="none"
              className="image-game-map-raster"
              pointerEvents="none"
            />
            <g className="image-map-hit-layer">
              {mapItems.map(item => (
                <g
                  key={item.shape.id}
                  className={clsx(
                    'image-map-area',
                    canClick && 'is-clickable',
                    item.isSelected && 'is-selected',
                    item.isFiltered && 'is-filtered',
                    item.isKingHit && 'is-king-hit',
                    item.dimmed && 'is-dimmed',
                  )}
                  role={canClick ? 'button' : undefined}
                  tabIndex={canClick ? 0 : undefined}
                  aria-label={item.title}
                  onClick={() => activateArea(item.shape.id)}
                  onKeyDown={event => handleAreaKeyDown(item.shape.id, event)}
                >
                  <title>{item.title}</title>
                  <path
                    d={item.path}
                    transform={item.svgZone?.transform}
                    className="image-map-area-shape"
                    fill={item.fillColor}
                    stroke={item.outlineColor}
                    strokeWidth={item.hasHighlight ? 4.5 : 0.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </g>
            <g className="image-map-info-layer" pointerEvents="none" aria-hidden="true">
              {mapItems.map(item => (
                <g key={`${item.shape.id}-info`} className="image-map-area-info">
                  {item.badge && (
                    <g className="image-map-owner-badge">
                      <rect
                        x={item.shape.badge.x - 58}
                        y={item.shape.badge.y - 18}
                        width={116}
                        height={30}
                        rx={10}
                        fill={item.badge.bg}
                        stroke={item.badge.stroke}
                        strokeWidth={2.5}
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={item.shape.badge.x}
                        y={item.shape.badge.y - 3}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={item.badge.fg}
                        className={clsx('image-map-owner-text', item.status === 'disaster' && 'is-disastered', item.status === 'eradicated' && 'is-eradicated')}
                      >
                        {HOUSE_LABEL} {item.owner}
                      </text>
                    </g>
                  )}
                  <text
                    x={item.shape.label.x}
                    y={item.shape.label.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={item.labelColor}
                    className={clsx('image-map-area-label', item.isKingIsland && 'is-king-label', item.status === 'disaster' && 'is-disastered', item.status === 'eradicated' && 'is-eradicated')}
                  >
                    {item.isKingIsland ? 'KING' : item.shape.id}
                  </text>
                  {item.disasters.length > 0 && (
                    <g className="image-map-disaster-ids">
                      <rect
                        x={item.shape.label.x - 30}
                        y={item.shape.label.y + 34}
                        width={60}
                        height={21}
                        rx={7}
                        fill="#facc15"
                        stroke="#854d0e"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={item.shape.label.x}
                        y={item.shape.label.y + 44}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#111827"
                        className="image-map-disaster-text"
                      >
                        {item.disasters.slice(0, 3).join(',')}
                      </text>
                    </g>
                  )}
                </g>
              ))}
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}

export default memo(ImageGameMap)
