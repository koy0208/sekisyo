'use client'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import { type DayEvent } from '@/components/timeline/timeline-shared'

// 日本中心の既定ビュー（ポイント0件時）
const JP_CENTER: [number, number] = [36.2, 138.2]
const JP_ZOOM = 5

// 滞在の訪問順を示す番号付きピン
function numberIcon(no: number) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:24px;height:24px;border-radius:9999px;
      background:var(--chart-2);color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:600;
      border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.35);">${no}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  })
}

// events 変化時に経路全体へフィット。0件時は日本既定ビュー
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) {
      map.setView(JP_CENTER, JP_ZOOM)
      return
    }
    if (points.length === 1) {
      map.setView(points[0], 14)
      return
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 })
  }, [points, map])
  return null
}

export default function DayRouteMap({ events }: { events: DayEvent[] }) {
  // 時系列順の経路座標（visit は滞在地点、move は始点→終点）
  const path = useMemo(() => {
    const pts: [number, number][] = []
    for (const e of events) {
      if (e.lat != null && e.lng != null) pts.push([e.lat, e.lng])
      if (e.kind === 'move' && e.endLat != null && e.endLng != null) pts.push([e.endLat, e.endLng])
    }
    return pts
  }, [events])

  // 番号付きピンは滞在のみ（訪問順）
  const visitPoints = useMemo(() => {
    let no = 0
    return events
      .filter((e) => e.kind === 'visit')
      .map((e) => ({ ...e, no: ++no }))
      .filter((e): e is DayEvent & { no: number; lat: number; lng: number } => e.lat != null && e.lng != null)
  }, [events])

  return (
    <MapContainer
      center={JP_CENTER}
      zoom={JP_ZOOM}
      scrollWheelZoom
      className="h-[480px] w-full rounded-md border z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={path} />
      {path.length >= 2 && (
        <Polyline positions={path} pathOptions={{ color: 'var(--chart-1)', weight: 3, opacity: 0.7, dashArray: '6 6' }} />
      )}
      {visitPoints.map((p, i) => (
        <Marker key={`${p.placeId || p.label}-${i}`} position={[p.lat, p.lng]} icon={numberIcon(p.no)}>
          <Popup>
            <div className="text-xs">
              <div className="font-semibold mb-0.5">{p.no}. {p.label}</div>
              <div className="tabular-nums">
                {p.in} – {p.out}（{p.dur}分）
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
