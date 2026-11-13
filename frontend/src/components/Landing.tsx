import { useState } from 'react'
import type { Persona } from '../types'
import { rupee } from '../util'

type Props = {
  personas: Persona[]
  busy: boolean
  onStart: (opts: { persona_id: string; days?: number; budget?: number; travelers?: number }) => void
}

const STAY_LABEL: Record<string, string> = { hostel: 'Backpacker hostel', boutique: 'Boutique hotel', haveli: 'Heritage haveli' }

export default function Landing({ personas, busy, onStart }: Props) {
  const [custom, setCustom] = useState<Record<string, { days: number; budget: number; travelers: number }>>({})

  const opts = (p: Persona) => custom[p.id] ?? { days: p.days, budget: p.budget, travelers: p.travelers }
  const set = (p: Persona, k: 'days' | 'budget' | 'travelers', v: number) =>
    setCustom((c) => ({ ...c, [p.id]: { ...opts(p), [k]: v } }))

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Door to door · Delhi → Jaipur → home</span>
          <h1>
            One late train shouldn’t <span className="accent">break your whole trip.</span>
          </h1>
          <p className="lede">
            DelayProof plans your journey from your front door back to your front door. It bundles the train, stay,
            local rides and tickets into one receipt, then repairs the plan when delays, heat or crowds hit.
          </p>
          <ul className="hero-points">
            <li><b>One package:</b> train + stay + rides + tickets on one budget-tracked receipt</li>
            <li><b>Self-healing:</b> must-see spots move to tomorrow instead of being lost</li>
            <li><b>Plan B ready:</b> every stop has a backup that fits the same time slot</li>
          </ul>
        </div>
        <div className="hero-story card">
          <div className="story-title">The domino effect today</div>
          <ol className="story">
            <li><span className="t">06:10</span> Leave Delhi on the Ajmer Shatabdi</li>
            <li className="bad"><span className="t">13:35</span> Arrive 3 hours late</li>
            <li className="bad"><span className="t">14:20</span> Hotel detour with bags, pickup cab already gone</li>
            <li className="bad"><span className="t">16:55</span> City Palace closes before you get in</li>
            <li className="bad"><span className="t">17:30</span> Tickets wasted, stuck in 42°C heat</li>
          </ol>
          <div className="story-fix">DelayProof re-plans this in under a second. Pick a traveller below to see it.</div>
        </div>
      </section>

      <h2 className="section-title">Who’s travelling?</h2>
      <div className="persona-grid">
        {personas.map((p) => {
          const o = opts(p)
          return (
            <div key={p.id} className="persona card">
              <div className="persona-head">
                <span className="persona-emoji" aria-hidden>{p.emoji}</span>
                <div>
                  <h3>{p.label}</h3>
                  <p className="muted">{p.description}</p>
                </div>
              </div>
              <div className="persona-tags">
                {p.interests.map((t) => (
                  <span key={t} className="tag">{t}</span>
                ))}
                <span className="tag tag-soft">{STAY_LABEL[p.stay_type]}</span>
                <span className="tag tag-soft">{p.pace} pace</span>
              </div>
              <div className="persona-fields">
                <label>
                  Travellers
                  <input type="number" min={1} max={8} value={o.travelers}
                    onChange={(e) => set(p, 'travelers', Number(e.target.value))} />
                </label>
                <label>
                  Days
                  <select value={o.days} onChange={(e) => set(p, 'days', Number(e.target.value))}>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
                <label>
                  Budget (₹)
                  <input type="number" min={1000} step={500} value={o.budget}
                    onChange={(e) => set(p, 'budget', Number(e.target.value))} />
                </label>
              </div>
              <button className="btn btn-primary btn-block" disabled={busy}
                onClick={() => onStart({ persona_id: p.id, ...o })}>
                {busy ? 'Planning…' : `Plan my trip · ${rupee(o.budget)}`}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
