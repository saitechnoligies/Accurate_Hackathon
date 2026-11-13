import { useEffect, useState } from 'react'
import { api } from '../api'
import type { LearningState, SimResult, Trip } from '../types'
import { rupee } from '../util'

type Props = {
  open: boolean
  onClose: () => void
  trip: Trip
  onModelChanged: () => void
}

const WEIGHT_HELP: Record<string, string> = {
  interest: 'Pull of stops that match the traveller’s interests',
  flagship: 'Pull of must-see landmarks',
  budget: 'Penalty for expensive stops vs remaining budget',
  travel: 'Penalty per hour of travel to reach a stop',
  urgency: 'Bonus for stops closing within 3 hours',
  crowd: 'Penalty for queue time at crowd peaks',
}

export default function JudgeDrawer({ open, onClose, trip, onModelChanged }: Props) {
  const [state, setState] = useState<LearningState | null>(null)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [sim, setSim] = useState<SimResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const persona = trip.profile.persona_id

  const refresh = async () => {
    try {
      const s = await api.learning()
      setState(s)
      setWeights(s.weights)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  useEffect(() => {
    if (open) refresh()
  }, [open, trip.trip_id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const commitWeights = () =>
    run(async () => {
      const s = await api.setWeights(weights)
      setState(s)
      onModelChanged()
    })

  const n = trip.naive
  return (
    <>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={onClose} aria-hidden />
      <aside className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="Judge AI drawer">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">Under the hood</span>
            <h2>Judge AI drawer</h2>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close drawer">✕</button>
        </div>
        {err && <div className="error small">{err}</div>}

        <section className="drawer-sec">
          <h4>Static planner vs DelayProof</h4>
          <p className="muted small">Same trip, same disruption. A static itinerary keeps the plan and simply runs late.</p>
          <div className="versus">
            <div className="vs-col vs-bad">
              <span className="vs-title">Static plan</span>
              <b>{n.missed.length} stops missed</b>
              <span>{rupee(n.wasted)} wasted</span>
              <span>{n.flagships_missed} must-see lost</span>
              {n.missed_train && <span>Misses the return train</span>}
              {n.exposed.length > 0 && <span>{n.exposed.length} outdoor stops in bad weather</span>}
            </div>
            <div className="vs-col vs-good">
              <span className="vs-title">DelayProof</span>
              <b>{trip.stats.stops} stops kept</b>
              <span>{rupee(0)} wasted</span>
              <span>{trip.stats.flagships_kept}/{trip.stats.flagships_total} must-see kept</span>
              {n.missed_train && <span>Return train protected</span>}
            </div>
          </div>
          {n.missed.length > 0 && (
            <p className="small muted">Static plan misses: {n.missed.map((m) => m.name).join(', ')}</p>
          )}
        </section>

        <section className="drawer-sec">
          <div className="sec-head">
            <h4>Scoring weights</h4>
            {state && <span className="muted small">{state.updates} learning updates</span>}
          </div>
          <p className="muted small">score = interest + must-see − travel − budget + urgency − crowd + learned tag affinity</p>
          {Object.entries(weights).map(([k, v]) => (
            <label key={k} className="slider">
              <span className="slider-top">
                <span className="cap">{k}</span>
                <span className="mono">{v.toFixed(2)}{state && Math.abs(state.defaults[k] - v) > 0.005 && (
                  <span className="muted"> (default {state.defaults[k].toFixed(2)})</span>
                )}</span>
              </span>
              <input type="range" min={0} max={3} step={0.05} value={v} disabled={busy}
                onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))}
                onMouseUp={commitWeights} onTouchEnd={commitWeights} onKeyUp={commitWeights} />
              <span className="muted small">{WEIGHT_HELP[k]}</span>
            </label>
          ))}
        </section>

        <section className="drawer-sec">
          <h4>Self-learning: synthetic trip seeder</h4>
          <p className="muted small">
            Generates 400 Kept/Skipped decisions and ride logs from a hidden “true” {trip.profile.persona_label} traveller,
            trains on 75% and tests on a 25% holdout the model never saw.
          </p>
          <div className="row-gap">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(async () => setSim(await api.simulate(persona, false)))}>
              {busy ? 'Running…' : 'Run simulation'}
            </button>
            {sim && !sim.applied && (
              <button className="btn btn-sm" disabled={busy} onClick={() => run(async () => {
                setSim(await api.simulate(persona, true))
                await refresh()
                onModelChanged()
              })}>Apply learned model to planner</button>
            )}
            {sim?.applied && <span className="pos small">Applied. The trip has been re-scored.</span>}
          </div>
          {sim && (
            <>
              <div className="kpis">
                <div><span className="muted small">Holdout accuracy</span><b>{pct(sim.accuracy.before)} → {pct(sim.accuracy.after)}</b></div>
                <div><span className="muted small">Ride-time error</span><b>{sim.corridors.mae_before} → {sim.corridors.mae_after} min</b></div>
              </div>
              <LineChart points={sim.accuracy.curve.map((c) => c.accuracy)} />
              <table className="tbl small">
                <thead><tr><th>Corridor</th><th>Before</th><th>Learned</th><th>True</th></tr></thead>
                <tbody>
                  {sim.corridors.table.map((r) => (
                    <tr key={r.corridor}>
                      <td>{r.corridor.replace('|', ' ↔ ').replace(/_/g, ' ')}</td>
                      <td>{r.before}</td><td><b>{r.after}</b></td><td className="muted">{r.true}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section className="drawer-sec">
          <h4>Live corridor delay buffers</h4>
          <p className="muted small">Updated by “log actual time” on any ride (moving average, α = 0.3).</p>
          <table className="tbl small">
            <thead><tr><th>Corridor</th><th>Start</th><th>Now</th><th>Logs</th></tr></thead>
            <tbody>
              {state?.corridors.map((c) => (
                <tr key={c.corridor}>
                  <td>{c.corridor.replace('|', ' ↔ ').replace(/_/g, ' ')}</td>
                  <td>{c.initial.toFixed(0)}m</td>
                  <td className={c.buffer > c.initial ? 'neg' : ''}><b>{c.buffer.toFixed(1)}m</b></td>
                  <td>{c.samples}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state && (
            <p className="muted small">
              Feedback stored: {state.feedback.real} real · {state.feedback.synthetic} synthetic · Storage: {state.db === 'browser' ? 'this browser (localStorage)' : state.db === 'atlas' ? 'MongoDB Atlas' : 'in-memory MongoDB'}
            </p>
          )}
        </section>

        <section className="drawer-sec">
          <h4>How each feature would go live</h4>
          <ul className="how small">
            <li><b>Train delay:</b> NTES / RailYatri live status → recompute arrival → re-plan</li>
            <li><b>Weather:</b> IMD / OpenWeather hourly forecast → heat & rain windows</li>
            <li><b>Crowds:</b> ticket-counter queue data & Google Popular Times → queue minutes</li>
            <li><b>Rides:</b> Ola / Uber / Rapido fare APIs → mode upgrade options</li>
            <li><b>Bookings:</b> IRCTC + hotel & ASI e-ticket partners → one checkout</li>
            <li><b>Learning:</b> Kept/Skipped + GPS ride times → nightly retrain per persona</li>
          </ul>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => {
            const s = await api.resetLearning()
            setState(s)
            setWeights(s.weights)
            setSim(null)
            onModelChanged()
          })}>Reset learned model</button>
        </section>
      </aside>
    </>
  )
}

const pct = (x: number) => `${Math.round(x * 100)}%`

function LineChart({ points }: { points: number[] }) {
  const w = 320
  const h = 120
  const pad = 24
  const padL = 40
  const lo = Math.max(0, Math.min(...points) - 0.05)
  const hi = Math.min(1, Math.max(...points) + 0.05)
  const x = (i: number) => padL + (i / Math.max(1, points.length - 1)) * (w - padL - pad)
  const y = (v: number) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Holdout accuracy by training epoch">
        <line x1={padL} x2={w - pad} y1={h - pad} y2={h - pad} className="axis" />
        <text x={padL} y={h - 6} className="axis-label">epoch 0</text>
        <text x={w - pad} y={h - 6} className="axis-label" textAnchor="end">epoch {points.length - 1}</text>
        <text x={padL - 6} y={y(hi) + 4} className="axis-label" textAnchor="end">{pct(hi)}</text>
        <text x={padL - 6} y={y(lo) + 4} className="axis-label" textAnchor="end">{pct(lo)}</text>
        <path d={d} className="line" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p)} r={i === 0 || i === points.length - 1 ? 3.5 : 2} className="dot">
            <title>Epoch {i}: {pct(p)}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="muted small">Holdout accuracy while learning (synthetic data, labelled as such)</figcaption>
    </figure>
  )
}
