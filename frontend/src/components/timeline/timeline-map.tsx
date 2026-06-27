'use client'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { type PlaceItem, type Metric } from '@/components/timeline/timeline-shared'

type MapPoint = PlaceItem & { lat: number; lng: number }

// 日本中心の既定ビュー（ピン0件時）
const JP_CENTER: [number, number] = [36.2, 138.2]
const JP_ZOOM = 5

function makeIcon(radius: number, selected: boolean) {
  const size = radius * 2
  const color = selected ? 'var(--chart-4)' : 'var(--chart-2)'
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:9999px;
      background:${color};opacity:${selected ? 0.95 : 0.7};
      border:2px solid ${selected ? '#ffffff' : 'rgba(255,255,255,0.6)'};
      box-shadow:0 0 0 1px rgba(0,0,0,0.35);"></div>`,
    iconSize: [size, size],
    iconAnchor: [radius, radius],
    popupAnchor: [0, -radius],
  })
}

// items 変化時に表示中ピンへフィット。0件時は日本既定ビュー
function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) {
      map.setView(JP_CENTER, JP_ZOOM)
      return
    }
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 14)
      return
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]))
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
  }, [points, map])
  return null
}

export default function TimelineMap({
  items,
  metric,
  selectedName,
  onSelect,
}: {
  items: PlaceItem[]
  metric: Metric
  selectedName: string | null
  onSelect: (name: string) => void
}) {
  const points = useMemo(
    () => items.filter((i): i is MapPoint => i.lat != null && i.lng != null),
    [items]
  )
  const maxVal = useMemo(
    () => Math.max(...points.map((p) => (metric === 'hours' ? p.hours : p.visits)), 1),
    [points, metric]
  )

  return (
    <MapContainer
      center={JP_CENTER}
      zoom={JP_ZOOM}
      scrollWheelZoom
      className="h-[600px] w-full rounded-md border z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} />
      {points.map((p) => {
        const v = metric === 'hours' ? p.hours : p.visits
        const radius = 6 + (v / maxVal) * 18
        const selected = p.name === selectedName
        return (
          <Marker
            key={p.placeId || p.name}
            position={[p.lat, p.lng]}
            icon={makeIcon(radius, selected)}
            zIndexOffset={selected ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(p.name) }}
          >
            <Popup>
              <div className="text-xs">
                <div className="font-semibold mb-0.5">{p.name}</div>
                <div className="tabular-nums">
                  {p.hours.toFixed(1)}h / {p.visits}回
                </div>
              </div>
            </Popup>
          </Marker>
        )
      })}
    </MapContainer>
  )
}
