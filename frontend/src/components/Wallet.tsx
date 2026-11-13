import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { autoTickets, fileToDataUrl, qrCells } from '../features'
import { IRCTC, NTES, bookingCom } from '../handoffs'
import type { Ticket, Trip, User } from '../types'
import { Empty, Modal } from './ui'

const KIND_ICON: Record<string, string> = { train: '🚆', hotel: '🏨', entry: '🎟️', custom: '📎' }

export default function Wallet({ trip, user, users, notify }: {
  trip: Trip; user: User; users: Record<string, User>; notify: (t: string, k?: 'info' | 'error') => void
}) {
  const [uploaded, setUploaded] = useState<Ticket[]>([])
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<Ticket | null>(null)
  const id = trip.trip_id
  const load = useCallback(() => api.tickets(id).then(setUploaded).catch(() => {}), [id])
  useEffect(() => { load() }, [load])
  useEffect(() => api.subscribe((e) => { if (e.trip_id === id && e.type === 'tickets') load() }), [id, load])

  const auto = useMemo(() => autoTickets(trip), [trip])
  const all = [...auto, ...uploaded]
  const byDay = trip.days.map((d) => ({ day: d.day, list: all.filter((t) => (t.day ?? 1) === d.day) }))

  return (
    <div className="wallet">
      <div className="section-bar">
        <div>
          <h2 className="section-title">Ticket wallet</h2>
          <p className="muted small">Package tickets update with the plan (delays, moved stops). Add your own PDFs or photos too. Works offline.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add ticket</button>
      </div>
      {byDay.map(({ day, list }) => (
        <section key={day}>
          <h3 className="wallet-day">Day {day}</h3>
          {list.length === 0 ? <p className="muted small">No tickets for this day.</p> : (
            <div className="ticket-grid">
              {list.map((t) => (
                <button key={t.id} className={`ticket ticket-${t.kind}`} onClick={() => setOpen(t)}>
                  <span className="ticket-icon" aria-hidden>{KIND_ICON[t.kind]}</span>
                  <span className="ticket-main">
                    <b>{t.title}</b>
                    {t.subtitle && <span className="small muted">{t.subtitle}</span>}
                    <span className="small mono">{t.code ?? t.file_name}</span>
                  </span>
                  <span className="ticket-side">
                    {t.time && <span className="small mono">{t.time}</span>}
                    {t.status && <span className={`badge ${/late|moved/i.test(t.status) ? 'st-delayed' : 'st-rescued'}`}>{t.status}</span>}
                    {!t.auto && <span className="small muted">by {users[t.added_by ?? '']?.name ?? 'you'}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
      {all.length === 0 && <Empty icon="🎫" title="No tickets yet" />}
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)}>
          <TicketDetail t={open} trip={trip} onDelete={open.auto ? undefined : async () => { await api.deleteTicket(id, open.id); setOpen(null); load() }} />
        </Modal>
      )}
      {adding && <AddTicket trip={trip} onClose={() => setAdding(false)} onAdd={async (t) => {
        try {
          await api.addTicket(id, user.id, t)
          setAdding(false)
          load()
          notify('Ticket saved to the wallet')
        } catch (e) { notify((e as Error).message, 'error') }
      }} />}
    </div>
  )
}

function TicketDetail({ t, trip, onDelete }: { t: Ticket; trip?: Trip; onDelete?: () => void }) {
  const cells = qrCells(t.code ?? t.id)
  const isImg = t.file?.startsWith('data:image') || /\.(png|jpe?g|webp)$/i.test(t.file_name ?? '')
  return (
    <div className="ticket-detail">
      {t.subtitle && <p className="muted">{t.subtitle}</p>}
      {t.time && <p><b>{t.time}</b></p>}
      {t.status && <p><span className={`badge ${/late|moved/i.test(t.status) ? 'st-delayed' : 'st-rescued'}`}>{t.status}</span></p>}
      {t.file ? (
        isImg ? <img className="ticket-img" src={t.file} alt={t.title} /> : <a className="btn" href={t.file} download={t.file_name} target="_blank" rel="noreferrer">📄 Open {t.file_name ?? 'file'}</a>
      ) : (
        <figure className="qr" aria-label="Ticket QR code (mock)">
          <svg viewBox={`0 0 ${cells.length} ${cells.length}`} shapeRendering="crispEdges">
            {cells.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null)))}
          </svg>
          <figcaption className="mono">{t.code}</figcaption>
        </figure>
      )}
      {t.auto && <p className="small muted">Mock booking from the package. In production this comes from IRCTC / the hotel / ASI e-tickets.</p>}
      {t.auto && t.kind === 'train' && (
        <div className="row-gap">
          <a className="btn btn-sm" href={NTES(t.title.split(' ')[0])} target="_blank" rel="noreferrer">⏱️ Live running status (NTES) · train {t.title.split(' ')[0]}</a>
          <a className="btn btn-sm" href={IRCTC} target="_blank" rel="noreferrer">🚆 Book on IRCTC</a>
        </div>
      )}
      {t.auto && t.kind === 'hotel' && trip && (
        <a className="btn btn-sm" href={bookingCom(trip, t.title)} target="_blank" rel="noreferrer">🏨 Check on Booking.com (your dates)</a>
      )}
      {onDelete && <button className="btn btn-sm" onClick={onDelete}>Delete ticket</button>}
    </div>
  )
}

function AddTicket({ trip, onClose, onAdd }: {
  trip: Trip; onClose: () => void; onAdd: (t: Pick<Ticket, 'title' | 'kind' | 'subtitle' | 'code' | 'day' | 'file' | 'file_name'>) => void
}) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<Ticket['kind']>('custom')
  const [day, setDay] = useState(1)
  const [code, setCode] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState('')
  return (
    <Modal title="Add a ticket" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault()
        if (!title.trim()) return
        if (file && file.size > 3_000_000) return setErr('Files up to 3 MB please.')
        onAdd({ title: title.trim(), kind, day, code: code || undefined, file: file ? await fileToDataUrl(file) : undefined, file_name: file?.name })
      }}>
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chokhi Dhani dinner pass" /></label>
        <div className="form-row">
          <label>Type
            <select value={kind} onChange={(e) => setKind(e.target.value as Ticket['kind'])}>
              <option value="custom">Other</option><option value="train">Train</option><option value="hotel">Hotel</option><option value="entry">Entry ticket</option>
            </select>
          </label>
          <label>Day
            <select value={day} onChange={(e) => setDay(Number(e.target.value))}>{trip.days.map((d) => <option key={d.day} value={d.day}>Day {d.day}</option>)}</select>
          </label>
        </div>
        <label>Booking code (optional)<input value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <label>PDF or photo (optional)<input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        {err && <p className="neg small">{err}</p>}
        <button className="btn btn-primary">Save ticket</button>
      </form>
    </Modal>
  )
}
