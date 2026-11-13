import { useState } from 'react'
import { api } from '../api'
import { balances, plannedByDay, settleUp } from '../planhelpers'
import type { Expense, Trip, User } from '../types'
import { rupee } from '../util'
import { Avatar, Empty, timeAgo } from './ui'

export default function Expenses({ trip, user, users, expenses, setExpenses, notify }: {
  trip: Trip; user: User; users: Record<string, User>; expenses: Expense[]; setExpenses: (e: Expense[]) => void
  notify: (t: string, k?: 'info' | 'error') => void
}) {
  const id = trip.trip_id
  const members = (trip.members ?? []).map((m) => m.user_id)
  const name = (u: string) => (u === user.id ? 'You' : users[u]?.name ?? u)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(user.id)
  const [split, setSplit] = useState<string[]>(members)
  const [day, setDay] = useState(1)

  const run = async (p: Promise<Expense[]>) => {
    try { setExpenses(await p) } catch (e) { notify((e as Error).message, 'error') }
  }

  const pkg = expenses.filter((e) => e.category === 'package')
  const extras = expenses.filter((e) => e.category === 'extra')
  const extraTotal = extras.reduce((s, e) => s + e.amount, 0)
  const bs = balances(expenses, members)
  const transfers = settleUp(bs)
  const planned = plannedByDay(trip)
  const spentByDay = trip.days.map((d) => extras.filter((e) => e.day === d.day).reduce((s, e) => s + e.amount, 0))
  const maxBar = Math.max(1, ...planned.map((p, i) => p + spentByDay[i]))
  const total = trip.receipt.total + extraTotal
  const effSplit = split.filter((s) => members.includes(s))

  return (
    <div className="expenses">
      <div className="section-bar">
        <div>
          <h2 className="section-title">Expenses & settle-up</h2>
          <p className="muted small">The package comes from the plan; log what you actually spend on top. Balances show who owes whom with the fewest transfers.</p>
        </div>
      </div>

      <div className="kpi-row">
        <div className="card kpi"><span className="small muted">Package (plan)</span><b>{rupee(trip.receipt.total)}</b></div>
        <div className="card kpi"><span className="small muted">Logged extras</span><b>{rupee(extraTotal)}</b></div>
        <div className={`card kpi ${total > trip.receipt.budget ? 'kpi-bad' : ''}`}><span className="small muted">Total vs budget</span><b>{rupee(total)}</b><span className="small muted">of {rupee(trip.receipt.budget)}</span></div>
        <div className="card kpi"><span className="small muted">Per member</span><b>{rupee(total / Math.max(1, members.length))}</b><span className="small muted">{members.length} member{members.length > 1 ? 's' : ''}</span></div>
      </div>

      <div className="exp-grid">
        <section className="card">
          <h3>Spending by day</h3>
          <div className="bars" role="img" aria-label="Planned package cost and logged extras per day">
            {trip.days.map((d, i) => (
              <div key={d.day} className="bar-col">
                <div className="bar-stack" style={{ height: `${((planned[i] + spentByDay[i]) / maxBar) * 140}px` }}>
                  <div className="bar-extra" style={{ flex: spentByDay[i] }} title={`Extras ${rupee(spentByDay[i])}`} />
                  <div className="bar-plan" style={{ flex: planned[i] }} title={`Planned ${rupee(planned[i])}`} />
                </div>
                <b className="small">Day {d.day}</b><span className="small muted">{rupee(planned[i] + spentByDay[i])}</span>
              </div>
            ))}
          </div>
          <div className="legend small"><span><i className="sw sw-plan" />Package (plan)</span><span><i className="sw sw-extra" />Logged extras</span></div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Who owes whom</h3>
            {!pkg.length && <button className="btn btn-sm" onClick={() => run(api.addPackageExpenses(id, user.id))}>I paid the package</button>}
          </div>
          {expenses.length === 0 ? <p className="muted small">Nothing logged yet. Tap “I paid the package” or add an expense below.</p> : (
            <>
              <ul className="bal-list">
                {bs.map((b) => (
                  <li key={b.user_id}>
                    <Avatar user={users[b.user_id]} size={24} /><span className="grow">{name(b.user_id)}</span>
                    <span className="small muted">paid {rupee(b.paid)}</span>
                    <b className={b.net >= 0 ? 'pos' : 'neg'}>{b.net >= 0 ? '+' : '−'}{rupee(Math.abs(b.net))}</b>
                  </li>
                ))}
              </ul>
              {transfers.length ? (
                <ul className="settle">
                  {transfers.map((t, i) => <li key={i}><b>{name(t.from)}</b> pays <b>{name(t.to)}</b> <span className="mono">{rupee(t.amount)}</span></li>)}
                </ul>
              ) : <p className="pos small">All settled up 🎉</p>}
            </>
          )}
        </section>
      </div>

      <section className="card">
        <h3>Add an expense</h3>
        <form className="form exp-form" onSubmit={(e) => {
          e.preventDefault()
          const amt = Number(amount)
          if (!title.trim() || !(amt > 0)) return
          run(api.addExpense(id, user.id, { title: title.trim(), amount: amt, paid_by: paidBy, split: effSplit.length ? effSplit : members, day, category: 'extra' }))
          setTitle('')
          setAmount('')
        }}>
          <div className="form-row">
            <label>What<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dinner at Chokhi Dhani" maxLength={60} /></label>
            <label>Amount (₹)<input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            <label>Paid by
              <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>{members.map((m) => <option key={m} value={m}>{users[m]?.name ?? m}</option>)}</select>
            </label>
            <label>Day
              <select value={day} onChange={(e) => setDay(Number(e.target.value))}>{trip.days.map((d) => <option key={d.day} value={d.day}>Day {d.day}</option>)}</select>
            </label>
          </div>
          <div className="split-pick">
            <span className="small muted">Split between</span>
            {members.map((m) => (
              <label key={m} className="chip">
                <input type="checkbox" checked={split.includes(m)} onChange={() => setSplit(split.includes(m) ? split.filter((x) => x !== m) : [...split, m])} />
                {users[m]?.name ?? m}
              </label>
            ))}
          </div>
          <button className="btn btn-primary" disabled={!title.trim() || !(Number(amount) > 0)}>Add expense</button>
        </form>
      </section>

      <section className="card">
        <h3>All expenses</h3>
        {expenses.length === 0 ? <Empty icon="💸" title="No expenses yet" /> : (
          <ul className="exp-list">
            {[...expenses].reverse().map((e) => (
              <li key={e.id}>
                <span className={`badge ${e.category === 'package' ? 'badge-anchor' : 'st-upgraded'}`}>{e.category === 'package' ? 'Package' : `Day ${e.day}`}</span>
                <span className="grow"><b>{e.title}</b><span className="small muted"> · paid by {name(e.paid_by)} · split {e.split.length} way{e.split.length > 1 ? 's' : ''} · {timeAgo(e.at)}</span></span>
                <b className="mono">{rupee(e.amount)}</b>
                <button className="link small" onClick={() => run(api.deleteExpense(id, e.id))} aria-label={`Delete ${e.title}`}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
