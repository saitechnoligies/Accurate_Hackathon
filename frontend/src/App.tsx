import { useCallback, useEffect, useState } from 'react'
import { api, type TripOptions } from './api'
import DisruptionPanel from './components/DisruptionPanel'
import JourneyStrip from './components/JourneyStrip'
import JudgeDrawer from './components/JudgeDrawer'
import Landing from './components/Landing'
import PocketPass from './components/PocketPass'
import Receipt from './components/Receipt'
import ReplanBanner from './components/ReplanBanner'
import Timeline from './components/Timeline'
import TripMap from './components/TripMap'
import type { Disruptions, Item, Meta, Trip } from './types'
import { storage } from './util'

const TRIP_KEY = 'delayproof.trip'

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [trip, setTrip] = useState<Trip | null>(null)
  const [day, setDay] = useState(1)
  const [busy, setBusy] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [toast, setToast] = useState<{ text: string; kind: 'info' | 'error' } | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)

  useEffect(() => {
    api.meta().then(setMeta).catch((e) => setBootError(e.message))
    const saved = storage(TRIP_KEY)
    if (saved) api.trip(saved).then(setTrip).catch(() => storage(TRIP_KEY, null))
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const run = useCallback(async (fn: () => Promise<Trip>) => {
    setBusy(true)
    try {
      const t = await fn()
      setTrip(t)
      storage(TRIP_KEY, t.trip_id)
      if (t.message) setToast({ text: t.message, kind: 'info' })
    } catch (e) {
      setToast({ text: (e as Error).message, kind: 'error' })
    } finally {
      setBusy(false)
    }
  }, [])

  const start = (opts: TripOptions) => {
    setDay(1)
    run(() => api.createTrip(opts))
  }
  const disrupt = (d: Partial<Disruptions>) => trip && run(() => api.disrupt(trip.trip_id, d))
  const reset = () => trip && run(() => api.reset(trip.trip_id))
  const swap = (id: string) => trip && run(() => api.swap(trip.trip_id, id))
  const feedback = (id: string, a: 'kept' | 'skipped') => trip && run(() => api.feedback(trip.trip_id, id, a))
  const rideLog = (it: Item, actual: number) =>
    trip && it.frm?.zone && it.to?.zone &&
    run(() => api.rideLog(trip.trip_id, {
      from_zone: it.frm!.zone!, to_zone: it.to!.zone!, planned_min: it.end_min - it.start_min, actual_min: actual,
      buffer_used: it.buffer ?? undefined,
    }))
  const refresh = () => trip && run(async () => ({ ...(await api.trip(trip.trip_id)), message: null }))
  const newTrip = () => {
    storage(TRIP_KEY, null)
    setTrip(null)
    setDrawer(false)
  }

  if (bootError) {
    return (
      <div className="boot">
        <h2>Can’t reach the DelayProof API</h2>
        <p className="muted">{bootError}</p>
        <p className="muted small">Start the backend: <code>cd backend && .venv\Scripts\python -m uvicorn app.main:app --port 8000</code></p>
      </div>
    )
  }
  if (!meta) return <div className="boot"><div className="spinner" aria-label="Loading" /></div>

  return (
    <>
      <div className="app">
        <header className="topbar">
          <button className="brand" onClick={newTrip} title="Start a new trip">
            <span className="brand-mark" aria-hidden>🛡️</span>
            <span>DelayProof<span className="brand-sub">Trip</span></span>
          </button>
          {trip && (
            <div className="topbar-trip">
              <span className="pill">{trip.profile.persona_label}</span>
              <span className="muted small hide-sm">{trip.profile.home.label} → Jaipur → home</span>
            </div>
          )}
          <div className="topbar-actions">
            {busy && <span className="spinner spinner-sm" aria-label="Re-planning" />}
            {trip && <button className="btn btn-ghost btn-sm hide-sm" onClick={() => window.print()}>🖨️ Pocket pass</button>}
            {trip && <button className="btn btn-ghost btn-sm hide-sm" onClick={newTrip}>New trip</button>}
            {trip && <button className="btn btn-dark btn-sm" onClick={() => setDrawer(true)}>🧠 Judge AI</button>}
          </div>
        </header>

        {!trip ? (
          <Landing personas={meta.personas} busy={busy} onStart={start} />
        ) : (
          <main className="trip">
            <JourneyStrip trip={trip} day={day} onDay={setDay} />
            <div className="trip-grid">
              <div className="col-main">
                <ReplanBanner trip={trip} />
                <DisruptionPanel trip={trip} busy={busy} onChange={disrupt} onReset={reset} />
                <Timeline trip={trip} day={day} onDay={setDay} busy={busy} onSwap={swap} onFeedback={feedback} onRideLog={rideLog} />
              </div>
              <div className="col-side">
                <TripMap trip={trip} day={day} meta={meta} />
                <Receipt trip={trip} meta={meta} />
              </div>
            </div>
          </main>
        )}
      </div>

      {trip && <JudgeDrawer open={drawer} onClose={() => setDrawer(false)} trip={trip} onModelChanged={refresh} />}
      {trip && <PocketPass trip={trip} meta={meta} />}
      {toast && (
        <div className={`toast ${toast.kind === 'error' ? 'toast-error' : ''}`} role="status">
          {toast.text}
          <button className="link" onClick={() => setToast(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
    </>
  )
}
