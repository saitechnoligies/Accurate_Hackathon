import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type TripOptions } from './api'
import AgentChat from './components/AgentChat'
import CalendarView from './components/CalendarView'
import DisruptionPanel from './components/DisruptionPanel'
import GroupChat from './components/GroupChat'
import Home from './components/Home'
import Journal from './components/Journal'
import JourneyStrip from './components/JourneyStrip'
import JudgeDrawer from './components/JudgeDrawer'
import Login from './components/Login'
import Memories from './components/Memories'
import PocketPass from './components/PocketPass'
import PrefsModal from './components/PrefsModal'
import Receipt from './components/Receipt'
import ReplanBanner from './components/ReplanBanner'
import Timeline from './components/Timeline'
import TripMap from './components/TripMap'
import TripMode from './components/TripMode'
import { Avatar, Avatars } from './components/ui'
import Wallet from './components/Wallet'
import Expenses from './components/Expenses'
import Guide from './components/Guide'
import Packing from './components/Packing'
import Proactive from './components/Proactive'
import type { Suggestion } from './proactive'
import { useLive } from './useLive'
import { useTripData } from './useTripData'
import { useReminders } from './voice'
import type { Disruptions, Expense, Item, Meta, Trip, TripSummary, User } from './types'
import { storage } from './util'

const TRIP_KEY = 'delayproof.trip'
const USER_KEY = 'delayproof.user'

type Tab = 'plan' | 'assistant' | 'group' | 'wallet' | 'expenses' | 'packing' | 'memories' | 'journal' | 'calendar' | 'guide'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'plan', label: 'Plan', icon: '🗺️' },
  { id: 'assistant', label: 'Assistant', icon: '🤖' },
  { id: 'group', label: 'Group', icon: '💬' },
  { id: 'wallet', label: 'Wallet', icon: '🎫' },
  { id: 'expenses', label: 'Expenses', icon: '💸' },
  { id: 'packing', label: 'Packing', icon: '🧳' },
  { id: 'memories', label: 'Memories', icon: '📸' },
  { id: 'journal', label: 'Journal', icon: '📓' },
  { id: 'calendar', label: 'Calendar', icon: '📅' },
  { id: 'guide', label: 'Guide', icon: '🧭' },
]

/** Per-tab identity so two windows can be two different friends. */
function session(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return sessionStorage.getItem(key)
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    /* unavailable */
  }
  return null
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [uid, setUid] = useState<string | null>(() => session(USER_KEY) ?? storage(USER_KEY))
  const [trips, setTrips] = useState<TripSummary[]>([])
  const [trip, setTrip] = useState<Trip | null>(null)
  const [tab, setTab] = useState<Tab>('plan')
  const [day, setDay] = useState(1)
  const [busy, setBusy] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [modeHidden, setModeHidden] = useState(false)
  const [toast, setToast] = useState<{ text: string; kind: 'info' | 'error' } | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)

  const user = useMemo(() => users.find((u) => u.id === uid) ?? null, [users, uid])
  const live = useLive(trip)
  const [expenses, setExpenses] = useTripData<Expense>(trip?.trip_id, 'expenses', api.expenses)
  useReminders((label) => setToast({ text: `⏰ Reminder: ${label}`, kind: 'info' }))
  const userMap = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users])

  const loadUsers = useCallback(() => api.users().then(setUsers), [])
  const loadTrips = useCallback(() => { if (uid) api.trips(uid).then(setTrips).catch(() => setTrips([])) }, [uid])

  useEffect(() => {
    api.meta().then(setMeta).catch((e) => setBootError(e.message))
    loadUsers().catch((e) => setBootError(e.message))
  }, [loadUsers])

  useEffect(() => { loadTrips() }, [loadTrips])

  // reopen the last trip of this tab
  useEffect(() => {
    if (!uid) return
    const saved = session(TRIP_KEY) ?? storage(TRIP_KEY)
    if (saved && !trip) api.trip(saved).then((t) => {
      if (t.members?.some((m) => m.user_id === uid) ?? true) setTrip(t)
    }).catch(() => storage(TRIP_KEY, null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  // invite links: ?join=CODE and #import=...
  useEffect(() => {
    if (!uid) return
    const url = new URL(location.href)
    const join = url.searchParams.get('join')
    const imp = location.hash.startsWith('#import=') ? location.hash.slice(8) : null
    if (!join && !imp) return
    history.replaceState(null, '', location.pathname)
    run(() => (join ? api.join(join, uid) : api.importTrip(imp!, uid)).then((t) => ({ ...t, message: join ? `You joined "${t.title}".` : `Imported "${t.title}".` })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  // live updates from other tabs / the server
  useEffect(() => api.subscribe((e) => {
    if (e.type === 'trips') { loadTrips(); loadUsers() }
    if (e.type === 'trip' && trip && e.trip_id === trip.trip_id) {
      api.trip(trip.trip_id).then((t) => setTrip((cur) => (cur && cur.trip_id === t.trip_id ? { ...t, message: null } : cur))).catch(() => {})
    }
  }), [trip, loadTrips, loadUsers])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const run = useCallback(async (fn: () => Promise<Trip>) => {
    setBusy(true)
    try {
      const t = await fn()
      setTrip(t)
      session(TRIP_KEY, t.trip_id)
      storage(TRIP_KEY, t.trip_id)
      if (t.message) setToast({ text: t.message, kind: 'info' })
    } catch (e) {
      setToast({ text: (e as Error).message, kind: 'error' })
    } finally {
      setBusy(false)
    }
  }, [])

  const notify = (text: string, kind: 'info' | 'error' = 'info') => setToast({ text, kind })

  const login = (id: string) => {
    session(USER_KEY, id)
    storage(USER_KEY, id)
    setUid(id)
  }
  const logout = () => {
    session(USER_KEY, null)
    storage(USER_KEY, null)
    session(TRIP_KEY, null)
    setUid(null)
    setTrip(null)
    setMenu(false)
  }

  const start = (opts: TripOptions) => {
    setDay(1)
    setTab('plan')
    run(() => api.createTrip({ ...opts, user_id: uid! }))
  }
  const openTrip = (id: string) => {
    setDay(1)
    setTab('plan')
    setModeHidden(false)
    run(() => api.trip(id))
  }
  const disrupt = (d: Partial<Disruptions>) => trip && run(() => api.disrupt(trip.trip_id, d, uid!))
  const reset = () => trip && run(() => api.reset(trip.trip_id, uid!))
  const swap = (id: string) => trip && run(() => api.swap(trip.trip_id, id, uid!))
  const feedback = (id: string, a: 'kept' | 'skipped') => trip && run(() => api.feedback(trip.trip_id, id, a, uid!))
  const rideLog = (it: Item, actual: number) =>
    trip && it.frm?.zone && it.to?.zone &&
    run(() => api.rideLog(trip.trip_id, {
      from_zone: it.frm!.zone!, to_zone: it.to!.zone!, planned_min: it.end_min - it.start_min, actual_min: actual,
      buffer_used: it.buffer ?? undefined,
    }))
  const refresh = () => trip && run(async () => ({ ...(await api.trip(trip.trip_id)), message: null }))
  const goHome = () => {
    session(TRIP_KEY, null)
    storage(TRIP_KEY, null)
    setTrip(null)
    setDrawer(false)
    loadTrips()
  }
  /** A proactive suggestion was accepted: apply it through the planner. */
  const accept = (s: Suggestion) => {
    if (!trip || !s.action) return
    const a = s.action.do
    if (a.type === 'disrupt') run(() => api.disrupt(trip.trip_id, a.patch, uid!))
    else if (a.type === 'skip') run(() => api.feedback(trip.trip_id, a.attraction_id, 'skipped', uid!))
    else if (a.type === 'swap') run(() => api.swap(trip.trip_id, a.attraction_id, uid!))
    else if (a.type === 'packing') api.addPacking(trip.trip_id, uid!, a.items.map((text) => ({ text, category: 'Health', why: s.title })))
      .then(() => { setToast({ text: 'Added to the packing list', kind: 'info' }); setTab('packing') })
    else if (a.type === 'tab') setTab(a.tab as Tab)
  }
  const setMode = (on: boolean) => {
    if (!trip) return
    setModeHidden(false)
    run(() => api.setMode(trip.trip_id, on, uid!))
  }

  if (bootError) {
    return (
      <div className="boot">
        <h2>Couldn’t start DelayProof</h2>
        <p className="muted">{bootError}</p>
        <p className="muted small">{api.mode === 'server' ? 'Is the backend running on port 8000?' : 'Try reloading the page.'}</p>
      </div>
    )
  }
  if (!meta || !users.length) return <div className="boot"><div className="spinner" aria-label="Loading" /></div>
  if (!user) return <Login users={users} onLogin={login} onCreate={async (name) => { const u = await api.createUser(name); await loadUsers(); login(u.id) }} />

  const showMode = trip?.mode_on && !modeHidden

  return (
    <>
      <div className="app">
        <header className="topbar">
          <button className="brand" onClick={goHome} title="Your trips">
            <span className="brand-mark" aria-hidden>🛡️</span>
            <span>DelayProof<span className="brand-sub">Trip</span></span>
          </button>
          {trip && (
            <div className="topbar-trip">
              <span className="pill">{trip.title ?? trip.profile.persona_label}</span>
              <Avatars ids={(trip.members ?? []).map((m) => m.user_id)} users={userMap} />
            </div>
          )}
          <div className="topbar-actions">
            {busy && <span className="spinner spinner-sm" aria-label="Working" />}
            {trip && (
              <button className={`btn btn-sm ${trip.mode_on ? 'btn-live' : 'btn-primary'}`}
                onClick={() => (trip.mode_on ? (modeHidden ? setModeHidden(false) : setMode(false)) : setMode(true))}>
                {trip.mode_on ? (modeHidden ? '🧭 Open trip mode' : '⏹ End trip mode') : '🧭 Start trip mode'}
              </button>
            )}
            {trip && <button className="btn btn-ghost btn-sm hide-sm" onClick={() => window.print()}>🖨️ Pass</button>}
            {trip && <button className="btn btn-dark btn-sm hide-sm" onClick={() => setDrawer(true)}>🧠 Judge AI</button>}
            <div className="menu-wrap">
              <button className="avatar-btn" onClick={() => setMenu((m) => !m)} aria-label="Account menu">
                <Avatar user={user} />
              </button>
              {menu && (
                <div className="menu" onMouseLeave={() => setMenu(false)}>
                  <div className="menu-head"><Avatar user={user} /> <b>{user.name}</b></div>
                  <button onClick={() => { setPrefsOpen(true); setMenu(false) }}>⚙️ Preferences & AI</button>
                  {trip && <button onClick={() => { setDrawer(true); setMenu(false) }}>🧠 Judge AI</button>}
                  {trip && <button onClick={() => { window.print(); setMenu(false) }}>🖨️ Pocket pass</button>}
                  <button onClick={() => { goHome(); setMenu(false) }}>🏠 My trips</button>
                  <button onClick={logout}>🔁 Switch user</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {!trip ? (
          <Home meta={meta} user={user} users={userMap} trips={trips} busy={busy} onStart={start} onOpen={openTrip}
            onJoin={(code) => run(() => api.join(code, user.id).then((t) => ({ ...t, message: `You joined "${t.title}".` })))}
            onCreated={(id) => openTrip(id)} />
        ) : (
          <main className="trip">
            <JourneyStrip trip={trip} day={day} onDay={(d) => { setDay(d); setTab('plan') }} />
            <nav className="tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                  <span aria-hidden>{t.icon}</span> {t.label}
                </button>
              ))}
            </nav>

            {tab === 'plan' && (
              <div className="trip-grid">
                <div className="col-main">
                  <Proactive trip={trip} live={live} expenses={expenses} onAccept={accept} />
                  <ReplanBanner trip={trip} />
                  <DisruptionPanel trip={trip} busy={busy} onChange={disrupt} onReset={reset} />
                  <Timeline trip={trip} day={day} onDay={setDay} busy={busy} onSwap={swap} onFeedback={feedback} onRideLog={rideLog} />
                </div>
                <div className="col-side">
                  <TripMap trip={trip} day={day} meta={meta} />
                  <Receipt trip={trip} meta={meta} />
                </div>
              </div>
            )}
            {tab === 'assistant' && (
              <AgentChat user={user} trip={trip} onTrip={(t) => setTrip(t)} onCreated={openTrip} />
            )}
            {tab === 'group' && (
              <GroupChat trip={trip} user={user} users={userMap} allUsers={users} notify={notify} onTrip={(t) => setTrip(t)} />
            )}
            {tab === 'wallet' && <Wallet trip={trip} user={user} users={userMap} notify={notify} />}
            {tab === 'expenses' && <Expenses trip={trip} user={user} users={userMap} expenses={expenses} setExpenses={setExpenses} notify={notify} />}
            {tab === 'packing' && <Packing trip={trip} user={user} users={userMap} live={live} notify={notify} />}
            {tab === 'guide' && <Guide trip={trip} live={live} />}
            {tab === 'memories' && <Memories trip={trip} user={user} users={userMap} notify={notify} />}
            {tab === 'journal' && <Journal trip={trip} user={user} users={userMap} notify={notify} />}
            {tab === 'calendar' && <CalendarView trip={trip} trips={trips} onOpen={openTrip} onDay={(d) => { setDay(d); setTab('plan') }} />}
          </main>
        )}
      </div>

      {showMode && trip && (
        <TripMode trip={trip} user={user} busy={busy} notify={notify} onClose={() => setModeHidden(true)} onEnd={() => setMode(false)}
          onTrip={(t) => setTrip(t)} run={run} onSwap={swap} onFeedback={feedback} onGroup={() => { setModeHidden(true); setTab('group') }} />
      )}
      {prefsOpen && <PrefsModal user={user} trip={trip} onClose={() => setPrefsOpen(false)} notify={notify}
        onSaved={() => loadUsers()} onApplied={(t) => setTrip(t)} />}
      {trip && <JudgeDrawer open={drawer} onClose={() => setDrawer(false)} trip={trip} onModelChanged={refresh} />}
      {trip && <PocketPass trip={trip} meta={meta} />}
      {toast && (
        <div className={`toast ${toast.kind === 'error' ? 'toast-error' : ''}`} role="status">
          {toast.text}
          <button className="link" onClick={() => setToast(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
    </>
  )
}
