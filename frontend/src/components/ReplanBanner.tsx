import { useState } from 'react'
import type { Trip } from '../types'

export default function ReplanBanner({ trip }: { trip: Trip }) {
  const { banner } = trip
  const [open, setOpen] = useState(true)
  return (
    <section className={`banner ${banner.active ? 'banner-active' : ''}`} aria-live="polite">
      <div className="banner-head">
        <span className="banner-icon" aria-hidden>{banner.active ? '🛡️' : '✅'}</span>
        <div className="banner-title">
          <strong>{banner.headline}</strong>
          {banner.active && <span className="muted small">Here’s what changed and why</span>}
        </div>
        {banner.active && (
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Why?'}
          </button>
        )}
      </div>
      {banner.savings.length > 0 && (
        <div className="savings">
          {banner.savings.map((s) => (
            <div key={s.label} className="saving">
              <span className="saving-value">{s.value}</span>
              <span className="saving-label">{s.label}</span>
              <span className="saving-detail">{s.detail}</span>
            </div>
          ))}
        </div>
      )}
      {open && (
        <ul className="banner-lines">
          {banner.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
