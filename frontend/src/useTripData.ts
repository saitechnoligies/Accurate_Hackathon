import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { TripEvent } from './types'

/** Load a per-trip list and keep it fresh when another tab / user changes it. */
export function useTripData<T>(tripId: string | undefined, kind: TripEvent['type'], fetcher: (id: string) => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([])
  const load = useCallback(() => {
    if (tripId) fetcher(tripId).then(setItems).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId])
  useEffect(() => { setItems([]); load() }, [load])
  useEffect(() => api.subscribe((e) => { if (e.trip_id === tripId && e.type === kind) load() }), [tripId, kind, load])
  return [items, setItems, load] as const
}
