import { useState } from 'react'
import type { User } from '../types'
import { Avatar } from './ui'

export default function Login({ users, onLogin, onCreate }: {
  users: User[]
  onLogin: (id: string) => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  return (
    <div className="login">
      <div className="login-card card">
        <div className="brand login-brand"><span className="brand-mark">🛡️</span><span>DelayProof<span className="brand-sub">Trip</span></span></div>
        <h1>Plan together. Travel delay-proof.</h1>
        <p className="muted">Pick who you are. Open a second window as a friend to see sharing, group chat and polls live.</p>
        <div className="login-users">
          {users.map((u) => (
            <button key={u.id} className="login-user" onClick={() => onLogin(u.id)}>
              <Avatar user={u} size={48} />
              <b>{u.name}</b>
              <span className="small muted cap">{u.prefs.diet !== 'any' ? `${u.prefs.diet} · ` : ''}{u.prefs.interests.slice(0, 2).join(', ')}{u.prefs.mobility === 'limited' ? ' · easy walking' : ''}</span>
            </button>
          ))}
        </div>
        <form className="login-new" onSubmit={async (e) => { e.preventDefault(); if (name.trim()) await onCreate(name.trim()) }}>
          <input placeholder="Or type your name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
          <button className="btn btn-primary" disabled={!name.trim()}>Continue</button>
        </form>
        <p className="small muted">Demo sign-in: no password. Each browser tab remembers its own person.</p>
      </div>
    </div>
  )
}
