import { useState } from 'react'
import type { Day, Item, Trip } from '../types'
import { fmtDate, itemIcon, minsLabel, rupee, STATUS_LABEL } from '../util'

type Props = {
  trip: Trip
  day: number
  onDay: (d: number) => void
  busy: boolean
  onSwap: (attractionId: string) => void
  onFeedback: (attractionId: string, action: 'kept' | 'skipped') => void
  onRideLog: (it: Item, actual: number) => void
}

export default function Timeline({ trip, day, onDay, busy, onSwap, onFeedback, onRideLog }: Props) {
  const current = trip.days.find((d) => d.day === day) ?? trip.days[0]
  const [liveOn, setLiveOn] = useState(false)
  const [now, setNow] = useState<number>(current.items[0]?.start_min ?? 480)

  return (
    <section className="card timeline-card">
      <div className="day-tabs" role="tablist">
        {trip.days.map((d) => (
          <button key={d.day} role="tab" aria-selected={d.day === day} className={d.day === day ? 'on' : ''}
            onClick={() => onDay(d.day)}>
            <span>Day {d.day}</span>
            <small>{fmtDate(d.date)}</small>
          </button>
        ))}
        <label className="live-toggle">
          <input type="checkbox" checked={liveOn} onChange={(e) => {
            setLiveOn(e.target.checked)
            setNow(current.items[0]?.start_min ?? 480)
          }} />
          Live mode
        </label>
      </div>

      {liveOn && <LiveNow day={current} now={now} setNow={setNow} />}

      <h3 className="day-title">{current.title}</h3>
      <ol className="timeline">
        {current.items.map((it) => (
          <Row key={it.id} it={it} trip={trip} busy={busy} onSwap={onSwap} onFeedback={onFeedback}
            onRideLog={onRideLog} isNow={liveOn && it.start_min <= now && now < Math.max(it.end_min, it.start_min + 1)} />
        ))}
      </ol>
    </section>
  )
}

function LiveNow({ day, now, setNow }: { day: Day; now: number; setNow: (n: number) => void }) {
  const items = day.items
  const min = items[0]?.start_min ?? 0
  const max = items[items.length - 1]?.end_min ?? 1440
  const cur = items.find((i) => i.start_min <= now && now < Math.max(i.end_min, i.start_min + 1))
  const next = items.find((i) => i.start_min > now && i.type !== 'transfer')
  const nextRide = items.find((i) => i.start_min >= now && i.type === 'transfer')
  const hhmm = `${String(Math.floor((now % 1440) / 60)).padStart(2, '0')}:${String(now % 60).padStart(2, '0')}`
  return (
    <div className="live">
      <div className="live-clock">
        <span className="live-dot" aria-hidden /> Now <b>{hhmm}</b>
        <input type="range" min={min} max={max} step={5} value={now}
          onChange={(e) => setNow(Number(e.target.value))} aria-label="Simulated time of day" />
      </div>
      <div className="live-cards">
        <div><span className="muted small">Right now</span><b>{cur ? cur.title : 'Free time'}</b></div>
        {nextRide && (
          <div className="live-leave">
            <span className="muted small">Leave in</span>
            <b>{minsLabel(nextRide.start_min - now)}</b>
            <span className="small">{nextRide.title}</span>
          </div>
        )}
        {next && <div><span className="muted small">Next</span><b>{next.title}</b><span className="small">at {next.start}</span></div>}
      </div>
    </div>
  )
}

function Row({ it, trip, busy, onSwap, onFeedback, onRideLog, isNow }: {
  it: Item
  trip: Trip
  busy: boolean
  isNow: boolean
  onSwap: (id: string) => void
  onFeedback: (id: string, a: 'kept' | 'skipped') => void
  onRideLog: (it: Item, actual: number) => void
}) {
  const [logging, setLogging] = useState(false)
  const [actual, setActual] = useState(0)
  const dur = it.end_min - it.start_min
  const fb = it.attraction_id ? trip.feedback[it.attraction_id] : undefined

  if (it.type === 'transfer') {
    const local = !it.intercity && it.frm?.zone && it.to?.zone
    return (
      <li className={`tl tl-transfer ${it.status !== 'normal' ? `st-${it.status}` : ''} ${isNow ? 'now' : ''}`}>
        <span className="tl-time">{it.start}</span>
        <span className="tl-dot tl-dot-sm" aria-hidden>{itemIcon(it)}</span>
        <div className="tl-body">
          <div className="tl-transfer-line">
            <span>{it.title}</span>
            <span className="muted">· {minsLabel(dur)}{it.km ? ` · ${it.km} km` : ''}</span>
            {!!it.cost && <span className="muted">· {rupee(it.cost)}</span>}
            {it.status === 'upgraded' && <span className="badge st-upgraded">Upgraded</span>}
            {it.safety && <span className="badge st-safety">Safe ride</span>}
            {local && !logging && (
              <button className="link small" onClick={() => { setActual(dur); setLogging(true) }}>log actual time</button>
            )}
          </div>
          {it.notes.length > 0 && <div className="tl-notes small">{it.notes.join(' · ')}</div>}
          {logging && (
            <form className="ridelog" onSubmit={(e) => { e.preventDefault(); onRideLog(it, actual); setLogging(false) }}>
              <label className="small">Actual minutes
                <input type="number" min={1} max={300} value={actual} onChange={(e) => setActual(Number(e.target.value))} />
              </label>
              <button className="btn btn-sm btn-primary" disabled={busy}>Teach the model</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLogging(false)}>Cancel</button>
            </form>
          )}
        </div>
      </li>
    )
  }

  const isStop = it.type === 'visit' || it.type === 'meal'
  return (
    <li className={`tl tl-${it.type} ${it.status !== 'normal' ? `st-${it.status}` : ''} ${it.anchor ? 'anchor' : ''} ${isNow ? 'now' : ''}`}>
      <span className="tl-time">
        {it.start}
        {dur > 0 && <small>{it.end}</small>}
      </span>
      <span className="tl-dot" aria-hidden>{itemIcon(it)}</span>
      <div className="tl-body">
        <div className="tl-head">
          <strong>{it.title}</strong>
          {it.flagship && <span className="badge badge-flag">Must-see</span>}
          {it.status !== 'normal' && <span className={`badge st-${it.status}`}>{STATUS_LABEL[it.status]}</span>}
          {it.anchor && !isStop && <span className="badge badge-anchor" title="Fixed anchor: the plan rearranges around it">Anchor</span>}
          {!!it.cost && <span className="tl-cost">{rupee(it.cost)}</span>}
        </div>
        {it.subtitle && <div className="muted small">{it.subtitle}</div>}
        {it.blurb && <div className="small">{it.blurb} <span className="muted">· open {it.open}–{it.close}{it.indoor ? ' · indoor' : ''}</span></div>}
        {it.notes.length > 0 && (
          <ul className="tl-notes small">
            {it.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
        {it.type === 'visit' && (
          <div className="tl-actions">
            {it.plan_b ? (
              <button className="planb" disabled={busy} onClick={() => onSwap(it.attraction_id!)}
                title={it.plan_b.blurb}>
                <span className="planb-label">Plan B</span>
                <span className="planb-name">{it.plan_b.name}</span>
                <span className="planb-reason">{it.plan_b.reason}</span>
                <span className="planb-cta">Swap</span>
              </button>
            ) : (
              <span className="muted small">No safe swap for this slot</span>
            )}
            <div className="fb">
              <button className={`fb-btn ${fb === 'kept' ? 'on' : ''}`} disabled={busy || !!fb}
                onClick={() => onFeedback(it.attraction_id!, 'kept')} title="I liked this: learn from it">
                👍 Kept
              </button>
              <button className={`fb-btn ${fb === 'skipped' ? 'on' : ''}`} disabled={busy || !!fb}
                onClick={() => onFeedback(it.attraction_id!, 'skipped')} title="Skip it and re-plan">
                ✕ Skip
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  )
}
