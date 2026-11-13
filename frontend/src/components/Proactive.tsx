import { useMemo, useState } from 'react'
import { type Suggestion, detect, proactivePrefs, saveProactivePrefs } from '../proactive'
import type { Expense, Trip } from '../types'
import type { LiveState } from '../useLive'

const ICON: Record<Suggestion['kind'], string> = { weather: '🌡️', air: '😷', budget: '💰', crowd: '👥', safety: '🌙' }

/** Real-time suggestion card: the top open suggestion, with accept / dismiss / mute. */
export default function Proactive({ trip, live, expenses, onAccept }: {
  trip: Trip; live: LiveState; expenses: Expense[]; onAccept: (s: Suggestion) => void
}) {
  const [prefs, setPrefs] = useState(proactivePrefs)
  const all = useMemo(() => detect(trip, live.weather, live.air, expenses), [trip, live.weather, live.air, expenses])
  const open = all.filter((s) => !prefs.dismissed.includes(s.id) && !prefs.muted.includes(s.kind))
  const s = open[0]
  if (!s) return null
  const update = (p: typeof prefs) => { setPrefs(p); saveProactivePrefs(p) }
  return (
    <aside className={`proactive sev-${s.severity}`} aria-live="polite" aria-label="Suggestion">
      <div className="proactive-head">
        <span className="proactive-icon" aria-hidden>{ICON[s.kind]}</span>
        <div>
          <small className="proactive-kicker">Suggestion · real-time trigger{open.length > 1 ? ` · 1 of ${open.length}` : ''}</small>
          <b>{s.title}</b>
          <p>{s.because}</p>
          {s.source && <small className="muted">Source: {s.source}</small>}
        </div>
      </div>
      <div className="proactive-actions">
        {s.action && <button className="btn btn-primary btn-sm" onClick={() => { onAccept(s); update({ ...prefs, dismissed: [...prefs.dismissed, s.id] }) }}>✓ {s.action.label}</button>}
        <button className="btn btn-sm" onClick={() => update({ ...prefs, dismissed: [...prefs.dismissed, s.id] })}>Dismiss</button>
        <button className="link small" onClick={() => update({ ...prefs, muted: [...prefs.muted, s.kind] })}>Don't suggest {s.kind} again</button>
      </div>
    </aside>
  )
}
