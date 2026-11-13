// Full-stack adapter: the same operations as the in-browser store on the frontend-only branch, served by
// FastAPI + MongoDB. Live updates arrive over a WebSocket.
import type {
  AgentReply, AgentState, Disruptions, JournalEntry, LearningState, Memory, Message, Meta, Poll, Prefs, SimResult,
  Ticket, Trip, TripEvent, TripSummary, User,
} from './types'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

const post = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T,>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) })
const del = <T,>(path: string) => call<T>(path, { method: 'DELETE' })

// ------------------------------------------------------------------ live updates
type Listener = (e: TripEvent) => void
const listeners = new Set<Listener>()
let socket: WebSocket | null = null
let retry = 1000

function connect() {
  if (socket || !listeners.size) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  socket = new WebSocket(`${proto}://${location.host}/api/ws`)
  socket.onmessage = (ev) => {
    try {
      const e = JSON.parse(ev.data) as TripEvent
      listeners.forEach((l) => l(e))
    } catch {
      /* ignore */
    }
  }
  socket.onopen = () => { retry = 1000 }
  socket.onclose = () => {
    socket = null
    setTimeout(connect, retry)
    retry = Math.min(retry * 2, 15000)
  }
}
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send('ping') }, 25000)

export type TripOptions = {
  persona_id: string; user_id?: string; title?: string; use_prefs?: boolean; days?: number; budget?: number
  travelers?: number; interests?: string[]; pace?: string; diet?: string; mobility?: string; avoid_heat?: boolean
}
export type RideLog = { from_zone: string; to_zone: string; planned_min: number; actual_min: number; buffer_used?: number }

export const api = {
  mode: 'server' as 'browser' | 'server',

  subscribe: (cb: Listener) => {
    listeners.add(cb)
    connect()
    return () => { listeners.delete(cb) }
  },

  meta: () => call<Meta>('/meta'),

  // users & settings
  users: () => call<User[]>('/users'),
  createUser: (name: string) => post<User>('/users', { name }),
  savePrefs: (uid: string, prefs: Prefs) => put<User>(`/users/${uid}/prefs`, { prefs }),
  settings: () => call<{ ai_brain: 'offline' | 'llm'; has_key: boolean }>('/settings'),
  saveSettings: (ai_brain: 'offline' | 'llm', llm_key?: string) =>
    put<{ ai_brain: 'offline' | 'llm'; has_key: boolean }>('/settings', { ai_brain, llm_key }),

  // trips
  trips: (uid: string) => call<TripSummary[]>(`/users/${uid}/trips`),
  createTrip: (opts: TripOptions) => post<Trip>('/trips', opts),
  trip: (id: string) => call<Trip>(`/trips/${id}`),
  deleteTrip: (id: string, uid: string) => del<boolean>(`/trips/${id}?user_id=${encodeURIComponent(uid)}`),
  disrupt: (id: string, d: Partial<Disruptions>, uid?: string) => post<Trip>(`/trips/${id}/disruptions`, { ...d, user_id: uid }),
  reset: (id: string, uid?: string) => post<Trip>(`/trips/${id}/reset`, { user_id: uid }),
  swap: (id: string, attraction_id: string, uid?: string) => post<Trip>(`/trips/${id}/swap`, { attraction_id, user_id: uid }),
  pin: (id: string, attraction_id: string, uid?: string) => post<Trip>(`/trips/${id}/pin`, { attraction_id, user_id: uid }),
  applyPrefs: (id: string, prefs: Partial<Prefs>, uid: string) => post<Trip>(`/trips/${id}/prefs`, { prefs, user_id: uid }),
  setMode: (id: string, on: boolean, uid: string) => post<Trip>(`/trips/${id}/mode`, { on, user_id: uid }),
  feedback: (id: string, attraction_id: string, action: 'kept' | 'skipped', uid?: string) =>
    post<Trip>(`/trips/${id}/feedback`, { attraction_id, action, user_id: uid }),
  rideLog: (id: string, body: RideLog) => post<Trip>(`/trips/${id}/ride-log`, body),

  // members & sharing
  addMember: (id: string, uid: string, by: string) => post<Trip>(`/trips/${id}/members`, { user_id: uid, by }),
  removeMember: (id: string, uid: string, by: string) => del<Trip>(`/trips/${id}/members/${uid}?by=${encodeURIComponent(by)}`),
  join: (code: string, uid: string) => post<Trip>('/join', { code, user_id: uid }),
  shareLink: async (id: string) => {
    const t = await api.trip(id)
    const base = `${location.origin}${location.pathname}`
    return { invite: `${base}?join=${t.invite_code}`, copy: '', code: t.invite_code ?? '' }
  },
  importTrip: (payload: string, uid: string) => post<Trip>('/trips/import', { payload, user_id: uid }),

  // group chat & polls
  messages: (id: string) => call<Message[]>(`/trips/${id}/messages`),
  send: (id: string, uid: string, text: string) => post<Message[]>(`/trips/${id}/messages`, { user_id: uid, text }),
  createPoll: (id: string, uid: string, p: Pick<Poll, 'question' | 'options' | 'action'>) =>
    post<Message[]>(`/trips/${id}/polls`, { user_id: uid, ...p }),
  vote: (id: string, mid: string, uid: string, option_id: string) =>
    post<Message[]>(`/trips/${id}/messages/${mid}/vote`, { user_id: uid, option_id }),

  // assistant
  agent: (text: string, ctx: { user_id: string; trip_id?: string; state: AgentState }) =>
    post<AgentReply>('/agent', { text, ...ctx }),

  // wallet, memories, journal
  tickets: (id: string) => call<Ticket[]>(`/trips/${id}/tickets`),
  addTicket: (id: string, uid: string, t: Pick<Ticket, 'title' | 'kind' | 'subtitle' | 'code' | 'day' | 'item_id' | 'file' | 'file_name'>) =>
    post<boolean>(`/trips/${id}/tickets`, { user_id: uid, ...t }),
  deleteTicket: (id: string, tid: string) => del<boolean>(`/trips/${id}/tickets/${tid}`),
  memories: (id: string) => call<Memory[]>(`/trips/${id}/memories`),
  addMemory: (id: string, uid: string, m: Pick<Memory, 'day' | 'stop' | 'item_id' | 'caption' | 'photo'>) =>
    post<boolean>(`/trips/${id}/memories`, { user_id: uid, ...m }),
  deleteMemory: (id: string, mid: string) => del<boolean>(`/trips/${id}/memories/${mid}`),
  journal: (id: string, uid: string) => call<JournalEntry[]>(`/trips/${id}/journal?user_id=${encodeURIComponent(uid)}`),
  saveJournal: (e: Omit<JournalEntry, 'updated_at'>) => put<JournalEntry>(`/trips/${e.trip_id}/journal`, e),

  /** Live calendar feed: rebuilt from the current plan on every refresh. */
  calendarUrl: (id: string): string | null => `${location.origin}/api/trips/${id}/calendar.ics`,

  // learning (judge drawer)
  learning: () => call<LearningState>('/learning'),
  setWeights: (weights: Record<string, number>) => put<LearningState>('/learning/weights', { weights }),
  simulate: (persona_id: string, apply: boolean, n = 400) => post<SimResult>('/learning/simulate', { persona_id, apply, n }),
  resetLearning: () => post<LearningState>('/learning/reset'),
}
