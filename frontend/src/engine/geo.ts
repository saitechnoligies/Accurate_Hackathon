/* Time helpers and the local travel model (hill physics + congestion + learned buffers). */
import { DEFAULT_BUFFER, MODES, ZONES } from './data'

const ROAD_FACTOR = 1.3 // straight line -> road distance
const HILL_MULT = 1.35 // winding ghat roads up to Amber / Nahargarh
const CONGESTION_MULT = 1.2 // narrow Old City lanes

/** Python-style round (half to even) so results match the reference engine. */
export function pyRound(x: number, nd = 0): number {
  const f = 10 ** nd
  const m = x * f
  let r = Math.round(m)
  if (Math.abs(m % 1) === 0.5) r = 2 * Math.round(m / 2)
  return nd ? r / f : r
}

export const t2m = (t: string): number => {
  const [h, m] = t.split(':')
  return Number(h) * 60 + Number(m)
}

const pad = (n: number) => String(n).padStart(2, '0')

export function m2t(m: number): string {
  m = pyRound(m)
  const dayShift = Math.floor(m / 1440)
  m = ((m % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}` + (dayShift ? ' (+1)' : '')
}

export type Loc = { lat: number; lng: number; zone?: string; name?: string; id?: string }

export function haversineKm(a: Loc, b: Loc): number {
  const r = 6371.0
  const rad = (d: number) => (d * Math.PI) / 180
  const [lat1, lng1, lat2, lng2] = [a.lat, a.lng, b.lat, b.lng].map(rad)
  const dlat = lat2 - lat1
  const dlng = lng2 - lng1
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlng / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(h))
}

export const corridorKey = (z1: string, z2: string) => [z1, z2].sort().join('|')

export const round5 = (x: number) => 5 * pyRound(x / 5)

export type Leg = {
  mode: string; km: number; minutes: number; base_minutes: number; buffer: number; cost: number
  hill: boolean; congested: boolean
}

/** Travel estimate between two located places. */
export function travel(a: Loc, b: Loc, mode: string, travelers: number, corridors: Record<string, number>): Leg | null {
  const spec = MODES[mode]
  const km = haversineKm(a, b) * ROAD_FACTOR
  const za = a.zone ?? 'central'
  const zb = b.zone ?? 'central'
  const hill = Boolean(ZONES[za]?.hill || ZONES[zb]?.hill)
  const hillClimb = hill && za !== zb
  const congested = Boolean(ZONES[za]?.congested || ZONES[zb]?.congested)

  if (mode === 'walk') {
    if (km > (spec.max_km ?? 0) || hillClimb) return null
    const minutes = (km / spec.speed) * 60
    return { mode, km: pyRound(km, 2), minutes: Math.max(3, pyRound(minutes)), base_minutes: pyRound(minutes),
      buffer: 0, cost: 0, hill: false, congested: false }
  }

  if (km < 0.4) return null // don't take a vehicle for a few hundred metres

  let mult = 1.0
  if (hillClimb) mult *= HILL_MULT
  if (congested) mult *= CONGESTION_MULT
  const base = (km / spec.speed) * 60 * mult
  const buffer = corridors[corridorKey(za, zb)] ?? DEFAULT_BUFFER
  const minutes = spec.wait + base + buffer

  let cost: number
  if (spec.per_person) cost = spec.base * travelers
  else cost = Math.ceil(travelers / spec.capacity) * (spec.base + spec.per_km * km)
  return { mode, km: pyRound(km, 2), minutes: pyRound(minutes), base_minutes: pyRound(spec.wait + base),
    buffer: pyRound(buffer, 1), cost: round5(cost), hill: hillClimb, congested }
}
