import { useMemo, useState } from 'react'
import { api } from '../api'
import { suggestPacking } from '../planhelpers'
import type { PackItem, Trip, User } from '../types'
import type { LiveState } from '../useLive'
import { useTripData } from '../useTripData'
import { Avatar, Empty } from './ui'

export default function Packing({ trip, user, users, live, notify }: {
  trip: Trip; user: User; users: Record<string, User>; live: LiveState; notify: (t: string, k?: 'info' | 'error') => void
}) {
  const id = trip.trip_id
  const [items, setItems] = useTripData<PackItem>(id, 'packing', api.packing)
  const [text, setText] = useState('')
  const members = (trip.members ?? []).map((m) => m.user_id)

  const suggestions = useMemo(() => {
    const have = new Set(items.map((i) => i.text.toLowerCase()))
    return suggestPacking(trip, live.weather).filter((s) => !have.has(s.text.toLowerCase()))
  }, [trip, live.weather, items])

  const run = async (p: Promise<PackItem[]>) => {
    try { setItems(await p) } catch (e) { notify((e as Error).message, 'error') }
  }
  const done = items.filter((i) => i.done_by).length
  const cats = [...new Set(items.map((i) => i.category))]

  return (
    <div className="packing">
      <div className="section-bar">
        <div>
          <h2 className="section-title">Packing list</h2>
          <p className="muted small">Shared with the group: assign who brings what and tick it off. Suggestions come from your plan and the live forecast.</p>
        </div>
        {items.length > 0 && <div className="pack-progress"><b>{done}/{items.length}</b> packed<div className="budget-bar"><div style={{ width: `${(done / items.length) * 100}%` }} /></div></div>}
      </div>

      {suggestions.length > 0 && (
        <section className="card pack-suggest">
          <div className="card-head">
            <div><h3>Suggested for this trip</h3><p className="small muted">Based on the plan{live.weather ? ` and the ${live.weather.freshness} forecast` : ''}.</p></div>
            <button className="btn btn-primary btn-sm" onClick={() => run(api.addPacking(id, user.id, suggestions))}>+ Add all {suggestions.length}</button>
          </div>
          <div className="chips chips-left">
            {suggestions.map((s) => (
              <button key={s.text} className="chip" title={s.why} onClick={() => run(api.addPacking(id, user.id, [s]))}>+ {s.text}</button>
            ))}
          </div>
        </section>
      )}

      <form className="pack-add" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { run(api.addPacking(id, user.id, [{ text, category: 'Other' }])); setText('') } }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an item…" aria-label="Packing item" maxLength={80} />
        <button className="btn btn-primary" disabled={!text.trim()}>Add</button>
      </form>

      {items.length === 0 ? <Empty icon="🧳" title="Nothing on the list yet">Add the suggestions above or type your own.</Empty> : cats.map((c) => (
        <section key={c} className="card pack-cat">
          <h3>{c}</h3>
          <ul className="pack-list">
            {items.filter((i) => i.category === c).map((i) => (
              <li key={i.id} className={i.done_by ? 'packed' : ''}>
                <label className="pack-check">
                  <input type="checkbox" checked={!!i.done_by} onChange={() => run(api.updatePacking(id, i.id, { done_by: i.done_by ? undefined : user.id }))} />
                  <span><span className="pack-text">{i.text}</span>{i.why && <small className="muted"> · {i.why}</small>}</span>
                </label>
                <select className="pack-who" value={i.assignee ?? ''} aria-label={`Who brings ${i.text}`}
                  onChange={(e) => run(api.updatePacking(id, i.id, { assignee: e.target.value || undefined }))}>
                  <option value="">Anyone</option>
                  {members.map((m) => <option key={m} value={m}>{users[m]?.name ?? m}</option>)}
                </select>
                {i.done_by && <Avatar user={users[i.done_by]} size={22} />}
                <button className="link small" onClick={() => run(api.deletePacking(id, i.id))} aria-label={`Remove ${i.text}`}>✕</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
