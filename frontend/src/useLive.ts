import { useCallback, useEffect, useState } from 'react'
import { type Air, type Fetched, type Weather, liveAir, liveWeather, simulatedHeatwave } from './live'
import type { Trip } from './types'

/** Forecast + air quality for the app, with a labelled "simulate heatwave" switch for demos. */
export function useLive(trip: Trip | null) {
  const [weather, setWeather] = useState<Fetched<Weather> | null>(null)
  const [air, setAir] = useState<Fetched<Air> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [simulate, setSimulate] = useState(false)

  const load = useCallback(() => {
    setError(null)
    liveWeather().then(setWeather).catch(() => setError('Forecast unavailable (offline or the service did not answer).'))
    liveAir().then(setAir).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  const dates = trip?.days.map((d) => d.date) ?? []
  const shown = simulate && dates.length ? simulatedHeatwave(dates) : weather
  return { weather: shown, realWeather: weather, air, error, simulate, setSimulate, reload: load }
}
export type LiveState = ReturnType<typeof useLive>
