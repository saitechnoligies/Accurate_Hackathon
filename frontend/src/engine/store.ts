/* In-browser replacement for the FastAPI + MongoDB backend.
   Same operations as the REST API; state lives in localStorage (falls back to memory). */
import type { Disruptions, LearningState, Meta, Profile, SimResult, Trip } from '../types'
import {
  ATTRACTIONS, CITY, CORRIDOR_BUFFERS, DEFAULT_WEIGHTS, HOMES, MODES, ORIGIN, PERSONAS, STAYS, TRAINS, ZONES,
  type Catalog,
} from './data'
import { corridorKey } from './geo'
import { features, simulate as runSim, update, updateCorridor } from './learning'
import { makeProfile } from './profile'
import { buildView } from './replan'
import { type NormDisruptions, normalizeDisruptions } from './scheduler'

const KEY = 'delayproof.store.v1'
const DB_MODE = 'browser'

type Corridor = { buffer: number; initial: number; samples: number }
type StoredTrip = {
  _id: string; profile: Profile; disruptions: NormDisruptions; feedback: Record<string, 'kept' | 'skipped'>
  ride_logs: unknown[]; created_at: string; updated_at: string
}
type State = {
  trips: Record<string, StoredTrip>
  model: { weights: Record<string, number>; tag_affinity: Record<string, Record<string, number>>; updates: number }
  corridors: Record<string, Corridor>
  feedback: { real: number; synthetic: number }
}

const freshLearning = (): Pick<State, 'model' | 'corridors' | 'feedback'> => ({
  model: { weights: { ...DEFAULT_WEIGHTS }, tag_affinity: {}, updates: 0 },
  corridors: Object.fromEntries(Object.entries(CORRIDOR_BUFFERS).map(([k, v]) => [k, { buffer: v, initial: v, samples: 0 }])),
  feedback: { real: 0, synthetic: 0 },
})

let memory: State | null = null

function load(): State {
  if (memory) return memory
  let s: State | null = null
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) s = JSON.parse(raw) as State
  } catch {
    /* storage unavailable or corrupt */
  }
  memory = s && s.model && s.corridors ? s : { trips: {}, ...freshLearning() }
  return memory
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    /* private mode / quota: keep working in memory */
  }
}

const now = () => new Date().toISOString()
const newId = () => Math.random().toString(16).slice(2, 12).padEnd(10, '0')
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

function catalog(): Catalog {
  const s = load()
  return {
    attractions: ATTRACTIONS,
    stays: STAYS,
    trains: TRAINS,
    personas: PERSONAS,
    corridors: Object.fromEntries(Object.entries(s.corridors).map(([k, c]) => [k, c.buffer])),
    weights: { ...s.model.weights },
    tag_affinity: clone(s.model.tag_affinity),
  }
}

function getTrip(id: string): StoredTrip {
  const t = load().trips[id]
  if (!t) throw new Error('Trip not found')
  return t
}

function tripView(t: StoredTrip, message: string | null = null): Trip {
  const view = buildView(catalog(), t.profile, t.disruptions)
  return { trip_id: t._id, profile: clone(t.profile), feedback: { ...t.feedback }, message, ...view }
}

function touch(t: StoredTrip) {
  t.updated_at = now()
  save()
}

function learningState(): LearningState {
  const s = load()
  return {
    weights: { ...s.model.weights },
    defaults: { ...DEFAULT_WEIGHTS },
    tag_affinity: clone(s.model.tag_affinity),
    updates: s.model.updates,
    corridors: Object.entries(s.corridors)
      .map(([corridor, c]) => ({ corridor, ...c }))
      .sort((a, b) => a.corridor.localeCompare(b.corridor)),
    feedback: { ...s.feedback },
    db: DB_MODE,
  }
}

/** Run synchronously but resolve asynchronously, like the network calls it replaces. */
const later = <T,>(fn: () => T): Promise<T> =>
  new Promise((resolve, reject) => setTimeout(() => {
    try {
      resolve(fn())
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  }, 0))

export type TripOptions = { persona_id: string; days?: number; budget?: number; travelers?: number }
export type RideLog = { from_zone: string; to_zone: string; planned_min: number; actual_min: number; buffer_used?: number }

export const api = {
  meta: () => later((): Meta => ({
    city: CITY,
    personas: PERSONAS,
    stays: STAYS,
    attractions: ATTRACTIONS,
    modes: MODES,
    interests: [...new Set(ATTRACTIONS.flatMap((a) => a.tags))].sort(),
    db: DB_MODE,
    ...{ origin: ORIGIN, zones: ZONES, homes: HOMES, trains: TRAINS },
  })),

  createTrip: (opts: TripOptions) => later(() => {
    const profile = makeProfile(catalog(), opts.persona_id, opts)
    const t: StoredTrip = { _id: newId(), profile, disruptions: normalizeDisruptions({}), feedback: {}, ride_logs: [],
      created_at: now(), updated_at: now() }
    load().trips[t._id] = t
    save()
    return tripView(t)
  }),

  trip: (id: string) => later(() => tripView(getTrip(id))),

  disrupt: (id: string, patch: Partial<Disruptions>) => later(() => {
    const t = getTrip(id)
    const d = { ...t.disruptions } as Record<string, unknown>
    for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null) d[k] = v
    t.disruptions = normalizeDisruptions(d as Partial<Disruptions>)
    touch(t)
    return tripView(t)
  }),

  reset: (id: string) => later(() => {
    const t = getTrip(id)
    t.disruptions = normalizeDisruptions({})
    t.feedback = {}
    touch(t)
    return tripView(t, 'Plan reset to the original package.')
  }),

  swap: (id: string, attractionId: string) => later(() => {
    const t = getTrip(id)
    const view = tripView(t)
    const it = view.days.flatMap((d) => d.items).find((x) => x.attraction_id === attractionId && x.type === 'visit')
    if (!it || !it.plan_b) throw new Error('No Plan B available for this stop')
    const d = normalizeDisruptions(t.disruptions)
    d.swaps[attractionId] = it.plan_b.id
    d.swap_days[it.plan_b.id] = it.day
    t.disruptions = d
    touch(t)
    return tripView(t, `Swapped ${it.title} for ${it.plan_b.name} (${it.plan_b.reason}).`)
  }),

  feedback: (id: string, attractionId: string, action: 'kept' | 'skipped') => later(() => {
    const t = getTrip(id)
    const a = ATTRACTIONS.find((x) => x.id === attractionId)
    if (!a) throw new Error('Unknown attraction')
    const s = load()
    const weights = s.model.weights
    const affAll = s.model.tag_affinity
    const aff = affAll[t.profile.persona_id] ?? {}
    const before = { ...weights }
    const p = update(weights, aff, features(a, t.profile.interests, t.profile.travelers), action === 'kept')
    affAll[t.profile.persona_id] = aff
    s.model.updates += 1
    s.feedback.real += 1
    t.feedback[a.id] = action
    const d = normalizeDisruptions(t.disruptions)
    if (action === 'skipped' && !d.skipped.includes(a.id)) d.skipped.push(a.id)
    t.disruptions = d
    touch(t)
    const delta = Object.fromEntries(['interest', 'flagship', 'budget', 'travel']
      .map((k) => [k, Math.round((weights[k] - before[k]) * 10000) / 10000]))
    let msg = `Marked ${a.name} as ${action}. Model predicted keep-probability ${Math.round(p * 100)}%; weights nudged `
      + Object.entries(delta).filter(([, v]) => v).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ') + '.'
    if (action === 'skipped') msg += ' Re-planned without it.'
    return { ...tripView(t, msg), learning_delta: delta }
  }),

  rideLog: (id: string, req: RideLog) => later(() => {
    const t = getTrip(id)
    const s = load()
    const key = corridorKey(req.from_zone, req.to_zone)
    const doc = s.corridors[key] ?? { buffer: 6, initial: 6, samples: 0 }
    const used = req.buffer_used ?? doc.buffer
    const next = updateCorridor(doc.buffer, req.planned_min - used, req.actual_min)
    const old = doc.buffer
    s.corridors[key] = { ...doc, buffer: next, samples: doc.samples + 1 }
    t.ride_logs.push({ ...req, at: now() })
    touch(t)
    return tripView(t, `Logged ride on ${key.replace('|', ' ↔ ')}: buffer ${old.toFixed(1)} → ${next.toFixed(1)} min `
      + `(you took ${req.actual_min.toFixed(0)} min vs ${req.planned_min.toFixed(0)} planned).`)
  }),

  learning: () => later(learningState),

  setWeights: (w: Record<string, number>) => later(() => {
    const weights = load().model.weights
    for (const [k, v] of Object.entries(w)) if (k in weights) weights[k] = Math.max(0, Math.min(3, Number(v)))
    save()
    return learningState()
  }),

  simulate: (personaId: string, apply: boolean, n = 400) => later((): SimResult => {
    const persona = PERSONAS.find((p) => p.id === personaId)
    if (!persona) throw new Error(`Unknown persona ${personaId}`)
    const { events, ...result } = runSim(catalog(), persona, n)
    if (apply) {
      const s = load()
      s.model.weights = { ...s.model.weights, ...result.weights_after }
      s.model.tag_affinity[personaId] = result.tag_affinity_after
      s.model.updates += events.length
      for (const [k, buf] of Object.entries(result.corridors.learned)) {
        const c = s.corridors[k] ?? { buffer: 6, initial: 6, samples: 0 }
        s.corridors[k] = { ...c, buffer: buf, samples: c.samples + 1 }
      }
      s.feedback.synthetic += events.length
      save()
    }
    return { ...result, applied: apply }
  }),

  resetLearning: () => later(() => {
    Object.assign(load(), freshLearning())
    save()
    return learningState()
  }),
}
