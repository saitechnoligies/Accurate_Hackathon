import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { autoTickets, hhmm, nowNext } from '../features'
import type { Item, Trip, User } from '../types'
import { itemIcon, minsLabel, rupee } from '../util'
import { stepLinks } from '../handoffs'
import { addReminder, removeReminder, useReminders } from '../voice'
import { PlacePhoto } from './live'
import { AddMemory } from './Memories'

type Props = {
  trip: Trip
  user: User
  busy: boolean
  notify: (t: string, k?: 'info' | 'error') => void
  onClose: () => void
  onEnd: () => void
  onTrip: (t: Trip) => void
  run: (fn: () => Promise<Trip>) => Promise<void>
  onSwap: (id: string) => void
  onFeedback: (id: string, a: 'kept' | 'skipped') => void
  onGroup: () => void
}

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export default function TripMode({ trip, user, busy, notify, onClose, onEnd, run, onSwap, onFeedback, onGroup }: Props) {
  const [day, setDay] = useState(1)
  const d = trip.days.find((x) => x.day === day) ?? trip.days[0]
  const [now, setNow] = useState(d.items[0]?.start_min ?? 480)
  const [memory, setMemory] = useState(false)
  const [geo, setGeo] = useState<string | null>(null)
  const reminders = useReminders(() => {})

  useEffect(() => { setNow(d.items[0]?.start_min ?? 480) }, [day]) // eslint-disable-line react-hooks/exhaustive-deps

  const { cur, next, nextRide } = nowNext(d.items, now)
  const focus: Item | undefined = cur && cur.type !== 'transfer' && cur.type !== 'buffer' ? cur : next
  const stop = [cur, next].find((i) => i?.type === 'visit')
  const tickets = useMemo(() => autoTickets(trip), [trip])
  const ticket = tickets.find((t) => t.item_id === focus?.id) ?? tickets.find((t) => t.item_id === next?.id)
  const min = d.items[0]?.start_min ?? 0
  const max = d.items[d.items.length - 1]?.end_min ?? 1440
  const progress = Math.round(((now - min) / Math.max(1, max - min)) * 100)

  const late = (mins: number) => {
    if (day === 1) run(() => api.disrupt(trip.trip_id, { train_delay_min: trip.disruptions.train_delay_min + mins }, user.id))
    else run(() => api.disrupt(trip.trip_id, { late_start: { ...trip.disruptions.late_start, [String(day)]: (trip.disruptions.late_start[String(day)] ?? 0) + mins } }, user.id))
  }
  const done = () => {
    const after = d.items.find((i) => i.start_min > now)
    if (after) setNow(after.start_min)
  }
  const checkLocation = () => {
    const target = next?.lat !== undefined ? next : d.items.find((i) => i.start_min > now && i.lat !== undefined)
    if (!target || target.lat === undefined) return setGeo('No upcoming place with a location today.')
    if (!navigator.geolocation) return setGeo('Location is not available in this browser.')
    setGeo('Checking your location…')
    navigator.geolocation.getCurrentPosition((pos) => {
      const dist = km({ lat: pos.coords.latitude, lng: pos.coords.longitude }, { lat: target.lat!, lng: target.lng! })
      const eta = Math.round((dist * 1.3) / 22 * 60 + 6)
      const slack = target.start_min - now
      setGeo(dist > 300
        ? `You're ${Math.round(dist)} km from ${target.title} (far from Jaipur, so this is a demo). On the trip, if the ride takes longer than the ${minsLabel(Math.max(0, slack))} left, DelayProof offers a re-plan.`
        : eta > slack ? `You're ${dist.toFixed(1)} km from ${target.title}: about ${eta} min by cab but only ${slack} min left. Tap “Running late” to re-plan.`
          : `On track: ${dist.toFixed(1)} km from ${target.title}, about ${eta} min away with ${slack} min to spare.`)
    }, () => setGeo('Location permission was declined. The simulated clock still works.'), { timeout: 8000 })
  }
  const shareLocation = async () => {
    try {
      await api.send(trip.trip_id, user.id, `📍 I'm ${cur ? `at ${cur.title}` : 'on the way'} (${hhmm(now)}). Next: ${next?.title ?? 'free time'} at ${next?.start ?? '-'}.`)
      notify('Status shared with the group')
    } catch (e) { notify((e as Error).message, 'error') }
  }

  return (
    <div className="tripmode" role="dialog" aria-label="Trip mode">
      <header className="tm-head">
        <div>
          <span className="tm-live"><span className="live-dot" aria-hidden /> Trip mode</span>
          <b>{trip.title}</b>
        </div>
        <div className="row-gap">
          <button className="btn btn-sm tm-btn" onClick={onClose}>Minimise</button>
          <button className="btn btn-sm tm-btn" onClick={onEnd}>End</button>
        </div>
      </header>

      <div className="tm-body">
        <div className="seg tm-days">
          {trip.days.map((x) => <button key={x.day} className={x.day === day ? 'on' : ''} onClick={() => setDay(x.day)}>Day {x.day}</button>)}
        </div>
        <div className="tm-clock">
          <span className="mono tm-time">{hhmm(now)}</span>
          <input type="range" min={min} max={max} step={5} value={now} onChange={(e) => setNow(Number(e.target.value))} aria-label="Simulated time" />
          <span className="small">{progress}% of the day</span>
        </div>

        {trip.banner.active && <div className="tm-alert">🛡️ {trip.banner.headline}</div>}

        <section className="tm-now">
          <span className="tm-label">{cur && focus === cur ? 'Right now' : 'Up next'}</span>
          {focus ? (
            <>
              {focus.type === 'visit' && <PlacePhoto id={focus.attraction_id} alt={focus.title} className="pphoto-tm" />}
              <h2>{itemIcon(focus)} {focus.title}</h2>
              <p className="tm-sub">{focus.start}{focus.end !== focus.start ? `–${focus.end}` : ''}{focus.subtitle ? ` · ${focus.subtitle}` : ''}</p>
              {focus.notes[0] && <p className="tm-note">{focus.notes[0]}</p>}
            </>
          ) : <h2>🎉 Day complete</h2>}
          {nextRide && (
            <div className="tm-leave">
              <span>Leave in</span><b>{minsLabel(Math.max(0, nextRide.start_min - now))}</b>
              <span className="small">{itemIcon(nextRide)} {nextRide.title}{nextRide.cost ? ` · ${rupee(nextRide.cost)}` : ''}</span>
              {stepLinks(nextRide).map((l) => <a key={l.label} className="btn btn-sm tm-btn" href={l.url} target="_blank" rel="noreferrer">{l.label === 'Directions' ? '🧭 Navigate' : l.label} ↗</a>)}
            </div>
          )}
        </section>

        {ticket && (
          <section className="tm-ticket">
            <span className="tm-label">Your ticket</span>
            <b>{ticket.title}</b>
            <span className="mono small">{ticket.code}</span>
            {ticket.status && <span className={`badge ${/late|moved/i.test(ticket.status) ? 'st-delayed' : 'st-rescued'}`}>{ticket.status}</span>}
          </section>
        )}

        <div className="tm-actions">
          <div className="tm-late">
            <span>{day === 1 ? 'Train running late?' : 'Running late?'}</span>
            {[15, 30, 60].map((m) => <button key={m} className="btn tm-btn" disabled={busy} onClick={() => late(m)}>+{m}m</button>)}
          </div>
          <button className="btn tm-big" onClick={done}>✓ Done, next</button>
          {stop?.plan_b && <button className="btn tm-big" disabled={busy} onClick={() => onSwap(stop.attraction_id!)}>🔁 Plan B: {stop.plan_b.name}</button>}
          {stop && <button className="btn tm-big" disabled={busy || !!trip.feedback[stop.attraction_id!]} onClick={() => onFeedback(stop.attraction_id!, 'skipped')}>✕ Skip {stop.title}</button>}
          <button className="btn tm-big" onClick={() => setMemory(true)}>📸 Add memory</button>
          <button className="btn tm-big" onClick={shareLocation}>📍 Share status</button>
          <button className="btn tm-big" onClick={checkLocation}>🛰️ Check my location</button>
          <button className="btn tm-big" onClick={onGroup}>💬 Group chat</button>
        </div>
        {geo && <p className="tm-geo">{geo}</p>}

        <section className="tm-rem">
          <div className="row-gap">
            <span className="tm-label">Reminders</span>
            <button className="btn btn-sm tm-btn" onClick={() => {
              addReminder({ label: nextRide ? `leave for ${nextRide.title.replace(/^.*? to /, '')}` : 'check the next stop', due: Date.now() + 10 * 60_000 })
              notify('Reminder set for 10 minutes from now')
            }}>⏰ Remind me in 10 min</button>
            <span className="small">or say “remind me to … in 5 minutes” to the assistant</span>
          </div>
          {reminders.length > 0 && (
            <ul>{reminders.map((r) => (
              <li key={r.id}>{r.label} · {new Date(r.due).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                <button className="link small" onClick={() => removeReminder(r.id)}>cancel</button></li>
            ))}</ul>
          )}
        </section>

        <ol className="tm-strip">
          {d.items.filter((i) => i.type !== 'transfer' && i.type !== 'buffer').map((i) => (
            <li key={i.id} className={`${i.end_min <= now && i !== cur ? 'past' : ''} ${i === cur ? 'cur' : ''}`}>
              <span className="mono">{i.start}</span> {itemIcon(i)} {i.title}
            </li>
          ))}
        </ol>
      </div>
      {memory && <AddMemory trip={trip} user={user} onClose={() => setMemory(false)} notify={notify}
        preset={{ day, item_id: (cur ?? next)?.id, stop: (cur ?? next)?.title ?? 'Jaipur' }}
        onSaved={() => { setMemory(false); notify('Memory saved') }} />}
    </div>
  )
}
