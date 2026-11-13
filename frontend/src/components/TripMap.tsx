import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { Day, Item, Meta, Trip } from '../types'

type LatLng = [number, number]

function route(day: Day | undefined): LatLng[][] {
  if (!day) return []
  return day.items
    .filter((i) => i.type === 'transfer' && !i.intercity && i.frm?.lat && i.to?.lat)
    .map((i) => [[i.frm!.lat!, i.frm!.lng!], [i.to!.lat!, i.to!.lng!]] as LatLng[])
}

const pin = (label: string, cls: string) =>
  L.divIcon({ className: '', html: `<div class="pin ${cls}">${label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] })

function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap()
  const key = points.map((p) => p.join(',')).join('|')
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 14 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])
  return null
}

export default function TripMap({ trip, day, meta }: { trip: Trip; day: number; meta: Meta }) {
  const cur = trip.days.find((d) => d.day === day)
  const base = trip.baseline_days.find((d) => d.day === day)
  const stay = meta.stays.find((s) => s.id === trip.profile.stay_id)
  const station = meta.city.station

  const curRoute = useMemo(() => route(cur), [cur])
  const baseRoute = useMemo(() => (trip.banner.active ? route(base) : []), [base, trip.banner.active])
  const stops = (cur?.items ?? []).filter((i) => (i.type === 'visit' || i.type === 'meal') && i.lat)
  const curIds = new Set(stops.map((s) => s.attraction_id))
  const lostStops = trip.banner.active
    ? (base?.items ?? []).filter((i) => i.type === 'visit' && i.lat && !curIds.has(i.attraction_id))
    : []
  const points: LatLng[] = [...curRoute.flat(), ...baseRoute.flat()]
  if (stay) points.push([stay.lat, stay.lng])

  let n = 0
  const stopIcon = (s: Item) => {
    if (s.type === 'meal') return pin('🍛', 'pin-meal')
    n += 1
    const cls = s.status === 'rescued' ? 'pin-rescued' : s.status === 'moved' ? 'pin-moved' : 'pin-active'
    return pin(String(n), cls)
  }

  return (
    <section className="card map-card">
      <MapContainer center={meta.city.center} zoom={12} scrollWheelZoom={false} className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {baseRoute.map((seg, i) => (
          <Polyline key={`b${i}`} positions={seg} pathOptions={{ color: '#8a94a6', weight: 3, dashArray: '6 8', opacity: 0.9 }} />
        ))}
        {curRoute.map((seg, i) => (
          <Polyline key={`c${i}`} positions={seg} pathOptions={{ color: '#2347d8', weight: 4, opacity: 0.85 }} />
        ))}
        {stay && (
          <Marker position={[stay.lat, stay.lng]} icon={pin('🏨', 'pin-base')}>
            <Tooltip>{stay.name}</Tooltip>
          </Marker>
        )}
        {station.lat && (
          <Marker position={[station.lat, station.lng!]} icon={pin('🚉', 'pin-base')}>
            <Tooltip>{station.name}</Tooltip>
          </Marker>
        )}
        {lostStops.map((s) => (
          <Marker key={`l${s.id}`} position={[s.lat!, s.lng!]} icon={pin('×', 'pin-lost')}>
            <Tooltip>{s.title}: moved or dropped by the re-plan</Tooltip>
          </Marker>
        ))}
        {stops.map((s) => (
          <Marker key={s.id} position={[s.lat!, s.lng!]} icon={stopIcon(s)}>
            <Popup>
              <b>{s.title}</b>
              <br />
              {s.start}–{s.end}
              {s.status !== 'normal' && <><br /><i>{s.status}</i></>}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="legend small">
        <span><i className="lg lg-active" /> Active route</span>
        <span><i className="lg lg-rescued" /> Rescued / Plan B</span>
        <span><i className="lg lg-moved" /> Moved</span>
        {trip.banner.active && <span><i className="lg lg-base" /> Original route</span>}
      </div>
    </section>
  )
}
