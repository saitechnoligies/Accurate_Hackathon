import { useEffect, type ReactNode } from 'react'
import type { AgentCard, User } from '../types'
import { MODE_ICON, rupee } from '../util'
import { PlacePhoto } from './live'

export function Avatar({ user, size = 30 }: { user?: User | null; size?: number }) {
  if (!user) return <span className="avatar" style={{ width: size, height: size }}>?</span>
  return (
    <span className="avatar" title={user.name} style={{ width: size, height: size, background: user.color, fontSize: size * 0.55 }}>
      {user.emoji}
    </span>
  )
}

export function Avatars({ ids, users }: { ids: string[]; users: Record<string, User> }) {
  return (
    <span className="avatars">
      {ids.slice(0, 5).map((id) => <Avatar key={id} user={users[id]} size={26} />)}
      {ids.length > 5 && <span className="avatar more">+{ids.length - 5}</span>}
    </span>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>{icon}</div>
      <b>{title}</b>
      {children && <div className="muted small">{children}</div>}
    </div>
  )
}

export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** Rich cards returned by the assistant (also shown when @ai answers in the group). */
export function AgentCards({ cards, onAction }: { cards: AgentCard[]; onAction?: (text: string, card: AgentCard) => void }) {
  return (
    <div className="acards">
      {cards.map((c, i) => <AgentCardView key={i} card={c} onAction={onAction} />)}
    </div>
  )
}

function AgentCardView({ card, onAction }: { card: AgentCard; onAction?: (text: string, card: AgentCard) => void }) {
  if (card.type === 'places') {
    return (
      <div className="acard">
        <div className="acard-title">{card.title}</div>
        <div className="place-list">
          {card.items.map((p) => (
            <div key={p.id} className="place">
              <PlacePhoto id={p.id} alt={p.name} className="pphoto-card" />
              <div className="place-top">
                <b>{p.name}</b>
                {p.flagship && <span className="badge badge-flag">Must-see</span>}
                {p.in_trip && <span className="badge st-rescued">In plan</span>}
              </div>
              <div className="small muted">{p.blurb}</div>
              <div className="place-meta small">
                <span>{p.fee ? rupee(p.fee) : 'Free'}</span><span>{p.open}–{p.close}</span>
                {p.indoor && <span>Indoor</span>}{p.stairs && <span>Stairs</span>}
                {p.tags.slice(0, 3).map((t) => <span key={t} className="cap">{t}</span>)}
              </div>
              {onAction && !p.in_trip && <button className="link small" onClick={() => onAction(`Add ${p.name}`, card)}>+ Add to plan</button>}
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (card.type === 'options') {
    return (
      <div className="acard">
        <div className="acard-title">🚦 {card.title}</div>
        <table className="tbl opt-tbl">
          <tbody>
            {card.options.map((o) => (
              <tr key={o.mode} className={o.best ? 'best' : ''}>
                <td>{MODE_ICON[o.mode] ?? '🚕'} {o.label}{o.best && <span className="badge st-rescued">Fastest</span>}</td>
                <td className="mono">{o.minutes} min</td>
                <td className="mono">{o.cost ? rupee(o.cost) : 'Free'}</td>
                <td className="small muted">{o.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (card.type === 'plan') {
    const over = card.total > card.budget
    return (
      <div className="acard acard-plan">
        <div className="acard-title">🧳 {card.title}</div>
        <ul className="plan-summary small">{card.summary.map((s) => <li key={s}>{s}</li>)}</ul>
        <div className="plan-days">
          {card.days.map((d) => (
            <div key={d.day} className="plan-day">
              <b>Day {d.day}</b>
              {d.leave && <div className="small muted">🏠 Leave home {d.leave}</div>}
              <ol>{d.stops.map((s, i) => <li key={i}><span className="mono">{s.time}</span> {s.kind === 'meal' ? '🍛' : '📍'} {s.name}</li>)}</ol>
              {d.home && <div className="small muted">🏡 Home {d.home}</div>}
            </div>
          ))}
        </div>
        <div className="plan-total">
          <span>All-in <b className={over ? 'neg' : ''}>{rupee(card.total)}</b> of {rupee(card.budget)}</span>
          {card.create && onAction && <button className="btn btn-primary btn-sm" onClick={() => onAction('Create it', card)}>✓ Create this trip</button>}
        </div>
      </div>
    )
  }
  if (card.type === 'day') {
    return (
      <div className="acard">
        <div className="acard-title">📍 {card.title}</div>
        <ol className="day-stops">
          {card.stops.map((s, i) => (
            <li key={i}><span className="mono">{s.time}</span> {s.kind === 'meal' ? '🍛' : s.kind === 'train' ? '🚆' : s.kind === 'cloakroom' ? '🎒' : '📍'} {s.name}
              {s.status && <span className={`badge st-${s.status}`}>{s.status}</span>}</li>
          ))}
        </ol>
      </div>
    )
  }
  if (card.type === 'budget') {
    return (
      <div className="acard">
        <div className="acard-title">🧾 {card.title}</div>
        <ul className="receipt-lines">{card.lines.map((l) => <li key={l.label}><span>{l.label}</span><span>{rupee(l.amount)}</span></li>)}</ul>
        <div className="receipt-total"><span>Total</span><strong>{rupee(card.total)}</strong></div>
        <div className={`budget-bar ${card.total > card.budget ? 'over' : ''}`}><div style={{ width: `${Math.min(100, (card.total / card.budget) * 100)}%` }} /></div>
      </div>
    )
  }
  return (
    <div className="acard acard-banner">
      <div className="acard-title">🛡️ {card.title}</div>
      <ul className="small">{card.lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  )
}
