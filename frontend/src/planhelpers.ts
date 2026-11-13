/* Packing suggestions and expense settle-up, derived from the plan. Shared by both branches. */
import type { Expense, Trip } from './types'
import type { Fetched, Weather } from './live'
import { rupee } from './util'

export type PackSuggestion = { text: string; category: string; why: string }

/** Items the plan itself implies: tickets, weather, walking, diet, kids, late nights, the cloakroom… */
export function suggestPacking(trip: Trip, weather: Fetched<Weather> | null): PackSuggestion[] {
  const p = trip.profile
  const items = trip.days.flatMap((d) => d.items)
  const out: PackSuggestion[] = [
    { text: 'Government photo ID (needed on the train)', category: 'Documents', why: 'Indian Railways checks ID for reserved tickets' },
    { text: 'Phone charger + power bank', category: 'Essentials', why: `You leave home at ${trip.days[0].items[0].start} and the day runs long` },
    { text: 'Reusable water bottle', category: 'Essentials', why: 'Long outdoor stretches between stops' },
  ]
  const byDate = new Map((weather?.data.days ?? []).map((d) => [d.date, d]))
  const maxT = Math.max(0, ...trip.days.map((d) => byDate.get(d.date)?.max ?? 0))
  const wet = trip.days.some((d) => (byDate.get(d.date)?.rain ?? 0) >= 50)
  if (maxT >= 33 || trip.disruptions.weather === 'heat') {
    out.push({ text: 'Sunscreen SPF 50', category: 'Health', why: maxT ? `Forecast up to ${maxT}°C` : 'Heat plan is on' },
      { text: 'Cap or scarf', category: 'Clothing', why: 'Shade at the forts is limited' },
      { text: 'ORS sachets', category: 'Health', why: 'Rehydration in the heat' })
  }
  if (wet || trip.disruptions.weather === 'rain') out.push({ text: 'Umbrella / rain jacket', category: 'Clothing', why: 'Rain in the forecast' })
  if (maxT && maxT < 24) out.push({ text: 'Light jacket for evenings', category: 'Clothing', why: `Nights down to ${Math.min(...trip.days.map((d) => byDate.get(d.date)?.min ?? 99))}°C` })
  if (items.some((i) => i.type === 'visit' && ['amber_fort', 'nahargarh_fort', 'jaigarh_fort', 'galtaji'].includes(i.attraction_id ?? '')))
    out.push({ text: 'Comfortable walking shoes', category: 'Clothing', why: 'Ramps and steps at the hill forts' })
  if (items.some((i) => i.type === 'visit' && (i.tags ?? []).includes('spiritual')))
    out.push({ text: 'Socks for temples (shoes come off)', category: 'Clothing', why: 'Temple stops in the plan' })
  if (p.persona_id === 'family' || p.travelers >= 3) out.push({ text: 'Snacks for the train', category: 'Food', why: 'Early start, kids get hungry before Jaipur' })
  if (p.diet === 'jain') out.push({ text: 'Jain snacks as backup', category: 'Food', why: 'Not every stop has Jain options' })
  if (p.mobility === 'limited') out.push({ text: 'Regular medicines + prescriptions', category: 'Health', why: 'Limited-mobility traveller in the group' },
    { text: 'Foldable walking stick / seat', category: 'Health', why: 'Queues at ticket counters' })
  if (items.some((i) => i.type === 'cloakroom')) out.push({ text: 'Small day bag (main bags go to the cloakroom)', category: 'Essentials', why: 'Delay plan drops bags at the station' })
  if (items.some((i) => i.safety)) out.push({ text: 'Offline copy of the pocket pass', category: 'Documents', why: 'Late-night arrival home' })
  if (items.some((i) => (i.tags ?? []).includes('photography'))) out.push({ text: 'Camera + spare battery', category: 'Essentials', why: 'Photography stops in the plan' })
  if (items.some((i) => (i.tags ?? []).includes('shopping'))) out.push({ text: 'Cash for bazaars', category: 'Essentials', why: 'Small shops prefer UPI or cash' })
  return out
}

// ------------------------------------------------------------------ expenses
export type Balance = { user_id: string; paid: number; share: number; net: number }
export type Transfer = { from: string; to: string; amount: number }

export function balances(expenses: Expense[], members: string[]): Balance[] {
  const b = new Map(members.map((m) => [m, { user_id: m, paid: 0, share: 0, net: 0 }]))
  for (const e of expenses) {
    const split = e.split.length ? e.split : members
    if (!b.has(e.paid_by)) b.set(e.paid_by, { user_id: e.paid_by, paid: 0, share: 0, net: 0 })
    b.get(e.paid_by)!.paid += e.amount
    for (const u of split) {
      if (!b.has(u)) b.set(u, { user_id: u, paid: 0, share: 0, net: 0 })
      b.get(u)!.share += e.amount / split.length
    }
  }
  return [...b.values()].map((x) => ({ ...x, net: Math.round(x.paid - x.share) }))
}

/** Fewest transfers: repeatedly settle the biggest debtor against the biggest creditor. */
export function settleUp(bs: Balance[]): Transfer[] {
  const debt = bs.filter((b) => b.net < -1).map((b) => ({ id: b.user_id, v: -b.net })).sort((a, b) => b.v - a.v)
  const cred = bs.filter((b) => b.net > 1).map((b) => ({ id: b.user_id, v: b.net })).sort((a, b) => b.v - a.v)
  const out: Transfer[] = []
  while (debt.length && cred.length) {
    const d = debt[0]
    const c = cred[0]
    const amt = Math.min(d.v, c.v)
    out.push({ from: d.id, to: c.id, amount: Math.round(amt) })
    d.v -= amt
    c.v -= amt
    if (d.v < 1) debt.shift()
    if (c.v < 1) cred.shift()
  }
  return out
}

/** Package costs per day from the plan (what the receipt commits, day by day). */
export function plannedByDay(trip: Trip): number[] {
  return trip.days.map((d) => d.items.reduce((s, i) => s + (i.cost ?? 0), 0))
    .map((v, i) => (i === 0 ? v + trip.receipt.lines.find((l) => l.key === 'stay')!.amount : v))
}

export const expenseLine = (e: Expense, name: (id: string) => string) => `${e.title} · ${rupee(e.amount)} paid by ${name(e.paid_by)}`
