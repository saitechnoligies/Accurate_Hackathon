import { useState } from 'react'
import { api } from '../api'
import { buildIcs, download } from '../features'
import type { Trip, TripSummary } from '../types'
import { itemIcon } from '../util'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function CalendarView({ trip, trips, onOpen, onDay }: {
  trip: Trip; trips: TripSummary[]; onOpen: (id: string) => void; onDay: (d: number) => void
}) {
  const first = new Date(`${trip.days[0].date}T00:00:00`)
  const [month, setMonth] = useState(new Date(first.getFullYear(), first.getMonth(), 1))
  const [sel, setSel] = useState(trip.days[0].date)
  const feed = api.calendarUrl(trip.trip_id)

  // every trip's dates, so overlapping plans are visible
  const marks = new Map<string, { id: string; title: string; day: number; current: boolean }[]>()
  for (const t of trips) {
    for (let i = 0; i < t.days; i++) {
      const d = new Date(`${t.start_date}T00:00:00`)
      d.setDate(d.getDate() + i)
      const k = iso(d)
      marks.set(k, [...(marks.get(k) ?? []), { id: t.trip_id, title: t.title, day: i + 1, current: t.trip_id === trip.trip_id }])
    }
  }
  for (const d of trip.days) if (!marks.get(d.date)?.some((m) => m.current)) marks.set(d.date, [...(marks.get(d.date) ?? []), { id: trip.trip_id, title: trip.title ?? 'This trip', day: d.day, current: true }])

  const start = new Date(month)
  start.setDate(1 - ((month.getDay() + 6) % 7))
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  const selDay = trip.days.find((d) => d.date === sel)
  const today = iso(new Date())

  return (
    <div className="calendar">
      <div className="section-bar">
        <div>
          <h2 className="section-title">Calendar</h2>
          <p className="muted small">Every timed step from leaving home to getting back, with 30-minute alerts before you leave and before each train.</p>
        </div>
        <div className="row-gap">
          <button className="btn" onClick={() => download(`${(trip.title ?? 'trip').replace(/\W+/g, '-')}.ics`, buildIcs(trip))}>⬇️ Add to calendar (.ics)</button>
          {feed && <a className="btn btn-primary" href={feed.replace(/^https?:/, 'webcal:')}>🔄 Subscribe (live updates)</a>}
        </div>
      </div>
      {feed && <p className="small muted feed-note">Subscribed calendars refresh from <code>{feed}</code>: when the plan re-heals, your phone's calendar follows.</p>}
      <div className="cal-grid-wrap">
        <section className="card cal">
          <div className="cal-head">
            <button className="btn btn-ghost btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
            <b>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</b>
            <button className="btn btn-ghost btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">›</button>
          </div>
          <div className="cal-grid">
            {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
            {cells.map((d) => {
              const k = iso(d)
              const ms = marks.get(k) ?? []
              return (
                <button key={k} className={`cal-cell ${d.getMonth() !== month.getMonth() ? 'out' : ''} ${k === sel ? 'sel' : ''} ${k === today ? 'today' : ''}`}
                  onClick={() => { setSel(k); const other = ms.find((m) => !m.current); if (!ms.some((m) => m.current) && other) onOpen(other.id) }}>
                  <span className="cal-num">{d.getDate()}</span>
                  {ms.map((m) => <span key={m.id} className={`cal-mark ${m.current ? 'cur' : ''}`} title={m.title}>D{m.day}</span>)}
                </button>
              )
            })}
          </div>
        </section>
        <section className="card cal-day">
          {selDay ? (
            <>
              <div className="card-head"><h3>Day {selDay.day} · {selDay.title}</h3><button className="link small" onClick={() => onDay(selDay.day)}>Open in plan</button></div>
              <ol className="agenda">
                {selDay.items.filter((i) => i.type !== 'buffer').map((i) => (
                  <li key={i.id} className={i.type === 'transfer' ? 'agenda-ride' : ''}>
                    <span className="mono">{i.start}</span><span aria-hidden>{itemIcon(i)}</span><span>{i.title}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : <p className="muted">Pick a highlighted date to see that day's schedule.</p>}
        </section>
      </div>
    </div>
  )
}
