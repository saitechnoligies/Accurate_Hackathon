import type { Disruptions, Trip } from '../types'

type Props = {
  trip: Trip
  busy: boolean
  onChange: (d: Partial<Disruptions>) => void
  onReset: () => void
}

function Seg<T extends string | number>({ value, options, onPick, disabled }: {
  value: T
  options: { v: T; label: string }[]
  onPick: (v: T) => void
  disabled: boolean
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} disabled={disabled}
          aria-pressed={o.v === value} onClick={() => onPick(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function DisruptionPanel({ trip, busy, onChange, onReset }: Props) {
  const d = trip.disruptions
  const lastDay = String(trip.profile.days)
  const lateLast = d.late_start[lastDay] ?? 0
  // crowd candidates: flagship & visited stops in the plan
  const crowdable = trip.baseline_days.flatMap((day) => day.items).filter((i) => i.type === 'visit' && i.flagship)
  const live = d.train_delay_min || d.return_delay_min || d.weather !== 'clear' || d.crowd.length || Object.keys(d.late_start).length

  return (
    <section className="card disrupt">
      <div className="card-head">
        <div>
          <h3>Simulate real life</h3>
          <p className="muted small">Toggle a disruption. The plan repairs itself instantly.</p>
        </div>
        {(live || d.skipped.length || Object.keys(d.swaps).length) ? (
          <button className="btn btn-ghost btn-sm" onClick={onReset} disabled={busy}>Reset</button>
        ) : null}
      </div>

      <div className="disrupt-row">
        <span className="disrupt-label">🚆 Train to Jaipur</span>
        <Seg value={d.train_delay_min} disabled={busy} onPick={(v) => onChange({ train_delay_min: v })}
          options={[{ v: 0, label: 'On time' }, { v: 60, label: '+1h' }, { v: 180, label: '+3h' }, { v: 300, label: '+5h' }]} />
      </div>
      <div className="disrupt-row">
        <span className="disrupt-label">🌡️ Weather</span>
        <Seg value={d.weather} disabled={busy} onPick={(v) => onChange({ weather: v })}
          options={[{ v: 'clear', label: 'Clear' }, { v: 'heat', label: '42°C heat' }, { v: 'rain', label: 'Rain' }]} />
      </div>
      <div className="disrupt-row">
        <span className="disrupt-label">⏰ Day {lastDay} start</span>
        <Seg value={lateLast} disabled={busy}
          onPick={(v) => onChange({ late_start: { ...d.late_start, [lastDay]: v } })}
          options={[{ v: 0, label: 'On time' }, { v: 90, label: '+1.5h' }, { v: 180, label: '+3h' }]} />
      </div>
      <div className="disrupt-row">
        <span className="disrupt-label">🚆 Return train</span>
        <Seg value={d.return_delay_min} disabled={busy} onPick={(v) => onChange({ return_delay_min: v })}
          options={[{ v: 0, label: 'On time' }, { v: 90, label: '+1.5h late' }]} />
      </div>
      <div className="disrupt-row disrupt-row-wrap">
        <span className="disrupt-label">👥 Crowd surge at</span>
        <div className="chips">
          {crowdable.map((i) => {
            const on = d.crowd.includes(i.attraction_id!)
            return (
              <button key={i.id} className={`chip ${on ? 'on' : ''}`} disabled={busy} aria-pressed={on}
                onClick={() => onChange({ crowd: on ? d.crowd.filter((c) => c !== i.attraction_id) : [...d.crowd, i.attraction_id!] })}>
                {i.title}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
