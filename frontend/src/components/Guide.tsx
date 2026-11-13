import { useEffect, useState } from 'react'
import { HELPLINES, PROVIDERS, bookingCom } from '../handoffs'
import { AQI_LABEL, type BriefSection, type Fetched, OFFLINE_BRIEF, WEATHER_ICON, WEATHER_LABEL, cityBrief, hasPhoto } from '../live'
import type { Trip } from '../types'
import type { LiveState } from '../useLive'
import { fmtDate } from '../util'
import { PlacePhoto, TrustBadge } from './live'

export default function Guide({ trip, live }: { trip: Trip; live: LiveState }) {
  const [brief, setBrief] = useState<Fetched<BriefSection[]> | null>(null)
  const [briefFailed, setBriefFailed] = useState(false)
  useEffect(() => { cityBrief().then(setBrief).catch(() => setBriefFailed(true)) }, [])

  const w = live.weather
  const byDate = new Map((w?.data.days ?? []).map((d) => [d.date, d]))
  const stay = trip.days[0].items.find((i) => i.type === 'checkin')?.subtitle ?? 'Jaipur'
  const stops = [...new Map(trip.days.flatMap((d) => d.items).filter((i) => i.type === 'visit' && hasPhoto(i.attraction_id ?? ''))
    .map((i) => [i.attraction_id, i])).values()]

  return (
    <div className="guide">
      <div className="section-bar">
        <div>
          <h2 className="section-title">Jaipur guide</h2>
          <p className="muted small">Live conditions, a short city brief, helplines and booking links. Every figure says where it came from and how fresh it is.</p>
        </div>
      </div>

      <div className="guide-grid">
        <section className="card">
          <div className="card-head">
            <h3>Weather on your dates</h3>
            {w && <TrustBadge freshness={w.freshness} at={w.at} source={w.source} url={w.url || undefined} />}
          </div>
          {w ? (
            <>
              <p className="wx-now">{WEATHER_ICON(w.data.current.code)} <b>{w.data.current.temp}°C</b> now · {WEATHER_LABEL(w.data.current.code)}</p>
              <div className="wx-days">
                {trip.days.map((d) => {
                  const f = byDate.get(d.date)
                  return (
                    <div key={d.date} className={`wx-day ${f && f.max >= 40 ? 'wx-hot' : ''}`}>
                      <b>Day {d.day}</b><span className="small muted">{fmtDate(d.date)}</span>
                      {f ? <><span className="wx-ico">{WEATHER_ICON(f.code)}</span><span>{f.max}° / {f.min}°</span><span className="small muted">{f.rain}% rain</span></>
                        : <span className="small muted">Beyond the 16-day forecast</span>}
                    </div>
                  )
                })}
              </div>
            </>
          ) : <p className="muted small">{live.error ?? 'Loading forecast…'}</p>}
          <label className="small sim-toggle">
            <input type="checkbox" checked={live.simulate} onChange={(e) => live.setSimulate(e.target.checked)} />
            Demo: simulate a 43°C heatwave on Day 1 (labelled Simulated)
          </label>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Air quality</h3>
            {live.air && <TrustBadge freshness={live.air.freshness} at={live.air.at} source={live.air.source} url={live.air.url} />}
          </div>
          {live.air ? (
            <div className={`aqi aqi-${live.air.data.aqi > 150 ? 'bad' : live.air.data.aqi > 100 ? 'mid' : 'ok'}`}>
              <b>{live.air.data.aqi}</b><span>US AQI · {AQI_LABEL(live.air.data.aqi)}</span><span className="small">PM2.5 {live.air.data.pm25} µg/m³</span>
            </div>
          ) : <p className="muted small">Loading…</p>}
          <h3 className="guide-h">Helplines</h3>
          <ul className="helplines">
            {HELPLINES.map((h) => <li key={h.number}><span>{h.label}</span><a className="mono" href={`tel:${h.number}`}>{h.number}</a></li>)}
          </ul>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h3>City brief</h3>
          {brief ? <TrustBadge freshness={brief.freshness} at={brief.at} source={brief.source} url={brief.url} />
            : briefFailed ? <span className="fr fr-sim"><span className="fr-dot" />Offline notes</span> : null}
        </div>
        <div className="brief">
          {(brief?.data ?? (briefFailed ? OFFLINE_BRIEF : [])).map((s) => (
            <article key={s.title}><h4>{s.title}</h4><p>{s.text}</p></article>
          ))}
          {!brief && !briefFailed && <p className="muted small">Loading the guide…</p>}
        </div>
        {brief && <p className="small muted">Excerpts from Wikivoyage, licensed CC BY-SA 4.0. <a href={brief.url} target="_blank" rel="noreferrer">Read the full guide</a>.</p>}
      </section>

      {stops.length > 0 && (
        <section className="card">
          <h3>Your stops</h3>
          <div className="photo-rail">
            {stops.map((i) => (
              <div key={i.attraction_id} className="rail-item">
                <PlacePhoto id={i.attraction_id} alt={i.title} />
                <b className="small">{i.title}</b>
                <span className="small muted">Day {i.day} · {i.start}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head"><h3>Book & get around</h3><span className="fr fr-cached"><span className="fr-dot" />Opens the provider</span></div>
        <p className="small muted">Fares and seats in the plan are simulated. These open the real providers with your trip filled in where they allow it.</p>
        <div className="providers">
          {PROVIDERS.map((p) => (
            <a key={p.name} className="provider" href={p.url} target="_blank" rel="noreferrer">
              <span className="provider-icon">{p.icon}</span><b>{p.name}</b><span className="small muted">{p.what}</span>
            </a>
          ))}
          <a className="provider" href={bookingCom(trip, stay)} target="_blank" rel="noreferrer">
            <span className="provider-icon">🏨</span><b>Booking.com</b><span className="small muted">{stay}, your dates and party size</span>
          </a>
        </div>
      </section>
    </div>
  )
}
