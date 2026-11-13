import type { Meta, Trip } from '../types'
import { rupee } from '../util'

export default function Receipt({ trip, meta }: { trip: Trip; meta: Meta }) {
  const r = trip.receipt
  const pct = Math.min(100, Math.round((r.total / r.budget) * 100))
  const over = r.total > r.budget
  const stay = meta.stays.find((s) => s.id === trip.profile.stay_id)
  const delta = r.total - r.baseline_total
  return (
    <section className="card receipt">
      <div className="card-head">
        <div>
          <h3>One tourist, one package</h3>
          <p className="muted small">
            {trip.profile.travelers} traveller{trip.profile.travelers > 1 ? 's' : ''} · {trip.profile.days} days ·{' '}
            {stay?.name}
          </p>
        </div>
      </div>
      <ul className="receipt-lines">
        {r.lines.filter((l) => l.amount > 0).map((l) => (
          <li key={l.key}>
            <span>{l.label}</span>
            <span>{rupee(l.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="receipt-total">
        <span>Grand total</span>
        <strong>{rupee(r.total)}</strong>
      </div>
      <div className={`budget-bar ${over ? 'over' : ''}`} aria-label={`${pct}% of budget used`}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="budget-meta small">
        <span>Budget {rupee(r.budget)}</span>
        <span className={over ? 'neg' : 'pos'}>{over ? `${rupee(-r.remaining)} over` : `${rupee(r.remaining)} left`}</span>
      </div>
      {delta !== 0 && trip.banner.active && (
        <p className="small muted">
          Re-plan changed the total by {delta > 0 ? '+' : '−'}{rupee(Math.abs(delta))} vs the original package.
        </p>
      )}
    </section>
  )
}
