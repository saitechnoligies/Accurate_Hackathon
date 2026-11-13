import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Message, Poll, Trip, User } from '../types'
import { rupee } from '../util'
import { AgentCards, Avatar, Modal, timeAgo } from './ui'

type Props = {
  trip: Trip
  user: User
  users: Record<string, User>
  allUsers: User[]
  notify: (t: string, k?: 'info' | 'error') => void
  onTrip: (t: Trip) => void
}

export default function GroupChat({ trip, user, users, allUsers, notify, onTrip }: Props) {
  const [msgs, setMsgs] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [pollOpen, setPollOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const id = trip.trip_id

  const load = useCallback(() => api.messages(id).then(setMsgs).catch(() => {}), [id])
  useEffect(() => { load() }, [load])
  useEffect(() => api.subscribe((e) => { if (e.trip_id === id && e.type === 'messages') load() }), [id, load])
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [msgs.length])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    try {
      setMsgs(await api.send(id, user.id, text.trim()))
      setText('')
      if (/^\s*@ai/i.test(text)) onTrip(await api.trip(id))
    } catch (err) {
      notify((err as Error).message, 'error')
    } finally {
      setSending(false)
    }
  }

  const vote = async (m: Message, opt: string) => {
    try {
      setMsgs(await api.vote(id, m.id, user.id, opt))
      onTrip(await api.trip(id))
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  const members = trip.members ?? []
  return (
    <div className="group">
      <section className="card chat group-chat">
        <div className="chat-head">
          <span className="chat-bot" aria-hidden>💬</span>
          <div>
            <b>{trip.title}</b>
            <div className="small muted">{members.length} member{members.length > 1 ? 's' : ''} · plan changes post here automatically · type <code>@ai</code> to ask the assistant</div>
          </div>
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setPollOpen(true)}>🗳️ Poll</button>
        </div>
        <div className="chat-log">
          {msgs.map((m) => <MessageRow key={m.id} m={m} me={user} users={users} members={members.length} onVote={vote} />)}
          <div ref={end} />
        </div>
        <form className="chat-input" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the group… (@ai what if it rains?)" aria-label="Message the group" />
          <button className="btn btn-primary" disabled={sending || !text.trim()}>Send</button>
        </form>
      </section>
      <Members trip={trip} user={user} users={users} allUsers={allUsers} notify={notify} onTrip={onTrip} />
      {pollOpen && <PollModal trip={trip} onClose={() => setPollOpen(false)} onCreate={async (p) => {
        setMsgs(await api.createPoll(id, user.id, p))
        setPollOpen(false)
      }} />}
    </div>
  )
}

function MessageRow({ m, me, users, members, onVote }: {
  m: Message; me: User; users: Record<string, User>; members: number; onVote: (m: Message, opt: string) => void
}) {
  if (m.kind === 'system') return <div className="sys-msg"><span>{m.text}</span><small>{timeAgo(m.at)}</small></div>
  const mine = m.user_id === me.id
  const u = users[m.user_id]
  const isAgent = m.user_id === 'agent'
  return (
    <div className={`msg ${mine ? 'mine' : ''}`}>
      {!mine && (isAgent ? <span className="avatar avatar-bot">🤖</span> : <Avatar user={u} size={30} />)}
      <div className={`msg-body ${isAgent ? 'agent' : ''}`}>
        {!mine && <div className="msg-who">{isAgent ? 'Trip assistant' : u?.name ?? m.user_id}</div>}
        {m.kind === 'poll' && m.poll ? <PollView m={m} poll={m.poll} me={me} users={users} members={members} onVote={onVote} /> : <div>{m.text}</div>}
        {m.cards && m.cards.length > 0 && <AgentCards cards={m.cards} />}
        <div className="msg-time">{timeAgo(m.at)}</div>
      </div>
    </div>
  )
}

function PollView({ m, poll, me, users, members, onVote }: {
  m: Message; poll: Poll; me: User; users: Record<string, User>; members: number; onVote: (m: Message, opt: string) => void
}) {
  const total = Object.keys(poll.votes).length
  return (
    <div className="poll">
      <b>🗳️ {poll.question}</b>
      {poll.options.map((o) => {
        const voters = Object.entries(poll.votes).filter(([, v]) => v === o.id).map(([u]) => u)
        const pct = members ? (voters.length / members) * 100 : 0
        const mine = poll.votes[me.id] === o.id
        return (
          <button key={o.id} className={`poll-opt ${mine ? 'on' : ''}`} disabled={poll.closed} onClick={() => onVote(m, o.id)}>
            <span className="poll-bar" style={{ width: `${pct}%` }} />
            <span className="poll-label">{o.label}</span>
            <span className="poll-voters">{voters.map((v) => users[v]?.emoji ?? '•').join('')} {voters.length || ''}</span>
          </button>
        )
      })}
      <div className="small muted">
        {poll.closed ? `Closed → ${poll.result}` : `${total}/${members} voted · majority decides${poll.action ? ' and applies the swap' : ''}`}
      </div>
    </div>
  )
}

function PollModal({ trip, onClose, onCreate }: {
  trip: Trip; onClose: () => void; onCreate: (p: Pick<Poll, 'question' | 'options' | 'action'>) => Promise<void>
}) {
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState(['', ''])
  const swaps = trip.days.flatMap((d) => d.items).filter((i) => i.type === 'visit' && i.plan_b)
  return (
    <Modal title="New poll" onClose={onClose}>
      {swaps.length > 0 && (
        <div className="poll-quick">
          <div className="small muted">Quick: let the group decide a Plan B swap (applies itself on a majority yes)</div>
          <div className="chips chips-left">
            {swaps.slice(0, 6).map((i) => (
              <button key={i.id} className="chip" onClick={() => onCreate({
                question: `Swap ${i.title} for ${i.plan_b!.name}?`,
                options: [{ id: 'yes', label: `Yes, go to ${i.plan_b!.name}` }, { id: 'no', label: `No, keep ${i.title}` }],
                action: { type: 'swap', attraction_id: i.attraction_id!, alt_id: i.plan_b!.id, alt_name: i.plan_b!.name },
              })}>{i.title} → {i.plan_b!.name}</button>
            ))}
          </div>
        </div>
      )}
      <form className="form" onSubmit={(e) => {
        e.preventDefault()
        const options = opts.map((o) => o.trim()).filter(Boolean).map((label, i) => ({ id: `o${i}`, label }))
        if (q.trim() && options.length >= 2) onCreate({ question: q.trim(), options })
      }}>
        <label>Question<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Dinner on Day 1?" /></label>
        {opts.map((o, i) => (
          <label key={i}>Option {i + 1}<input value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} /></label>
        ))}
        <div className="row-gap">
          {opts.length < 5 && <button type="button" className="btn btn-sm" onClick={() => setOpts([...opts, ''])}>+ Option</button>}
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}>Create poll</button>
        </div>
      </form>
    </Modal>
  )
}

function Members({ trip, user, users, allUsers, notify, onTrip }: Omit<Props, 'notify'> & { notify: Props['notify'] }) {
  const [links, setLinks] = useState<{ invite: string; copy: string; code: string } | null>(null)
  const members = trip.members ?? []
  const others = allUsers.filter((u) => !members.some((m) => m.user_id === u.id))
  const isOwner = trip.owner_id === user.id
  const share = trip.receipt.total / Math.max(1, members.length)

  useEffect(() => { api.shareLink(trip.trip_id).then(setLinks).catch(() => {}) }, [trip.trip_id])

  const copy = async (s: string, what: string) => {
    try {
      await navigator.clipboard.writeText(s)
      notify(`${what} copied`)
    } catch {
      notify(s)
    }
  }
  const nativeShare = async () => {
    if (!links) return
    const data = { title: trip.title ?? 'DelayProof trip', text: `Join my trip "${trip.title}" on DelayProof. Code ${links.code}`, url: links.invite }
    if (navigator.share) {
      try { await navigator.share(data) } catch { /* cancelled */ }
    } else copy(`${data.text}\n${data.url}`, 'Invite')
  }

  return (
    <aside className="card members">
      <h3>Members</h3>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.user_id}>
            <Avatar user={users[m.user_id]} />
            <div className="grow"><b>{users[m.user_id]?.name ?? m.user_id}{m.user_id === user.id ? ' (you)' : ''}</b><div className="small muted cap">{m.role}</div></div>
            <span className="mono small">{rupee(share)}</span>
            {isOwner && m.role !== 'owner' && (
              <button className="link small" onClick={async () => onTrip(await api.removeMember(trip.trip_id, m.user_id, user.id))}>remove</button>
            )}
          </li>
        ))}
      </ul>
      <div className="split small muted">Split equally: {rupee(trip.receipt.total)} ÷ {members.length} = <b>{rupee(share)}</b> each</div>

      {others.length > 0 && (
        <div className="add-friend">
          <div className="small muted">Add a friend directly</div>
          <div className="chips chips-left">
            {others.map((u) => (
              <button key={u.id} className="chip" onClick={async () => {
                try { onTrip(await api.addMember(trip.trip_id, u.id, user.id)); notify(`${u.name} added to the trip`) } catch (e) { notify((e as Error).message, 'error') }
              }}>{u.emoji} {u.name}</button>
            ))}
          </div>
        </div>
      )}

      {links && (
        <div className="invite">
          <div className="small muted">Invite code</div>
          <div className="invite-code" aria-label="Invite code">{links.code}</div>
          <div className="row-gap">
            <button className="btn btn-sm" onClick={() => copy(links.invite, 'Invite link')}>🔗 Copy invite link</button>
            <button className="btn btn-sm" onClick={nativeShare}>📤 Share</button>
          </div>
          {api.mode === 'browser' && (
            <button className="link small" onClick={() => copy(links.copy, 'Trip copy link')}>Copy a link that carries the whole trip (opens on any device)</button>
          )}
        </div>
      )}
    </aside>
  )
}
