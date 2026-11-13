import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Prefs, Trip, User } from '../types'
import { Modal } from './ui'

const INTERESTS = ['history', 'culture', 'food', 'photography', 'nature', 'shopping', 'spiritual', 'art', 'science']

export default function PrefsModal({ user, trip, onClose, notify, onSaved, onApplied }: {
  user: User; trip: Trip | null; onClose: () => void; notify: (t: string, k?: 'info' | 'error') => void
  onSaved: () => void; onApplied: (t: Trip) => void
}) {
  const [p, setP] = useState<Prefs>({ ...user.prefs })
  const [brain, setBrain] = useState<'offline' | 'llm'>('offline')
  const [hasKey, setHasKey] = useState(false)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { api.settings().then((s) => { setBrain(s.ai_brain); setHasKey(s.has_key) }).catch(() => {}) }, [])

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP((x) => ({ ...x, [k]: v }))
  const toggle = (t: string) => set('interests', p.interests.includes(t) ? p.interests.filter((x) => x !== t) : [...p.interests, t])

  const save = async (apply: boolean) => {
    setSaving(true)
    try {
      await api.savePrefs(user.id, p)
      await api.saveSettings(brain, key || undefined)
      onSaved()
      if (apply && trip) onApplied(await api.applyPrefs(trip.trip_id, p, user.id))
      notify(apply ? 'Preferences saved and the trip was re-planned around them' : 'Preferences saved')
      onClose()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`${user.name}'s preferences`} onClose={onClose} wide>
      <div className="form prefs">
        <fieldset>
          <legend>What do you love?</legend>
          <div className="chips chips-left">
            {INTERESTS.map((t) => <button key={t} type="button" className={`chip cap ${p.interests.includes(t) ? 'chip-on' : ''}`} onClick={() => toggle(t)}>{t}</button>)}
          </div>
        </fieldset>
        <div className="form-row">
          <label>Pace
            <select value={p.pace} onChange={(e) => set('pace', e.target.value as Prefs['pace'])}>
              <option value="relaxed">Relaxed (max 4 stops)</option><option value="balanced">Balanced</option><option value="packed">Packed (up to 7)</option>
            </select>
          </label>
          <label>Diet
            <select value={p.diet} onChange={(e) => set('diet', e.target.value as Prefs['diet'])}>
              <option value="any">Anything</option><option value="veg">Vegetarian</option><option value="jain">Jain</option>
            </select>
          </label>
          <label>Walking
            <select value={p.mobility} onChange={(e) => set('mobility', e.target.value as Prefs['mobility'])}>
              <option value="normal">Happy to walk</option><option value="limited">Limited: no stairs, short walks, cabs</option>
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>Day starts<input type="time" value={p.day_start} onChange={(e) => set('day_start', e.target.value)} /></label>
          <label>Day ends<input type="time" value={p.day_end} onChange={(e) => set('day_end', e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={p.avoid_heat} onChange={(e) => set('avoid_heat', e.target.checked)} /> Stay indoors 12:00–16:00</label>
        </div>
        <p className="small muted">These change the plan itself: diet filters meal stops, limited walking skips stair-heavy forts and books cabs, heat keeps outdoor sights out of the afternoon.</p>

        <fieldset className="ai-box">
          <legend>AI assistant brain</legend>
          <div className="seg">
            <button type="button" className={brain === 'offline' ? 'on' : ''} onClick={() => setBrain('offline')}>Offline rules (active)</button>
            <button type="button" className={brain === 'llm' ? 'on' : ''} onClick={() => setBrain('llm')}>LLM (API key)</button>
          </div>
          {brain === 'llm' && (
            <label>LLM API key {hasKey && <span className="small muted">(saved)</span>}
              <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
                placeholder={api.mode === 'server' ? 'Set LLM_API_KEY in backend/.env instead' : 'Paste your API key'} disabled={api.mode === 'server'} />
            </label>
          )}
          <p className="small muted">
            The demo runs on the offline rule brain, which works without internet or keys. The LLM slot plugs into the same
            tools (plan, re-plan, swap, add, compare rides), so a model can drive the planner without inventing times or prices.
            {api.mode === 'browser' ? ' A key entered here stays in this browser only.' : ' On the server the key lives in backend/.env and never reaches the browser.'}
          </p>
        </fieldset>

        <div className="row-gap">
          <button className="btn" disabled={saving} onClick={() => save(false)}>Save</button>
          {trip && <button className="btn btn-primary" disabled={saving} onClick={() => save(true)}>Save & re-plan “{trip.title}”</button>}
        </div>
      </div>
    </Modal>
  )
}
