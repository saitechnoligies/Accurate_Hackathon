import type { Meta, Trip } from '../types'
import { fmtDate, rupee } from '../util'

/** Printable offline pass. Hidden on screen, shown by @media print. */
export default function PocketPass({ trip, meta }: { trip: Trip; meta: Meta }) {
  const stay = meta.stays.find((s) => s.id === trip.profile.stay_id)
  return (
    <div className="pocket-pass">
      <header>
        <h1>DelayProof pocket pass</h1>
        <p>
          {trip.profile.persona_label} · {trip.profile.travelers} traveller(s) · {trip.profile.home.label} ⇄ Jaipur ·
          Trip #{trip.trip_id}
        </p>
        <p>Base stay: {stay?.name} · Total {rupee(trip.receipt.total)} of {rupee(trip.receipt.budget)}</p>
      </header>
      {trip.days.map((d) => (
        <section key={d.day}>
          <h2>Day {d.day} · {fmtDate(d.date)} · {d.title}</h2>
          <table>
            <tbody>
              {d.items.filter((i) => i.type !== 'transfer' || i.intercity).map((i) => (
                <tr key={i.id}>
                  <td className="pp-time">{i.start}</td>
                  <td>
                    <b>{i.title}</b>
                    {i.subtitle ? ` · ${i.subtitle}` : ''}
                    {i.plan_b ? <div className="pp-b">Plan B: {i.plan_b.name} ({i.plan_b.reason})</div> : null}
                  </td>
                  <td className="pp-cost">{i.cost ? rupee(i.cost) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <footer>
        Emergency 112 · Tourist helpline 1363 · Railway enquiry 139 · Women’s helpline 1091 · Jaipur Jn cloakroom: Platform 1
      </footer>
    </div>
  )
}
