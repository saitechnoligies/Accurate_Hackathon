/* Builds the full trip view: baseline plan, re-planned trip, what changed and why,
   and what a static (non-healing) planner would have lost. */
import type { Banner, Change, Naive, Profile, Trip } from '../types'
import type { AttractionData, Catalog, Rec } from './data'
import { t2m } from './geo'
import { type BuildResult, type NormDisruptions, Planner, normalizeDisruptions } from './scheduler'

const RECEIPT_LABELS: [string, string][] = [
  ['train', 'Trains (to Jaipur & back)'],
  ['stay', 'Base stay'],
  ['home_transfers', 'Home ↔ station rides'],
  ['local_rides', 'Local rides in Jaipur'],
  ['tickets', 'Entry tickets'],
  ['meals', 'Meals & chai'],
  ['extras', 'Extras (cloakroom etc.)'],
]

/** User edits (skips, swaps) are part of the baseline; live disruptions are not. */
const liveOnly = (d: NormDisruptions) => ({ skipped: d.skipped, swaps: d.swaps, swap_days: d.swap_days })

const hasLive = (d: NormDisruptions) =>
  Boolean(d.train_delay_min || d.return_delay_min || d.weather !== 'clear' || d.crowd.length
    || Object.keys(d.late_start).length)

function visits(result: BuildResult): Record<string, Rec> {
  const out: Record<string, Rec> = {}
  for (const day of result.days) for (const it of day.items) if (it.type === 'visit') out[it.attraction_id] = it
  return out
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

export type View = Omit<Trip, 'trip_id' | 'profile' | 'feedback' | 'message'> & { generated_at: string }

export function buildView(catalog: Catalog, profile: Profile, disruptions?: Partial<NormDisruptions> | null): View {
  const d = normalizeDisruptions(disruptions)
  const baseline = new Planner(catalog, profile, liveOnly(d)).build()
  const current = hasLive(d) ? new Planner(catalog, profile, d).build() : baseline
  const attr = Object.fromEntries(catalog.attractions.map((a) => [a.id, a]))

  const changes = diff(baseline, current, d, attr, profile)
  const naive = naiveOutcome(baseline, d, attr, profile)
  const baseV = visits(baseline)
  const curV = visits(current)
  const flagTotal = Object.keys(baseV).filter((a) => attr[a].flagship)
  const flagKept = flagTotal.filter((a) => a in curV)

  const total = sum(Object.values(current.ledger))
  const receipt = {
    lines: RECEIPT_LABELS.map(([key, label]) => ({ key, label, amount: current.ledger[key] ?? 0 })),
    total,
    budget: profile.budget,
    remaining: profile.budget - total,
    baseline_total: sum(Object.values(baseline.ledger)),
  }
  const banner = makeBanner(d, changes, current.events, naive, flagKept.length, flagTotal.length)
  return {
    days: current.days as Trip['days'],
    baseline_days: baseline.days as Trip['days'],
    receipt,
    changes,
    naive,
    banner,
    stats: {
      flagships_total: flagTotal.length,
      flagships_kept: flagKept.length,
      stops: Object.keys(curV).length,
      baseline_stops: Object.keys(baseV).length,
      used_cloakroom: current.used_cloakroom,
    },
    disruptions: d,
    generated_at: new Date().toISOString(),
  }
}

function diff(baseline: BuildResult, current: BuildResult, d: NormDisruptions, attr: Record<string, AttractionData>,
  profile: Profile): Change[] {
  if (current === baseline) return []
  const base = visits(baseline)
  const cur = visits(current)
  const arrival = current.days[0].items.find((it: Rec) => it.type === 'train')
  const changes: (Change & { from_day?: number })[] = []
  for (const [aid, b] of Object.entries(base)) {
    const a = attr[aid]
    if (!(aid in cur)) {
      changes.push({ kind: 'dropped', id: aid, name: a.name, from_day: b.day, from: b.start,
        reason: dropReason(a, b, d, profile) })
      continue
    }
    const c = cur[aid]
    if (c.day !== b.day) {
      c.status = 'moved'
      let reason: string
      if (c.day > b.day) {
        const lateClose = arrival && t2m(a.close) - arrival.end_min > 240
        let why: string
        if (b.day === 1 && d.train_delay_min && arrival && !lateClose)
          why = `It closes at ${a.close} and your train now reaches Jaipur at ${arrival.end}`
        else if (b.day === 1 && d.train_delay_min) why = 'Your shortened Day 1 only had room for stops that close earlier'
        else why = `Day ${b.day} no longer has room before it closes at ${a.close}`
        reason = `${why}, so it moved to Day ${c.day} at ${c.start} instead of being lost.`
      } else {
        reason = `Open till ${a.close}, so it moved up to Day ${c.day} at ${c.start} to fill the freed slot.`
      }
      c.notes.push(`Moved from Day ${b.day} ${b.start}`)
      changes.push({ kind: 'moved', id: aid, name: a.name, from_day: b.day, from: b.start, to_day: c.day, to: c.start,
        reason, flagship: a.flagship })
    } else if (Math.abs(c.start_min - b.start_min) >= 30) {
      c.notes.push(`Re-timed from ${b.start}`)
      changes.push({ kind: 'retimed', id: aid, name: a.name, from_day: b.day, from: b.start, to_day: c.day, to: c.start,
        reason: `Shifted from ${b.start} to ${c.start} on Day ${c.day}.`, flagship: a.flagship })
    }
  }
  for (const [aid, c] of Object.entries(cur)) {
    if (aid in base) continue
    const a = attr[aid]
    if (c.status === 'normal') c.status = 'rescued'
    let reason: string
    if ((d.weather === 'heat' || d.weather === 'rain') && a.indoor)
      reason = `Indoor and cool, so it replaces outdoor time during the ${d.weather === 'heat' ? 'heat' : 'rain'}.`
    else if (t2m(a.close) >= t2m('19:30')) reason = `Open till ${a.close}, so it fills an evening slot that would otherwise be wasted.`
    else reason = 'Fits the gap the disruption opened up, within budget.'
    c.notes.push('Added by re-plan')
    changes.push({ kind: 'added', id: aid, name: a.name, to_day: c.day, to: c.start, reason, flagship: a.flagship })
  }
  const order = { moved: 0, added: 1, dropped: 2, retimed: 3 }
  const key = (x: Change) => [order[x.kind], x.to_day ?? x.from_day ?? 0]
  return changes
    .map((c, i) => ({ c, i }))
    .sort((p, q) => {
      const [a1, a2] = key(p.c)
      const [b1, b2] = key(q.c)
      return a1 - b1 || a2 - b2 || p.i - q.i
    })
    .map((x) => x.c)
}

function dropReason(a: AttractionData, b: Rec, d: NormDisruptions, profile: Profile): string {
  if (d.crowd.includes(a.id)) return `Crowd surge reported at ${a.name}: an hour-long queue would break the rest of the day.`
  if (d.weather === 'rain' && !a.indoor) return 'Outdoor stop, removed for the rain.'
  if (d.weather === 'heat' && !a.indoor) return 'Outdoor stop with no shaded slot outside 12:00–16:00 heat.'
  if (String(profile.days) in d.late_start && b.day === profile.days)
    return 'Dropped to protect your return train; it had the lowest value for you.'
  return 'Lowest-value stop that no longer fits the shortened day.'
}

/** What a static itinerary would do: keep the same plan and just run late. */
function naiveOutcome(baseline: BuildResult, d: NormDisruptions, attr: Record<string, AttractionData>,
  profile: Profile): Naive {
  const trav = profile.travelers
  const missed: Naive['missed'] = []
  const heatExposed: string[] = []
  let wasted = 0
  let missedTrain = false
  for (const day of baseline.days) {
    const shiftFromTrain = day.day === 1 ? d.train_delay_min : 0
    let shift = d.late_start[String(day.day)] ?? 0
    let afterTrain = false
    let firstLocalRideCharged = false
    for (const it of day.items as Rec[]) {
      if (day.day === 1 && it.type === 'train') {
        afterTrain = true
        continue
      }
      const s = shift + (afterTrain ? shiftFromTrain : 0)
      if (it.type === 'transfer' && day.day === 1 && afterTrain && !firstLocalRideCharged) {
        firstLocalRideCharged = true
        if (d.train_delay_min >= 60) wasted += it.cost ?? 0 // pre-booked pickup no-show
      }
      if (it.type === 'visit') {
        const a = attr[it.attraction_id]
        let end = it.end_min + s
        if (d.crowd.includes(a.id)) {
          shift += 60
          end += 60
        }
        if (end > t2m(a.close)) {
          missed.push({ name: a.name, flagship: a.flagship, lost: a.fee * trav })
          wasted += a.fee * trav
        } else if (!a.indoor) {
          if (d.weather === 'rain' || (d.weather === 'heat' && it.start_min + s < t2m('16:00') && end > t2m('12:00')))
            heatExposed.push(a.name)
        }
      }
      if (it.type === 'train' && day.day === baseline.days.length && day.day > 1) {
        const dep = it.start_min + d.return_delay_min
        // the stop before the station buffer is the arrival at the station
        const buf = (day.items as Rec[]).find((x) => x.type === 'buffer')
        const arriveStation = (buf ? buf.start_min : dep) + s
        if (arriveStation > dep) {
          missedTrain = true
          wasted += it.cost ?? 0
        }
      }
    }
  }
  return { missed, flagships_missed: missed.filter((m) => m.flagship).length, wasted, missed_train: missedTrain,
    exposed: heatExposed }
}

function makeBanner(d: NormDisruptions, changes: Change[], events: Rec[], naive: Naive, kept: number,
  total: number): Banner {
  const causes: string[] = []
  if (d.train_delay_min) {
    const h = Math.floor(d.train_delay_min / 60)
    const m = d.train_delay_min % 60
    causes.push(h ? `train ${h}h${String(m).padStart(2, '0')} late` : `train ${m} min late`)
  }
  if (d.weather === 'heat') causes.push('42°C heat')
  if (d.weather === 'rain') causes.push('rain')
  if (d.crowd.length) causes.push('crowd surge')
  for (const [day, mins] of Object.entries(d.late_start)) causes.push(`Day ${day} starting ${mins} min late`)
  if (d.return_delay_min) causes.push(`return train ${d.return_delay_min} min late`)
  if (!causes.length) {
    return { active: false, headline: 'Your door-to-door plan is ready',
      lines: ['Every stop already has a Plan B that is open at the same time and fits your budget.'], savings: [] }
  }

  const verbs: Record<string, string> = { added: 'Added', dropped: 'Dropped', moved: 'Moved' }
  const lines = changes.filter((c) => c.kind in verbs).map((c) => `${verbs[c.kind]} ${c.name}: ${c.reason}`).slice(0, 6)
  for (const e of events) {
    if (e.type === 'cloakroom')
      lines.unshift(`Bags go to the station cloakroom (₹${e.fee}) so you skip the hotel detour; check-in moved to the evening.`)
    if (e.type === 'upgrade')
      lines.push(`Ride to ${e.to} upgraded to ${e.to_mode.replace(/_/g, ' ')}: saves ${e.saved_min} min `
        + `for +₹${e.extra_cost}, beating the closing time.`)
  }
  const savings: Banner['savings'] = []
  if (naive.wasted)
    savings.push({ label: 'Money saved', value: `₹${naive.wasted.toLocaleString('en-US')}`,
      detail: 'tickets & pickups a static plan would waste' })
  if (total) {
    const staticKept = total - naive.flagships_missed
    savings.push({ label: 'Must-see kept', value: `${kept}/${total}`, detail: `static plan keeps ${staticKept}/${total}` })
  }
  if (naive.missed_train) savings.push({ label: 'Return train', value: 'Protected', detail: 'a static plan would miss it' })
  if (naive.exposed.length)
    savings.push({ label: 'Outdoor exposure avoided', value: String(naive.exposed.length),
      detail: naive.exposed.slice(0, 3).join(', ') })
  if (!lines.length) lines.push('All your stops still fit; times were adjusted around the disruption.')
  return { active: true, headline: 'Re-planned around ' + causes.join(', '), lines, savings }
}
