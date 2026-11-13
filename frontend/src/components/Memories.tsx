import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { resizeImage } from '../features'
import type { Memory, Trip, User } from '../types'
import { Avatar, Empty, Modal, timeAgo } from './ui'

export default function Memories({ trip, user, users, notify }: {
  trip: Trip; user: User; users: Record<string, User>; notify: (t: string, k?: 'info' | 'error') => void
}) {
  const [list, setList] = useState<Memory[]>([])
  const [adding, setAdding] = useState(false)
  const [view, setView] = useState<Memory | null>(null)
  const id = trip.trip_id
  const load = useCallback(() => api.memories(id).then(setList).catch(() => {}), [id])
  useEffect(() => { load() }, [load])
  useEffect(() => api.subscribe((e) => { if (e.trip_id === id && e.type === 'memories') load() }), [id, load])

  return (
    <div className="memories">
      <div className="section-bar">
        <div>
          <h2 className="section-title">Memories</h2>
          <p className="muted small">Photos and notes pinned to the stop where they happened. They feed the journal, and saving one counts as a "kept" signal for the learning loop.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add memory</button>
      </div>
      {list.length === 0 ? (
        <Empty icon="📸" title="No memories yet">Add a photo from any stop, or use “Add memory” in Trip mode while you travel.</Empty>
      ) : (
        trip.days.map((d) => {
          const ms = list.filter((m) => m.day === d.day)
          if (!ms.length) return null
          return (
            <section key={d.day}>
              <h3 className="wallet-day">Day {d.day}</h3>
              <div className="memory-grid">
                {ms.map((m) => (
                  <button key={m.id} className="memory" onClick={() => setView(m)}>
                    {m.photo ? <img src={m.photo} alt={m.caption || m.stop} loading="lazy" /> : <div className="memory-note">“{m.caption}”</div>}
                    <div className="memory-meta">
                      <Avatar user={users[m.user_id]} size={22} />
                      <span className="small"><b>{m.stop}</b>{m.photo && m.caption ? ` · ${m.caption}` : ''}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )
        })
      )}
      {view && (
        <Modal title={view.stop} onClose={() => setView(null)} wide>
          {view.photo && <img className="memory-full" src={view.photo} alt={view.caption || view.stop} />}
          {view.caption && <p>{view.caption}</p>}
          <p className="small muted">{users[view.user_id]?.name ?? 'Someone'} · Day {view.day} · {timeAgo(view.at)}</p>
          {view.user_id === user.id && <button className="btn btn-sm" onClick={async () => { await api.deleteMemory(id, view.id); setView(null); load() }}>Delete</button>}
        </Modal>
      )}
      {adding && <AddMemory trip={trip} user={user} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); notify('Memory saved') }} notify={notify} />}
    </div>
  )
}

export function AddMemory({ trip, user, onClose, onSaved, notify, preset }: {
  trip: Trip; user: User; onClose: () => void; onSaved: () => void; notify: (t: string, k?: 'info' | 'error') => void
  preset?: { day: number; item_id?: string; stop: string }
}) {
  const stops = trip.days.flatMap((d) => d.items.filter((i) => i.type === 'visit' || i.type === 'meal').map((i) => ({ day: d.day, id: i.id, name: i.title })))
  const [sel, setSel] = useState(preset?.item_id ?? stops[0]?.id ?? '')
  const [caption, setCaption] = useState('')
  const [photo, setPhoto] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const stop = stops.find((s) => s.id === sel)
  return (
    <Modal title="Add a memory" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault()
        if (!photo && !caption.trim()) return
        setSaving(true)
        try {
          await api.addMemory(trip.trip_id, user.id, {
            day: preset?.day ?? stop?.day ?? 1, item_id: preset?.item_id ?? stop?.id, stop: preset?.stop ?? stop?.name ?? 'Jaipur', caption: caption.trim(), photo,
          })
          onSaved()
        } catch (err) {
          notify((err as Error).message, 'error')
        } finally {
          setSaving(false)
        }
      }}>
        {preset ? <p className="muted">At <b>{preset.stop}</b></p> : (
          <label>Where
            <select value={sel} onChange={(e) => setSel(e.target.value)}>
              {stops.map((s) => <option key={s.id} value={s.id}>Day {s.day} · {s.name}</option>)}
            </select>
          </label>
        )}
        <label>Photo
          <input type="file" accept="image/*" capture="environment" onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try { setPhoto(await resizeImage(f)) } catch (err) { notify((err as Error).message, 'error') }
          }} />
        </label>
        {photo && <img className="memory-preview" src={photo} alt="Preview" />}
        <label>Caption<input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Sunset from the ramparts was unreal" /></label>
        <button className="btn btn-primary" disabled={saving || (!photo && !caption.trim())}>{saving ? 'Saving…' : 'Save memory'}</button>
      </form>
    </Modal>
  )
}
