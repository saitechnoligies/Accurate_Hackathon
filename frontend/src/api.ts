import type { Disruptions, LearningState, Meta, SimResult, Trip } from './types'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
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

export type TripOptions = { persona_id: string; days?: number; budget?: number; travelers?: number }

export const api = {
  meta: () => call<Meta>('/meta'),
  createTrip: (opts: TripOptions) => post<Trip>('/trips', opts),
  trip: (id: string) => call<Trip>(`/trips/${id}`),
  disrupt: (id: string, d: Partial<Disruptions>) => post<Trip>(`/trips/${id}/disruptions`, d),
  reset: (id: string) => post<Trip>(`/trips/${id}/reset`),
  swap: (id: string, attraction_id: string) => post<Trip>(`/trips/${id}/swap`, { attraction_id }),
  feedback: (id: string, attraction_id: string, action: 'kept' | 'skipped') =>
    post<Trip>(`/trips/${id}/feedback`, { attraction_id, action }),
  rideLog: (id: string, body: { from_zone: string; to_zone: string; planned_min: number; actual_min: number; buffer_used?: number }) =>
    post<Trip>(`/trips/${id}/ride-log`, body),
  learning: () => call<LearningState>('/learning'),
  setWeights: (weights: Record<string, number>) =>
    call<LearningState>('/learning/weights', { method: 'PUT', body: JSON.stringify({ weights }) }),
  simulate: (persona_id: string, apply: boolean, n = 400) =>
    post<SimResult>('/learning/simulate', { persona_id, apply, n }),
  resetLearning: () => post<LearningState>('/learning/reset'),
}
