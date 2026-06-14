'use client'

import GameMap, { type MapProps } from '@/components/GameMap'
import ImageGameMap from '@/components/ImageGameMap'
import { normalizeMapMode, type MapMode } from '@/lib/constants'

interface GameMapViewProps extends MapProps {
  mode?: MapMode | null
}

export default function GameMapView({ mode, ...props }: GameMapViewProps) {
  const mapMode = normalizeMapMode(mode)

  if (mapMode === 'image') {
    return <ImageGameMap {...props} />
  }

  if (mapMode === 'both') {
    return (
      <div className="map-mode-stack">
        <ImageGameMap {...props} />
        <GameMap {...props} />
      </div>
    )
  }

  return <GameMap {...props} />
}
