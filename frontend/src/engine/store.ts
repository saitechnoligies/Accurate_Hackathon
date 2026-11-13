/* In-browser replacement for the FastAPI + MongoDB backend.
   Same operations as the REST API on `main`; state lives in localStorage (files in IndexedDB).
   Every tab of the same browser shares the data, and changes are pushed to the other tabs with a
   BroadcastChannel, so two windows behave like two friends on a live, shared trip. */
import type {
  AgentCreate, AgentReply, AgentState, Disruptions, JournalEntry, LearningState, Member, Memory, Message, Meta, Poll,
  Prefs, Profile, SimResult, Ticket, Trip, TripEvent, TripSummary, User,
} from '../types'
import { runAgent, type AgentTools } from './agent'
import {
  ATTRACTIONS, CITY, CORRIDOR_BUFFERS, DEFAULT_WEIGHTS, HOMES, MODES, ORIGIN, PERSONAS, STAYS, TRAINS, ZONES,
  type Catalog,
} from './data'
import { corridorKey } from './geo'
import { delFile, getFile, putFile } from './idb'
import { features, simulate as runSim, update, updateCorridor } from './learning'
import { makeProfile, type ProfileOverrides } from './profile'
import { buildView } from './replan'
import { type NormDisruptions, normalizeDisruptions } from './scheduler'
import { DEFAULT_PREFS, DEMO_USERS } from './users'

const KEY = 'delayproof.store.v2'
const DB_MODE = 'browser'

type Corridor = { buffer: number; initial: number; samples: number }
type StoredTrip = {
  _id: string; title: string; owner_id: string; members: Member[]; mode_on: boolean; invite_code: string
  profile: Profile; disruptions: NormDisruptions; feedback: Record<string, 'kept' | 'skipped'>
  ride_logs: unknown[]; created_at: string; updated_at: string
}
type StoredTicket = Omit<Ticket, 'file'> & { file_id?: string }
type StoredMemory = Omit<Memory, 'photo'> & { file_id?: string }
type State = {
  trips: Record<string, StoredTrip>
  users: Record<string, User>
  messages: Record<string, Message[]>
  tickets: Record<string, StoredTicket[]>
  memories: Record<string, StoredMemory[]>
  journal: Record<string, JournalEntry>
  settings: { ai_brain: 'offline' | 'claude'; claude_key?: string }
  model: { weights: Record<string, number>; tag_affinity: Record<string, Record<string, number>>; updates: number }
  corridors: Record<string, Corridor>
  feedback: { real: number; synthetic: number }
}

const freshLearning = (): Pick<State, 'model' | 'corridors' | 'feedback'> => ({
  model: { weights: { ...DEFAULT_WEIGHTS }, tag_affinity: {}, updates: 0 },
  corridors: Object.fromEntries(Object.entries(CORRIDOR_BUFFERS).map(([k, v]) => [k, { buffer: v, initial: v, samples: 0 }])),
  feedback: { real: 0, synthetic: 0 },
})

const fresh = (): State => ({
  trips: {}, users: Object.fromEntries(DEMO_USERS.map((u) => [u.id, structuredClone(u)])), messages: {}, tickets: {},
  memories: {}, journal: {}, settings: { ai_brain: 'offline' }, ...freshLearning(),
})

let memory: State | null = null

function load(): State {
  if (memory) return memory
  let s: Partial<State> | null = null
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) s = JSON.parse(raw) as Partial<State>
  } catch {
    /* storage unavailable or corrupt */
  }
  const base = fresh()
  memory = s && s.model && s.corridors ? { ...base, ...s, users: { ...base.users, ...(s.users ?? {}) } } as State : base
  return memory
}

// ------------------------------------------------------------------ live sync between tabs
type Listener = (e: TripEvent) => void
const listeners = new Set<Listener>()
let channel: BroadcastChannel | null = null
try {
  channel = new BroadcastChannel('delayproof-sync')
  channel.onmessage = (ev: MessageEvent<TripEvent>) => {
    memory = null // another tab wrote: re-read on next access
    listeners.forEach((l) => l(ev.data))
  }
} catch {
  /* no BroadcastChannel: single-tab mode */
}

function save(...events: TripEvent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    /* private mode / quota: keep working in memory */
  }
  for (const e of events) {
    channel?.postMessage(e)
    listeners.forEach((l) => l(e))
  }
}

const now = () => new Date().toISOString()
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
const code = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

function catalog(): Catalog {
  const s = load()
  return {
    attractions: ATTRACTIONS, stays: STAYS, trains: TRAINS, personas: PERSONAS,
    corridors: Object.fromEntries(Object.entries(s.corridors).map(([k, c]) => [k, c.buffer])),
    weights: { ...s.model.weights }, tag_affinity: clone(s.model.tag_affinity),
  }
}

function getTrip(id: string): StoredTrip {
  const t = load().trips[id]
  if (!t) throw new Error('Trip not found')
  return t
}

const userName = (uid: string) => load().users[uid]?.name ?? 'Someone'

function tripView(t: StoredTrip, message: string | null = null): Trip {
  const view = buildView(catalog(), t.profile, t.disruptions)
  return { trip_id: t._id, title: t.title, owner_id: t.owner_id, members: clone(t.members), mode_on: t.mode_on,
    invite_code: t.invite_code, profile: clone(t.profile), feedback: { ...t.feedback }, message, ...view }
}

function summary(t: StoredTrip): TripSummary {
  return { trip_id: t._id, title: t.title, persona_label: t.profile.persona_label, start_date: t.profile.start_date,
    days: t.profile.days, travelers: t.profile.travelers, owner_id: t.owner_id, members: clone(t.members),
    mode_on: t.mode_on, budget: t.profile.budget, updated_at: t.updated_at }
}

function post(tripId: string, m: Omit<Message, 'id' | 'trip_id' | 'at'>): Message {
  const s = load()
  const msg: Message = { id: newId(), trip_id: tripId, at: now(), ...m }
  ;(s.messages[tripId] ??= []).push(msg)
  return msg
}

/** Every plan change is announced in the group thread with the engine's own explanation. */
function announce(t: StoredTrip, uid: string | undefined, what: string) {
  const v = buildView(catalog(), t.profile, t.disruptions)
  const first = v.changes.find((c) => c.kind === 'moved' || c.kind === 'dropped' || c.kind === 'added')
  const detail = v.banner.active ? ` ${v.banner.headline}.${first ? ` ${first.name}: ${first.kind}${first.kind === 'moved' ? ` to Day ${first.to_day} ${first.to}` : ''}.` : ''}` : ''
  post(t._id, { user_id: 'system', kind: 'system', text: `🛡️ ${uid ? userName(uid) : 'DelayProof'} ${what}.${detail}` })
}

function touch(t: StoredTrip, ...extra: TripEvent[]) {
  t.updated_at = now()
  save({ type: 'trip', trip_id: t._id }, { type: 'messages', trip_id: t._id }, { type: 'trips' }, ...extra)
}

function learningState(): LearningState {
  const s = load()
  return {
    weights: { ...s.model.weights }, defaults: { ...DEFAULT_WEIGHTS }, tag_affinity: clone(s.model.tag_affinity),
    updates: s.model.updates,
    corridors: Object.entries(s.corridors).map(([corridor, c]) => ({ corridor, ...c }))
      .sort((a, b) => a.corridor.localeCompare(b.corridor)),
    feedback: { ...s.feedback }, db: DB_MODE,
  }
}

/** Run synchronously but resolve asynchronously, like the network calls it replaces. */
const later = <T,>(fn: () => T | Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => setTimeout(() => {
    Promise.resolve().then(fn).then(resolve, (e) => reject(e instanceof Error ? e : new Error(String(e))))
  }, 0))

function prefsToProfile(profile: Profile, p: Partial<Prefs>) {
  if (p.interests?.length) profile.interests = [...p.interests]
  if (p.pace) profile.pace = p.pace
  if (p.diet) profile.diet = p.diet
  if (p.mobility) profile.mobility = p.mobility
  if (p.avoid_heat !== undefined) profile.avoid_heat = p.avoid_heat
  if (p.day_start) profile.day_start = p.day_start
  if (p.day_end) profile.day_end = p.day_end
  if (profile.mobility === 'limited' && !profile.modes.includes('cab')) profile.modes = [...profile.modes, 'cab']
}

// ------------------------------------------------------------------ trip mutations used by the API and the agent
function mutDisrupt(id: string, patch: Partial<Disruptions>, uid?: string, label?: string): StoredTrip {
  const t = getTrip(id)
  const d = { ...t.disruptions } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null) d[k] = v
  t.disruptions = normalizeDisruptions(d as Partial<Disruptions>)
  announce(t, uid, `reported ${label ?? describePatch(patch)}`)
  touch(t)
  return t
}

function describePatch(p: Partial<Disruptions>): string {
  const out: string[] = []
  if (p.train_delay_min !== undefined) out.push(p.train_delay_min ? `the train running ${p.train_delay_min} min late` : 'the train on time')
  if (p.return_delay_min !== undefined) out.push(p.return_delay_min ? `the return train ${p.return_delay_min} min late` : 'the return train on time')
  if (p.weather) out.push(p.weather === 'clear' ? 'clear weather' : p.weather === 'heat' ? '42°C heat' : 'rain')
  if (p.crowd) out.push(p.crowd.length ? 'a crowd surge' : 'crowds cleared')
  if (p.late_start) out.push('a late start')
  return out.join(', ') || 'a change'
}

function mutSwap(id: string, attractionId: string, uid?: string): { t: StoredTrip; msg: string } {
  const t = getTrip(id)
  const view = tripView(t)
  const it = view.days.flatMap((d) => d.items).find((x) => x.attraction_id === attractionId && x.type === 'visit')
  if (!it || !it.plan_b) throw new Error('No Plan B available for this stop')
  const d = normalizeDisruptions(t.disruptions)
  d.swaps[attractionId] = it.plan_b.id
  d.swap_days[it.plan_b.id] = it.day
  t.disruptions = d
  const msg = `Swapped ${it.title} for ${it.plan_b.name} (${it.plan_b.reason}).`
  post(id, { user_id: 'system', kind: 'system', text: `🔁 ${uid ? userName(uid) : 'DelayProof'} swapped ${it.title} for ${it.plan_b.name}.` })
  touch(t)
  return { t, msg }
}

function mutSkip(id: string, attractionId: string, uid?: string): StoredTrip {
  const t = getTrip(id)
  const d = normalizeDisruptions(t.disruptions)
  if (!d.skipped.includes(attractionId)) d.skipped.push(attractionId)
  d.pins = d.pins.filter((x) => x !== attractionId)
  t.disruptions = d
  const a = ATTRACTIONS.find((x) => x.id === attractionId)
  post(id, { user_id: 'system', kind: 'system', text: `✕ ${uid ? userName(uid) : 'DelayProof'} skipped ${a?.name ?? attractionId}; plan re-arranged.` })
  touch(t)
  return t
}

function mutPin(id: string, attractionId: string, uid?: string): StoredTrip {
  const t = getTrip(id)
  const d = normalizeDisruptions(t.disruptions)
  if (!d.pins.includes(attractionId)) d.pins.push(attractionId)
  d.skipped = d.skipped.filter((x) => x !== attractionId)
  t.disruptions = d
  const a = ATTRACTIONS.find((x) => x.id === attractionId)
  post(id, { user_id: 'system', kind: 'system', text: `📌 ${uid ? userName(uid) : 'DelayProof'} added ${a?.name ?? attractionId} to the plan.` })
  touch(t)
  return t
}

function mutReset(id: string, uid?: string): StoredTrip {
  const t = getTrip(id)
  t.disruptions = normalizeDisruptions({})
  t.feedback = {}
  post(id, { user_id: 'system', kind: 'system', text: `↺ ${uid ? userName(uid) : 'DelayProof'} reset the plan to the original package.` })
  touch(t)
  return t
}

function newTrip(uid: string, opts: ProfileOverrides & { persona_id: string }, title?: string): StoredTrip {
  const s = load()
  const profile = makeProfile(catalog(), opts.persona_id, opts)
  const t: StoredTrip = {
    _id: newId(), title: title || `${profile.persona_label} · Jaipur`, owner_id: uid,
    members: [{ user_id: uid, role: 'owner', joined_at: now() }], mode_on: false, invite_code: code(),
    profile, disruptions: normalizeDisruptions({}), feedback: {}, ride_logs: [], created_at: now(), updated_at: now(),
  }
  s.trips[t._id] = t
  post(t._id, { user_id: 'system', kind: 'system', text: `✨ ${userName(uid)} created "${t.title}". Invite friends with code ${t.invite_code}.` })
  save({ type: 'trips' })
  return t
}

function agentTools(uid: string, tripId?: string): AgentTools {
  const s = load()
  const prefs = s.users[uid]?.prefs ?? DEFAULT_PREFS
  return {
    catalog,
    trip: tripId ? tripView(getTrip(tripId)) : null,
    prefs,
    preview: (c: AgentCreate) => {
      const profile = makeProfile(catalog(), c.persona_id, c as ProfileOverrides)
      return { profile, view: buildView(catalog(), profile, {}) }
    },
    createTrip: (c, title) => tripView(newTrip(uid, c as ProfileOverrides & { persona_id: string }, title)),
    disrupt: (patch, label) => tripView(mutDisrupt(tripId!, patch, uid, label)),
    skip: (id) => tripView(mutSkip(tripId!, id, uid)),
    pin: (id) => tripView(mutPin(tripId!, id, uid)),
    swap: (id) => {
      const { t, msg } = mutSwap(tripId!, id, uid)
      return tripView(t, msg)
    },
    reset: () => tripView(mutReset(tripId!, uid)),
  }
}

function majority(t: StoredTrip) {
  return Math.floor(t.members.length / 2) + 1
}

async function withFile<T extends { file_id?: string }>(r: T, field: 'file' | 'photo') {
  const { file_id, ...rest } = r
  return { ...rest, [field]: file_id ? await getFile(file_id) : undefined }
}

export type TripOptions = ProfileOverrides & { persona_id: string; user_id?: string; title?: string; use_prefs?: boolean }
export type RideLog = { from_zone: string; to_zone: string; planned_min: number; actual_min: number; buffer_used?: number }

export const api = {
  mode: DB_MODE as 'browser' | 'server',

  subscribe: (cb: Listener) => {
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  },

  meta: () => later((): Meta => ({
    city: CITY, personas: PERSONAS, stays: STAYS, attractions: ATTRACTIONS, modes: MODES,
    interests: [...new Set(ATTRACTIONS.flatMap((a) => a.tags))].sort(), db: DB_MODE,
    ...{ origin: ORIGIN, zones: ZONES, homes: HOMES, trains: TRAINS },
  })),

  // ---------------------------------------------------------------- users & settings
  users: () => later(() => Object.values(load().users)),
  createUser: (name: string) => later(() => {
    const s = load()
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || newId()
    const uid = s.users[id] ? `${id}-${newId().slice(0, 4)}` : id
    const colors = ['#2347d8', '#e0287d', '#15935b', '#c77700', '#7a3fd6', '#0f8aa8']
    s.users[uid] = { id: uid, name, emoji: '🙂', color: colors[Object.keys(s.users).length % colors.length], prefs: { ...DEFAULT_PREFS } }
    save({ type: 'trips' })
    return s.users[uid]
  }),
  savePrefs: (uid: string, prefs: Prefs) => later(() => {
    const s = load()
    if (!s.users[uid]) throw new Error('Unknown user')
    s.users[uid].prefs = clone(prefs)
    save({ type: 'trips' })
    return s.users[uid]
  }),
  settings: () => later(() => ({ ai_brain: load().settings.ai_brain, has_key: !!load().settings.claude_key })),
  saveSettings: (ai_brain: 'offline' | 'claude', claude_key?: string) => later(() => {
    const s = load()
    s.settings.ai_brain = ai_brain
    if (claude_key !== undefined) s.settings.claude_key = claude_key || undefined
    save()
    return { ai_brain: s.settings.ai_brain, has_key: !!s.settings.claude_key }
  }),

  // ---------------------------------------------------------------- trips
  trips: (uid: string) => later(() => Object.values(load().trips)
    .filter((t) => t.members.some((m) => m.user_id === uid))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(summary)),

  createTrip: (opts: TripOptions) => later(() => {
    const uid = opts.user_id ?? 'priya'
    const prefs = load().users[uid]?.prefs
    const o: TripOptions = { ...opts }
    if (prefs && opts.use_prefs !== false) {
      o.diet ??= prefs.diet
      o.mobility ??= prefs.mobility
      o.avoid_heat ??= prefs.avoid_heat
    }
    return tripView(newTrip(uid, o, opts.title))
  }),

  trip: (id: string) => later(() => tripView(getTrip(id))),

  deleteTrip: (id: string, uid: string) => later(() => {
    const s = load()
    const t = getTrip(id)
    if (t.owner_id !== uid) {
      t.members = t.members.filter((m) => m.user_id !== uid)
    } else {
      delete s.trips[id]
      delete s.messages[id]
    }
    save({ type: 'trips' })
    return true
  }),

  disrupt: (id: string, patch: Partial<Disruptions>, uid?: string) => later(() => tripView(mutDisrupt(id, patch, uid))),
  reset: (id: string, uid?: string) => later(() => tripView(mutReset(id, uid), 'Plan reset to the original package.')),
  swap: (id: string, attractionId: string, uid?: string) => later(() => {
    const { t, msg } = mutSwap(id, attractionId, uid)
    return tripView(t, msg)
  }),
  pin: (id: string, attractionId: string, uid?: string) => later(() => tripView(mutPin(id, attractionId, uid))),

  applyPrefs: (id: string, prefs: Partial<Prefs>, uid: string) => later(() => {
    const t = getTrip(id)
    prefsToProfile(t.profile, prefs)
    const bits = [prefs.diet && prefs.diet !== 'any' ? `${prefs.diet} meals` : '', prefs.mobility === 'limited' ? 'limited mobility' : '',
      prefs.avoid_heat ? 'no midday heat' : '', prefs.pace ? `${prefs.pace} pace` : ''].filter(Boolean)
    announce(t, uid, `applied preferences (${bits.join(', ') || 'interests & hours'})`)
    touch(t)
    return tripView(t, 'Preferences applied: the plan was rebuilt around them.')
  }),

  setMode: (id: string, on: boolean, uid: string) => later(() => {
    const t = getTrip(id)
    t.mode_on = on
    post(id, { user_id: 'system', kind: 'system', text: on ? `🧭 ${userName(uid)} turned on Trip mode. Live guidance is active.` : `⏸ ${userName(uid)} turned off Trip mode.` })
    touch(t)
    return tripView(t)
  }),

  feedback: (id: string, attractionId: string, action: 'kept' | 'skipped', uid?: string) => later(() => {
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
    if (action === 'skipped') post(id, { user_id: 'system', kind: 'system', text: `✕ ${uid ? userName(uid) : 'Someone'} skipped ${a.name}; plan re-arranged.` })
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

  // ---------------------------------------------------------------- members & sharing
  addMember: (id: string, uid: string, byUid: string) => later(() => {
    const t = getTrip(id)
    if (!t.members.some((m) => m.user_id === uid)) {
      t.members.push({ user_id: uid, role: 'editor', joined_at: now() })
      post(id, { user_id: 'system', kind: 'system', text: `👋 ${userName(byUid)} added ${userName(uid)} to the trip.` })
    }
    touch(t)
    return tripView(t)
  }),
  removeMember: (id: string, uid: string, byUid: string) => later(() => {
    const t = getTrip(id)
    if (uid === t.owner_id) throw new Error('The owner cannot be removed')
    t.members = t.members.filter((m) => m.user_id !== uid)
    post(id, { user_id: 'system', kind: 'system', text: `${userName(byUid)} removed ${userName(uid)}.` })
    touch(t)
    return tripView(t)
  }),
  join: (inviteCode: string, uid: string) => later(() => {
    const t = Object.values(load().trips).find((x) => x.invite_code === inviteCode.trim().toUpperCase())
    if (!t) throw new Error(`No trip with invite code ${inviteCode}`)
    if (!t.members.some((m) => m.user_id === uid)) {
      t.members.push({ user_id: uid, role: 'editor', joined_at: now() })
      post(t._id, { user_id: 'system', kind: 'system', text: `👋 ${userName(uid)} joined with the invite code.` })
    }
    touch(t)
    return tripView(t)
  }),
  /** A link that carries a copy of the trip, for opening on another device (no server needed). */
  shareLink: (id: string) => later(() => {
    const t = getTrip(id)
    const payload = { title: t.title, profile: t.profile, disruptions: t.disruptions }
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const base = `${location.origin}${location.pathname}`
    return { invite: `${base}?join=${t.invite_code}`, copy: `${base}#import=${b64}`, code: t.invite_code }
  }),
  importTrip: (b64: string, uid: string) => later(() => {
    const json = decodeURIComponent(escape(atob(b64.replace(/-/g, '+').replace(/_/g, '/'))))
    const p = JSON.parse(json) as { title: string; profile: Profile; disruptions: Disruptions }
    const t = newTrip(uid, { persona_id: p.profile.persona_id }, `${p.title} (shared copy)`)
    t.profile = p.profile
    t.disruptions = normalizeDisruptions(p.disruptions)
    touch(t)
    return tripView(t)
  }),

  // ---------------------------------------------------------------- group chat & polls
  messages: (id: string) => later(() => clone(load().messages[id] ?? [])),
  send: (id: string, uid: string, text: string) => later(() => {
    getTrip(id)
    post(id, { user_id: uid, kind: 'text', text })
    if (/^\s*@(ai|assistant|delayproof)\b/i.test(text)) {
      const q = text.replace(/^\s*@\w+\s*/, '')
      const r = runAgent(q, { slots: {} }, agentTools(uid, id))
      post(id, { user_id: 'agent', kind: 'agent', text: r.reply, cards: r.cards })
    }
    save({ type: 'messages', trip_id: id }, { type: 'trip', trip_id: id })
    return clone(load().messages[id])
  }),
  createPoll: (id: string, uid: string, poll: Pick<Poll, 'question' | 'options' | 'action'>) => later(() => {
    getTrip(id)
    post(id, { user_id: uid, kind: 'poll', text: poll.question, poll: { ...poll, votes: {} } })
    save({ type: 'messages', trip_id: id })
    return clone(load().messages[id])
  }),
  vote: (id: string, messageId: string, uid: string, optionId: string) => later(() => {
    const t = getTrip(id)
    const m = (load().messages[id] ?? []).find((x) => x.id === messageId)
    if (!m?.poll) throw new Error('Poll not found')
    if (m.poll.closed) throw new Error('This poll is closed')
    m.poll.votes[uid] = optionId
    const counts: Record<string, number> = {}
    for (const v of Object.values(m.poll.votes)) counts[v] = (counts[v] ?? 0) + 1
    const need = majority(t)
    const winner = Object.entries(counts).find(([, n]) => n >= need)
    const allVoted = Object.keys(m.poll.votes).length >= t.members.length
    if (winner || allVoted) {
      const [win] = winner ?? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
      const label = m.poll.options.find((o) => o.id === win)?.label ?? win
      m.poll.closed = true
      m.poll.result = label
      if (m.poll.action?.type === 'swap' && win === 'yes') {
        try {
          mutSwap(id, m.poll.action.attraction_id, undefined)
          post(id, { user_id: 'system', kind: 'system', text: `🗳️ The group voted yes: switched to ${m.poll.action.alt_name}.` })
        } catch (e) {
          post(id, { user_id: 'system', kind: 'system', text: `🗳️ Voted yes, but ${(e as Error).message.toLowerCase()}.` })
        }
      } else {
        post(id, { user_id: 'system', kind: 'system', text: `🗳️ Poll closed: "${m.poll.question}" → ${label}.` })
      }
    }
    touch(t)
    return clone(load().messages[id])
  }),

  // ---------------------------------------------------------------- AI assistant
  agent: (text: string, ctx: { user_id: string; trip_id?: string; state: AgentState }) => later((): AgentReply =>
    runAgent(text, ctx.state, agentTools(ctx.user_id, ctx.trip_id))),

  // ---------------------------------------------------------------- wallet (uploaded tickets; auto tickets come from the plan)
  tickets: (id: string) => later(async () => Promise.all((load().tickets[id] ?? []).map((t) => withFile(t, 'file') as Promise<Ticket>))),
  addTicket: (id: string, uid: string, t: Pick<Ticket, 'title' | 'kind' | 'subtitle' | 'code' | 'day' | 'item_id' | 'file' | 'file_name'>) => later(async () => {
    const s = load()
    const { file, ...rest } = t
    const rec: StoredTicket = { ...rest, id: newId(), trip_id: id, added_by: uid, at: now() }
    if (file) {
      rec.file_id = `ticket-${rec.id}`
      await putFile(rec.file_id, file)
    }
    ;(s.tickets[id] ??= []).push(rec)
    post(id, { user_id: 'system', kind: 'system', text: `🎫 ${userName(uid)} added a ticket: ${t.title}.` })
    save({ type: 'tickets', trip_id: id }, { type: 'messages', trip_id: id })
    return true
  }),
  deleteTicket: (id: string, ticketId: string) => later(async () => {
    const s = load()
    const rec = (s.tickets[id] ?? []).find((x) => x.id === ticketId)
    s.tickets[id] = (s.tickets[id] ?? []).filter((x) => x.id !== ticketId)
    if (rec?.file_id) await delFile(rec.file_id)
    save({ type: 'tickets', trip_id: id })
    return true
  }),

  // ---------------------------------------------------------------- memories
  memories: (id: string) => later(async () => Promise.all((load().memories[id] ?? []).map((m) => withFile(m, 'photo') as Promise<Memory>))),
  addMemory: (id: string, uid: string, m: Pick<Memory, 'day' | 'stop' | 'item_id' | 'caption' | 'photo'>) => later(async () => {
    const s = load()
    const { photo, ...rest } = m
    const rec: StoredMemory = { ...rest, id: newId(), trip_id: id, user_id: uid, at: now() }
    if (photo) {
      rec.file_id = `memory-${rec.id}`
      await putFile(rec.file_id, photo)
    }
    ;(s.memories[id] ??= []).push(rec)
    post(id, { user_id: 'system', kind: 'system', text: `📸 ${userName(uid)} saved a memory at ${m.stop}${m.caption ? `: "${m.caption}"` : ''}.` })
    save({ type: 'memories', trip_id: id }, { type: 'messages', trip_id: id })
    return true
  }),
  deleteMemory: (id: string, memoryId: string) => later(async () => {
    const s = load()
    const rec = (s.memories[id] ?? []).find((x) => x.id === memoryId)
    s.memories[id] = (s.memories[id] ?? []).filter((x) => x.id !== memoryId)
    if (rec?.file_id) await delFile(rec.file_id)
    save({ type: 'memories', trip_id: id })
    return true
  }),

  // ---------------------------------------------------------------- journal
  journal: (id: string, uid: string) => later(() => Object.values(load().journal)
    .filter((j) => j.trip_id === id && (j.user_id === uid || j.shared))
    .sort((a, b) => a.day - b.day || a.user_id.localeCompare(b.user_id))),
  saveJournal: (e: Omit<JournalEntry, 'updated_at'>) => later(() => {
    const s = load()
    const rec = { ...e, updated_at: now() }
    s.journal[`${e.trip_id}|${e.day}|${e.user_id}`] = rec
    save({ type: 'journal', trip_id: e.trip_id })
    return rec
  }),

  /** Live calendar feed URL (full stack only). */
  calendarUrl: (id: string): string | null => (id ? null : null),

  // ---------------------------------------------------------------- learning (judge drawer)
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
