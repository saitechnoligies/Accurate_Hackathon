import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { AgentCard, AgentState, Trip, User } from '../types'
import { AgentCards } from './ui'

type Turn = { who: 'me' | 'ai'; text: string; cards?: AgentCard[]; suggestions?: string[] }

const START_NEW: Turn = {
  who: 'ai',
  text: "Hi! Tell me about your trip in one line: who's going, days, budget, what you love and anything to avoid. I'll plan it door to door.",
  suggestions: ['Family of 4, 2 days, ₹30k, we love history and food', 'Solo photographer, 3 days, sunsets, avoid the afternoon heat',
    'Student trip, ₹6,000, street food, as packed as possible', 'Veg trip with my elderly parents, no long walks'],
}
const START_TRIP: Turn = {
  who: 'ai',
  text: 'Ask me anything about this trip. I re-plan through the engine, so every change respects opening hours, trains and your budget.',
  suggestions: ['What if my train is 2 hours late?', 'Show photography spots', 'How do I get from Amber Fort to City Palace?', 'Show day 2', "What's my budget?", "It's raining"],
}

export default function AgentChat({ user, trip, onTrip, onCreated, compact }: {
  user: User
  trip: Trip | null
  onTrip?: (t: Trip) => void
  onCreated?: (id: string) => void
  compact?: boolean
}) {
  const [turns, setTurns] = useState<Turn[]>([trip ? START_TRIP : START_NEW])
  const [state, setState] = useState<AgentState>({ slots: {} })
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [brain, setBrain] = useState<string>('offline')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { api.settings().then((s) => setBrain(s.ai_brain)).catch(() => {}) }, [])
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [turns, thinking])

  const ask = async (q: string) => {
    if (!q.trim() || thinking) return
    setTurns((t) => [...t, { who: 'me', text: q }])
    setText('')
    setThinking(true)
    try {
      const r = await api.agent(q, { user_id: user.id, trip_id: trip?.trip_id, state })
      setState(r.state)
      setTurns((t) => [...t, { who: 'ai', text: r.reply, cards: r.cards, suggestions: r.suggestions }])
      if (r.trip && trip && onTrip) onTrip(r.trip)
      if (r.created_trip_id && onCreated) setTimeout(() => onCreated(r.created_trip_id!), 900)
    } catch (e) {
      setTurns((t) => [...t, { who: 'ai', text: `Sorry, something went wrong: ${(e as Error).message}` }])
    } finally {
      setThinking(false)
    }
  }

  const last = turns[turns.length - 1]
  return (
    <section className={`card chat ${compact ? 'chat-compact' : ''}`}>
      <div className="chat-head">
        <span className="chat-bot" aria-hidden>🤖</span>
        <div>
          <b>Trip assistant</b>
          <div className="small muted">{brain === 'llm' ? 'LLM brain selected · offline rules active' : 'Offline rule brain · runs on the planning engine'}</div>
        </div>
      </div>
      <div className="chat-log" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className={`bubble-row ${t.who}`}>
            <div className={`bubble ${t.who}`}>
              <div>{t.text}</div>
              {t.cards && t.cards.length > 0 && <AgentCards cards={t.cards} onAction={(q) => ask(q)} />}
            </div>
          </div>
        ))}
        {thinking && <div className="bubble-row ai"><div className="bubble ai typing"><span /><span /><span /></div></div>}
        <div ref={end} />
      </div>
      {last.who === 'ai' && last.suggestions && last.suggestions.length > 0 && (
        <div className="suggest">
          {last.suggestions.map((s) => <button key={s} className="chip" onClick={() => ask(s)} disabled={thinking}>{s}</button>)}
        </div>
      )}
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(text) }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={trip ? 'e.g. skip Jal Mahal, add Albert Hall, train 3h late…' : 'e.g. 2 days with my parents, veg, ₹30k, no long walks'} aria-label="Message the assistant" />
        <button className="btn btn-primary" disabled={thinking || !text.trim()}>Send</button>
      </form>
    </section>
  )
}
