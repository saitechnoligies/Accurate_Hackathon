import { useState } from 'react'
import type { TripOptions } from '../api'
import type { Meta, TripSummary, User } from '../types'
import { fmtDate, rupee } from '../util'
import AgentChat from './AgentChat'
import Landing from './Landing'
import { Avatars, timeAgo } from './ui'

type Props = {
  meta: Meta
  user: User
  users: Record<string, User>
  trips: TripSummary[]
  busy: boolean
  onStart: (o: TripOptions) => void
  onOpen: (id: string) => void
  onJoin: (code: string) => void
  onCreated: (id: string) => void
}

export default function Home({ meta, user, users, trips, busy, onStart, onOpen, onJoin, onCreated }: Props) {
  const [code, setCode] = useState('')
  return (
    <div className="home">
      <section className="home-top">
        <div className="home-left">
          <span className="eyebrow">Hi {user.name} 👋</span>
          <h1 className="home-title">Where are we going?</h1>
          <p className="lede">Describe your trip in one line and the assistant builds the full door-to-door plan, or start from a traveller preset below.</p>

          <div className="card trips-card">
            <div className="card-head">
              <h3>Your trips</h3>
              <form className="join" onSubmit={(e) => { e.preventDefault(); if (code.trim()) onJoin(code) }}>
                <input placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} aria-label="Invite code" />
                <button className="btn btn-sm" disabled={busy || code.trim().length < 6}>Join</button>
              </form>
            </div>
            {trips.length === 0 ? (
              <p className="muted small">No trips yet. Ask the assistant, pick a preset below, or join a friend's trip with their code.</p>
            ) : (
              <div className="trip-list">
                {trips.map((t) => (
                  <button key={t.trip_id} className="trip-row" onClick={() => onOpen(t.trip_id)}>
                    <div className="trip-row-main">
                      <b>{t.title}</b>
                      <span className="small muted">{fmtDate(t.start_date)} · {t.days} days · {t.travelers} traveller{t.travelers > 1 ? 's' : ''} · {rupee(t.budget)}</span>
                    </div>
                    {t.mode_on && <span className="badge st-live">Live</span>}
                    {t.owner_id !== user.id && <span className="badge badge-anchor">Shared</span>}
                    <Avatars ids={t.members.map((m) => m.user_id)} users={users} />
                    <span className="small muted hide-sm">{timeAgo(t.updated_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="home-right">
          <AgentChat user={user} trip={null} onCreated={onCreated} compact />
        </div>
      </section>
      <Landing personas={meta.personas} busy={busy} onStart={onStart} />
    </div>
  )
}
