import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { journalDraft, MOODS } from '../features'
import type { JournalEntry, Memory, Trip, User } from '../types'
import { fmtDate } from '../util'
import { Avatar, timeAgo } from './ui'

export default function Journal({ trip, user, users, notify }: {
  trip: Trip; user: User; users: Record<string, User>; notify: (t: string, k?: 'info' | 'error') => void
}) {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [memories, setMemories] = useState<Memory[]>([])
  const [day, setDay] = useState(1)
  const id = trip.trip_id
  const load = useCallback(() => {
    api.journal(id, user.id).then(setEntries).catch(() => {})
    api.memories(id).then(setMemories).catch(() => {})
  }, [id, user.id])
  useEffect(() => { load() }, [load])
  useEffect(() => api.subscribe((e) => { if (e.trip_id === id && (e.type === 'journal' || e.type === 'memories')) load() }), [id, load])

  const mine = entries.find((e) => e.day === day && e.user_id === user.id)
  const others = entries.filter((e) => e.day === day && e.user_id !== user.id)
  const d = trip.days.find((x) => x.day === day)!

  return (
    <div className="journal">
      <div className="section-bar">
        <div>
          <h2 className="section-title">Journal</h2>
          <p className="muted small">One page per day. Start from a draft written from your plan, the changes and your memories, then make it yours.</p>
        </div>
      </div>
      <div className="seg day-seg" role="tablist">
        {trip.days.map((x) => (
          <button key={x.day} className={x.day === day ? 'on' : ''} onClick={() => setDay(x.day)}>Day {x.day} · {fmtDate(x.date)}</button>
        ))}
      </div>
      <div className="journal-grid">
        <Editor key={`${day}-${mine?.updated_at ?? 'new'}`} trip={trip} user={user} day={day} entry={mine}
          draft={() => journalDraft(trip, day, memories)} title={d.title} notify={notify} onSaved={load} />
        <aside className="card">
          <h3>Shared by the group</h3>
          {others.length === 0 ? <p className="muted small">Nobody has shared Day {day} yet.</p> : others.map((e) => (
            <article key={e.user_id} className="shared-entry">
              <div className="row-gap"><Avatar user={users[e.user_id]} size={24} /><b>{users[e.user_id]?.name}</b><span>{e.mood}</span><span className="small muted">{timeAgo(e.updated_at)}</span></div>
              <p>{e.text}</p>
            </article>
          ))}
          {memories.filter((m) => m.day === day && m.photo).length > 0 && (
            <div className="journal-photos">
              {memories.filter((m) => m.day === day && m.photo).slice(0, 6).map((m) => <img key={m.id} src={m.photo} alt={m.caption || m.stop} />)}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function Editor({ trip, user, day, entry, draft, title, notify, onSaved }: {
  trip: Trip; user: User; day: number; entry?: JournalEntry; draft: () => string; title: string
  notify: (t: string, k?: 'info' | 'error') => void; onSaved: () => void
}) {
  const [text, setText] = useState(entry?.text ?? '')
  const [mood, setMood] = useState(entry?.mood ?? '😊')
  const [shared, setShared] = useState(entry?.shared ?? false)
  const [saving, setSaving] = useState(false)
  return (
    <section className="card journal-editor">
      <div className="card-head">
        <div><h3>Day {day} · {title}</h3><p className="small muted">{entry ? `Saved ${timeAgo(entry.updated_at)}` : 'Not written yet'}</p></div>
        <button className="btn btn-sm" onClick={() => setText(draft())}>✨ Draft from my day</button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} placeholder="What happened today?" aria-label={`Journal for day ${day}`} />
      <div className="journal-foot">
        <div className="moods" role="radiogroup" aria-label="Mood">
          {MOODS.map((m) => <button key={m} type="button" className={m === mood ? 'on' : ''} onClick={() => setMood(m)} aria-label={`Mood ${m}`}>{m}</button>)}
        </div>
        <label className="small"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with the group</label>
        <button className="btn btn-primary btn-sm" disabled={saving || !text.trim()} onClick={async () => {
          setSaving(true)
          try {
            await api.saveJournal({ trip_id: trip.trip_id, day, user_id: user.id, text: text.trim(), mood, shared })
            notify(`Day ${day} saved${shared ? ' and shared' : ''}`)
            onSaved()
          } catch (e) { notify((e as Error).message, 'error') } finally { setSaving(false) }
        }}>Save</button>
      </div>
    </section>
  )
}
