/* Door-to-door trip planner.

   The plan is a single timeline per day. Fixed anchors (trains, hotel check-in /
   checkout, closing times, the return-train deadline) never move; flexible stops are
   re-arranged greedily around them. Every re-plan is "keep the anchors, rearrange the
   flexible stops", which keeps the engine deterministic and explainable. */
import type { Disruptions, Profile } from '../types'
import { CITY, MODES, ORIGIN, type AttractionData, type Catalog, type Rec } from './data'
import { type Leg, type Loc, m2t, pyRound, round5, t2m, travel } from './geo'

const PACE: Record<string, { dur: number; max_visits: number }> = {
  relaxed: { dur: 1.15, max_visits: 4 },
  balanced: { dur: 1.0, max_visits: 5 },
  packed: { dur: 0.9, max_visits: 7 },
}
const STATION_BUFFER = 30 // be at the station this many minutes before departure
const CHECKIN_MIN = 20 // bag drop & check-in
const CLOAKROOM_TRIGGER = 90 // train delay (min) after which bags go to the station cloakroom
const BAG_COLLECT_MIN = 10
const LUNCH: [number, number] = [t2m('12:30'), t2m('14:30')]
const HEAT: [number, number] = [t2m('12:00'), t2m('16:00')]
const CROWD_SURGE_EXTRA = 60 // extra queue when a crowd surge is reported
const PEAK_EXTRA = 15 // normal queue at crowd peak for flagship spots
const MUST_SEE_BONUS = 1.5
const PIN_BONUS = 2.5
const SCORE_THRESHOLD = 0.15
const METRO_LAST = t2m('22:45')

const STATION: Loc = { ...CITY.station }
const ORIGIN_STATION = { ...ORIGIN.station, zone: 'delhi' }

export type NormDisruptions = Required<Disruptions>

export function normalizeDisruptions(d?: Partial<Disruptions> | null): NormDisruptions {
  const x: Partial<Disruptions> = { ...(d ?? {}) }
  const late: Record<string, number> = {}
  for (const [k, v] of Object.entries(x.late_start ?? {})) if (Math.trunc(Number(v))) late[String(k)] = Math.trunc(Number(v))
  const swapDays: Record<string, number> = {}
  for (const [k, v] of Object.entries(x.swap_days ?? {})) swapDays[k] = Math.trunc(Number(v))
  return {
    train_delay_min: Math.trunc(Number(x.train_delay_min) || 0),
    return_delay_min: Math.trunc(Number(x.return_delay_min) || 0),
    weather: x.weather || 'clear', // clear | heat | rain
    crowd: [...(x.crowd ?? [])], // attraction ids with a crowd surge
    late_start: late, // day -> minutes
    skipped: [...(x.skipped ?? [])], // attractions the traveller skipped
    swaps: { ...(x.swaps ?? {}) }, // original id -> plan B id
    swap_days: swapDays, // plan B id -> day it replaces
    pins: [...(x.pins ?? [])], // stops the traveller asked to add
  }
}

const LIMITED_WALK_KM = 0.5

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1

type Cand = {
  a: AttractionData; leg: Leg; upgraded_from: Leg | null; arrive: number; start: number; end: number
  queue: number; cost: number; score: number
}
type Deadline = (place: Loc) => number

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const pick = (o: Rec, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]))

export type BuildResult = {
  days: Rec[]; ledger: Record<string, number>; events: Rec[]; used_cloakroom: boolean; visited: string[]
}

export class Planner {
  cat: Catalog
  p: Profile
  d: NormDisruptions
  w: Record<string, number>
  aff: Record<string, number>
  attr: Record<string, AttractionData>
  stay: Catalog['stays'][number]
  trains: Record<string, Catalog['trains'][number]>
  corr: Record<string, number>
  pace: { dur: number; max_visits: number }
  trav: number
  n = 0
  visited = new Set<string>()
  excluded: Set<string>
  pinned: Set<string>
  ledger: Record<string, number>
  events: Rec[] = [] // engine decisions used for the explanation banner
  hotel: Loc
  used_cloakroom = false
  cur_day = 1
  fixed_estimate = 0
  limited = false

  constructor(catalog: Catalog, profile: Profile, disruptions?: Partial<Disruptions> | null) {
    this.cat = catalog
    this.p = profile
    this.d = normalizeDisruptions(disruptions)
    this.w = catalog.weights
    this.aff = catalog.tag_affinity?.[profile.persona_id] ?? {}
    this.attr = Object.fromEntries(catalog.attractions.map((a) => [a.id, a]))
    this.stay = catalog.stays.find((s) => s.id === profile.stay_id)!
    this.trains = Object.fromEntries(catalog.trains.map((t) => [t.id, t]))
    this.corr = catalog.corridors
    this.pace = PACE[profile.pace]
    this.trav = Math.trunc(profile.travelers)
    this.excluded = new Set([...this.d.skipped, ...Object.keys(this.d.swaps)])
    this.pinned = new Set([...Object.values(this.d.swaps), ...this.d.pins])
    this.limited = profile.mobility === 'limited'
    this.ledger = Object.fromEntries(
      ['train', 'stay', 'home_transfers', 'local_rides', 'tickets', 'meals', 'extras'].map((k) => [k, 0]))
    this.hotel = { name: this.stay.name, lat: this.stay.lat, lng: this.stay.lng, zone: this.stay.zone }
  }

  // ------------------------------------------------------------------ helpers
  item(day: number, type: string, title: string, start: number, end: number, kw: Rec = {}): Rec {
    this.n += 1
    return { id: `d${day}-${this.n}`, day, type, title, start_min: pyRound(start), end_min: pyRound(end),
      start: m2t(start), end: m2t(end), status: 'normal', notes: [], ...kw }
  }

  placeOf(a: AttractionData): Loc {
    return { name: a.name, lat: a.lat, lng: a.lng, zone: a.zone, id: a.id }
  }

  modesAt(t: number): string[] {
    let modes = this.p.modes.filter((m) => m !== 'walk')
    const wx = this.d.weather
    if (modes.includes('cab') && (this.limited
      || ((wx === 'heat' || wx === 'rain') && (wx === 'rain' || (HEAT[0] <= t && t <= HEAT[1])))))
      modes = ['cab', ...modes.filter((m) => m !== 'cab')]
    return modes
  }

  legs(a: Loc, b: Loc, t: number): Leg[] {
    const out: Leg[] = []
    if (this.p.modes.includes('walk') && !(this.d.weather === 'heat' && HEAT[0] <= t && t <= HEAT[1])
      && this.d.weather !== 'rain') {
      const w = travel(a, b, 'walk', this.trav, this.corr)
      if (w && !(this.limited && w.km > LIMITED_WALK_KM)) return [w]
    }
    for (const m of this.modesAt(t)) {
      const leg = travel(a, b, m, this.trav, this.corr)
      if (leg) out.push(leg)
    }
    if (!out.length) {
      // very short hop: walk regardless
      out.push(travel(a, b, 'walk', this.trav, this.corr) ?? {
        mode: 'walk', km: 0.3, minutes: 5, base_minutes: 5, buffer: 0, cost: 0, hill: false, congested: false })
    }
    return out
  }

  mins(a: Loc, b: Loc, t = 0): number {
    return this.legs(a, b, t)[0].minutes
  }

  transfer(day: number, a: Loc, b: Loc, t: number, leg: Leg, upgradedFrom: Leg | null = null): Rec {
    const it = this.item(day, 'transfer', `${MODES[leg.mode].label} to ${b.name}`, t, t + leg.minutes, {
      mode: leg.mode, cost: leg.cost, km: leg.km, buffer: leg.buffer,
      frm: pick(a, ['name', 'lat', 'lng', 'zone']), to: pick(b, ['name', 'lat', 'lng', 'zone']),
    })
    if (leg.hill) it.notes.push('Hill climb: winding ghat road (+35% time)')
    if (leg.congested) it.notes.push('Old City lanes: congestion factor applied')
    if (leg.buffer) it.notes.push(`Learned corridor buffer +${pyRound(leg.buffer)} min`)
    if (upgradedFrom) {
      const saved = upgradedFrom.minutes - leg.minutes
      const extra = leg.cost - upgradedFrom.cost
      it.status = 'upgraded'
      it.notes.push(`Upgraded from ${MODES[upgradedFrom.mode].label}: saves ${saved} min for +₹${extra}`)
      this.events.push({ type: 'upgrade', to: b.name, from_mode: upgradedFrom.mode, to_mode: leg.mode,
        saved_min: saved, extra_cost: extra })
    }
    const defaultFirst = this.p.modes.find((m) => m !== 'walk')
    if ((this.d.weather === 'heat' || this.d.weather === 'rain') && leg.mode === 'cab' && defaultFirst !== 'cab')
      it.notes.push('AC cab chosen for the ' + (this.d.weather === 'rain' ? 'rain' : 'afternoon heat'))
    this.ledger.local_rides += leg.cost
    return it
  }

  // ------------------------------------------------------------------ budget
  stayCost(): number {
    const nights = Math.max(0, this.p.days - 1)
    if (this.stay.per === 'bed') return this.stay.price_per_night * this.trav * nights
    return this.stay.price_per_night * Math.ceil(this.trav / 4) * nights
  }

  trainFare(id: string): number {
    return this.trains[id].classes[this.p.train_class] * this.trav
  }

  homeLeg(t: number) {
    const km = this.p.home.to_station_km
    if (this.p.modes.includes('bus') && t <= METRO_LAST)
      return { mode: 'metro', label: 'Delhi Metro', minutes: pyRound((km / 30) * 60 + 15), cost: 40 * this.trav, km }
    const vehicles = Math.ceil(this.trav / 4)
    return { mode: 'cab', label: 'Cab', minutes: pyRound((km / 24) * 60 + 10), cost: round5(vehicles * (80 + 16 * km)), km }
  }

  localLeft(): number {
    const l = this.ledger
    const local = l.local_rides + l.tickets + l.meals + l.extras
    return this.p.budget - this.fixed_estimate - local - 250 * this.p.days
  }

  // ------------------------------------------------------------------ scoring
  interest(a: AttractionData): number {
    const m = a.tags.filter((t) => this.p.interests.includes(t)).length
    return m === 0 ? 0 : Math.min(1, 0.6 + 0.2 * (m - 1))
  }

  affinity(a: AttractionData): number {
    const vals = a.tags.map((t) => this.aff[t] ?? 0)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
  }

  weatherOk(a: AttractionData, start: number, end: number): boolean {
    if (a.indoor) return true
    if (this.d.weather === 'rain') return false
    if ((this.d.weather === 'heat' || this.p.avoid_heat) && overlaps(start, end, ...HEAT)) return false
    return true
  }

  evaluate(a: AttractionData, t: number, loc: Loc, deadline: Deadline, maxWait = 45): Cand | null {
    const o = t2m(a.open)
    const c = t2m(a.close)
    const dur = a.duration * (a.kind === 'visit' ? this.pace.dur : 1)
    const legs = this.legs(loc, this.placeOf(a), t)
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]
      const arrive = t + leg.minutes
      const start = Math.max(arrive, o)
      const wait = start - arrive
      if (wait > maxWait) continue
      let queue = 0
      if (this.d.crowd.includes(a.id)) queue = CROWD_SURGE_EXTRA
      else if (a.flagship && t2m(a.crowd_peak[0]) <= start && start <= t2m(a.crowd_peak[1])) queue = PEAK_EXTRA
      const end = start + queue + dur
      if (end > c || end > deadline(this.placeOf(a))) continue
      if (!this.weatherOk(a, start, end)) return null
      const cost = a.fee * this.trav + leg.cost
      if (cost > this.localLeft()) continue
      const perDay = Math.max(800, (this.p.budget - this.fixed_estimate) / Math.max(1, this.p.days))
      const w = this.w
      let score: number
      if (a.kind === 'meal') {
        score = -leg.minutes / 20 - (w.budget * cost) / (300 * this.trav) + this.affinity(a)
      } else {
        score = w.interest * this.interest(a)
          + w.flagship * (a.flagship ? 1 : 0)
          + (a.flagship ? MUST_SEE_BONUS : 0)
          + this.affinity(a)
          - (w.travel * leg.minutes) / 60
          - (w.budget * cost) / perDay
          + w.urgency * (c - t <= 180 ? 1 : 0)
          - (w.crowd * queue) / 60
          - (0.3 * wait) / 30
          + (this.pinned.has(a.id) ? PIN_BONUS : 0)
          + (a.indoor && (this.d.weather === 'heat' || this.d.weather === 'rain') ? 0.6 : 0)
      }
      const upgraded = i > 0 && leg.minutes < legs[0].minutes && leg.cost > legs[0].cost
      return { a, leg, upgraded_from: upgraded ? legs[0] : null, arrive, start, end, queue, cost,
        score: pyRound(score, 3) }
    }
    return null
  }

  // ------------------------------------------------------------------ day filling
  pool(): AttractionData[] {
    const days = this.d.swap_days
    return this.cat.attractions.filter((a) => a.kind === 'visit' && !this.visited.has(a.id) && !this.excluded.has(a.id)
      && (days[a.id] ?? this.cur_day) === this.cur_day && this.accessible(a))
  }

  /** Limited mobility skips stair-heavy places unless the traveller pinned them. */
  accessible(a: AttractionData): boolean {
    return !(this.limited && a.stairs && !this.pinned.has(a.id))
  }

  dietOk(a: AttractionData): boolean {
    const diet = this.p.diet ?? 'any'
    if (diet === 'jain') return Boolean(a.jain)
    if (diet === 'veg') return a.veg !== false
    return true
  }

  addStop(day: number, items: Rec[], c: Cand, loc: Loc): [number, Loc] {
    const a = c.a
    items.push(this.transfer(day, loc, this.placeOf(a), c.arrive - c.leg.minutes, c.leg, c.upgraded_from))
    const kind = a.kind === 'meal' ? 'meal' : 'visit'
    const it = this.item(day, kind, a.name, c.start, c.end, {
      attraction_id: a.id, lat: a.lat, lng: a.lng, zone: a.zone, fee: a.fee, cost: a.fee * this.trav, indoor: a.indoor,
      flagship: a.flagship, tags: a.tags, blurb: a.blurb, open: a.open, close: a.close, score: c.score,
    })
    if (c.queue) it.notes.push((c.queue >= CROWD_SURGE_EXTRA ? 'Crowd surge' : 'Peak hour') + `: +${c.queue} min queue`)
    if (c.start > c.arrive) it.notes.push(`Opens ${a.open}: ${pyRound(c.start - c.arrive)} min wait`)
    if (this.pinned.has(a.id)) {
      it.status = 'rescued'
      it.notes.push('Plan B swap you chose')
    }
    items.push(it)
    if (kind === 'meal') this.ledger.meals += a.fee * this.trav
    else {
      this.ledger.tickets += a.fee * this.trav
      this.visited.add(a.id)
    }
    return [c.end, this.placeOf(a)]
  }

  best(cands: Cand[]): Cand {
    return cands.reduce((b, c) => (c.score > b.score ? c : b))
  }

  fillDay(day: number, t: number, loc: Loc, deadline: Deadline, items: Rec[]): [number, Loc] {
    this.cur_day = day
    let visits = 0
    let hadLunch = t > LUNCH[1]
    for (;;) {
      if (!hadLunch && t >= LUNCH[0] - 30) {
        hadLunch = true
        if (t <= LUNCH[1]) {
          const meals = this.cat.attractions.filter((a) => a.kind === 'meal' && this.dietOk(a))
            .map((a) => this.evaluate(a, t, loc, deadline))
            .filter((m): m is Cand => !!m && m.start <= LUNCH[1])
          if (meals.length) {
            ;[t, loc] = this.addStop(day, items, this.best(meals), loc)
            continue
          }
        }
      }
      if (visits >= this.pace.max_visits) break
      const cands = this.pool().map((a) => this.evaluate(a, t, loc, deadline)).filter((c): c is Cand => !!c)
      if (!cands.length) break
      const best = this.best(cands)
      const wx = this.d.weather
      const relevant = best.a.flagship || this.interest(best.a) > 0 || this.pinned.has(best.a.id)
        || (best.a.indoor && (wx === 'heat' || wx === 'rain'))
      if (best.score < SCORE_THRESHOLD && !relevant) break
      ;[t, loc] = this.addStop(day, items, best, loc)
      visits += 1
    }
    return [t, loc]
  }

  lateStart(day: number): number {
    return this.d.late_start[String(day)] ?? 0
  }

  // ------------------------------------------------------------------ build
  build(): BuildResult {
    const p = this.p
    const out = this.trains[p.outbound]
    const ret = this.trains[p.return]
    const delay = this.d.train_delay_min
    const rdelay = this.d.return_delay_min
    const dayStart = t2m(p.day_start)
    const dayEnd = t2m(p.day_end)
    const home = { ...p.home, name: p.home.label, zone: 'delhi' }

    const hlOut = this.homeLeg(t2m(out.dep))
    const retArr = t2m(ret.arr) + rdelay
    const hlRet = this.homeLeg(retArr)
    this.fixed_estimate = this.trainFare(out.id) + this.trainFare(ret.id) + this.stayCost() + hlOut.cost + hlRet.cost
    this.ledger.train = this.trainFare(out.id) + this.trainFare(ret.id)
    this.ledger.stay = this.stayCost()
    this.ledger.home_transfers = hlOut.cost + hlRet.cost

    const days: Rec[] = []
    // ============================== Day 1: home -> train -> Jaipur
    let items: Rec[] = []
    const dep = t2m(out.dep)
    const arr = t2m(out.arr) + delay
    const leave = dep - STATION_BUFFER - hlOut.minutes
    items.push(this.item(1, 'home', 'Leave home', leave, leave, {
      lat: home.lat, lng: home.lng, subtitle: home.label, anchor: true,
      notes: [`Leave-by time = train ${out.dep} − ${STATION_BUFFER} min station buffer − ${hlOut.minutes} min ride`],
    }))
    items.push(this.item(1, 'transfer', `${hlOut.label} to ${ORIGIN_STATION.name}`, leave, leave + hlOut.minutes, {
      mode: hlOut.mode, cost: hlOut.cost, km: hlOut.km, intercity: true, frm: { name: home.label },
      to: { name: ORIGIN_STATION.name },
    }))
    items.push(this.item(1, 'buffer', 'Station entry & find your coach', dep - STATION_BUFFER, dep, {
      notes: ['Security check and platform walk'] }))
    const tr = this.item(1, 'train', `${out.id} ${out.name}`, dep, arr, {
      subtitle: `${ORIGIN_STATION.name} → ${STATION.name}`, cost: this.trainFare(out.id), train_class: p.train_class,
      scheduled_arr: out.arr, delay_min: delay, anchor: true, intercity: true,
    })
    if (delay) {
      tr.status = 'delayed'
      tr.notes.push(`Running ${delay} min late: now arrives ${m2t(arr)} (scheduled ${out.arr})`)
    }
    items.push(tr)

    let t = arr
    let loc: Loc = STATION
    let deadline: Deadline
    if (delay >= CLOAKROOM_TRIGGER) {
      this.used_cloakroom = true
      const fee = CITY.cloakroom.fee * this.trav
      items.push(this.item(1, 'cloakroom', 'Drop bags at station cloakroom', t, t + CITY.cloakroom.minutes, {
        lat: STATION.lat, lng: STATION.lng, cost: fee, status: 'rescued',
        notes: ['Skips the hotel detour so you reach sights before they close',
          'Hotel informed of late check-in; pre-booked pickup moved to evening'],
      }))
      this.ledger.extras += fee
      this.events.push({ type: 'cloakroom', fee })
      t += CITY.cloakroom.minutes
      deadline = (place) =>
        dayEnd - (this.mins(place, STATION, dayEnd) + BAG_COLLECT_MIN + this.mins(STATION, this.hotel, dayEnd))
    } else {
      const leg = this.legs(STATION, this.hotel, t)[0]
      items.push(this.transfer(1, STATION, this.hotel, t, leg))
      t += leg.minutes
      const early = t < t2m(this.stay.checkin)
      items.push(this.item(1, 'checkin', early ? `Bag drop (room ready at ${this.stay.checkin})` : 'Bag drop & check-in',
        t, t + CHECKIN_MIN, { lat: this.hotel.lat, lng: this.hotel.lng, anchor: true, subtitle: this.stay.name }))
      t += CHECKIN_MIN
      loc = this.hotel
      deadline = (place) => dayEnd - this.mins(place, this.hotel, dayEnd)
    }

    ;[t, loc] = this.fillDay(1, t, loc, deadline, items)
    if (this.used_cloakroom) {
      let leg = this.legs(loc, STATION, t)[0]
      items.push(this.transfer(1, loc, STATION, t, leg))
      t += leg.minutes
      items.push(this.item(1, 'collect_bags', 'Collect bags from cloakroom', t, t + BAG_COLLECT_MIN,
        { lat: STATION.lat, lng: STATION.lng }))
      t += BAG_COLLECT_MIN
      leg = this.legs(STATION, this.hotel, t)[0]
      items.push(this.transfer(1, STATION, this.hotel, t, leg))
      t += leg.minutes
      items.push(this.item(1, 'checkin', 'Late check-in & rest', t, t + CHECKIN_MIN,
        { lat: this.hotel.lat, lng: this.hotel.lng, anchor: true, subtitle: this.stay.name }))
    } else {
      if (loc !== this.hotel) {
        const leg = this.legs(loc, this.hotel, t)[0]
        items.push(this.transfer(1, loc, this.hotel, t, leg))
        t += leg.minutes
      }
      items.push(this.item(1, 'hotel', 'Back at hotel', t, t,
        { lat: this.hotel.lat, lng: this.hotel.lng, subtitle: this.stay.name }))
    }
    days.push(this.dayRec(1, p.start_date, 'Arrive & explore', items))

    // ============================== Middle days
    for (let day = 2; day < p.days; day++) {
      items = []
      const s = dayStart + this.lateStart(day)
      const st = this.item(day, 'hotel', 'Start from hotel', s, s,
        { lat: this.hotel.lat, lng: this.hotel.lng, subtitle: this.stay.name })
      if (this.lateStart(day)) {
        st.status = 'delayed'
        st.notes.push(`Starting ${this.lateStart(day)} min late`)
      }
      items.push(st)
      ;[t, loc] = this.fillDay(day, s, this.hotel, (place) => dayEnd - this.mins(place, this.hotel, dayEnd), items)
      if (loc !== this.hotel) {
        const leg = this.legs(loc, this.hotel, t)[0]
        items.push(this.transfer(day, loc, this.hotel, t, leg))
        t += leg.minutes
      }
      items.push(this.item(day, 'hotel', 'Back at hotel', t, t, { lat: this.hotel.lat, lng: this.hotel.lng }))
      days.push(this.dayRec(day, addDays(p.start_date, day - 1), 'Full day in Jaipur', items))
    }

    // ============================== Last day: checkout -> sights -> train -> home
    const last = p.days
    items = []
    const s = dayStart + this.lateStart(last)
    const co = this.item(last, 'checkout', 'Check out (bags held at front desk)', s, s + 15,
      { lat: this.hotel.lat, lng: this.hotel.lng, anchor: true, subtitle: this.stay.name })
    if (this.lateStart(last)) {
      co.status = 'delayed'
      co.notes.push(`Starting ${this.lateStart(last)} min late`)
    }
    items.push(co)
    const retDep = t2m(ret.dep) + rdelay
    const toStation = this.legs(this.hotel, STATION, retDep - 60)[0]
    const collectBy = retDep - STATION_BUFFER - toStation.minutes - BAG_COLLECT_MIN

    ;[t, loc] = this.fillDay(last, s + 15, this.hotel, (place) => collectBy - this.mins(place, this.hotel, collectBy), items)
    if (loc !== this.hotel) {
      const leg = this.legs(loc, this.hotel, t)[0]
      items.push(this.transfer(last, loc, this.hotel, t, leg))
      t += leg.minutes
    }
    if (collectBy - t > 20) {
      items.push(this.item(last, 'free', 'Free time near the hotel', t, collectBy,
        { lat: this.hotel.lat, lng: this.hotel.lng, notes: ['Buffer protecting your return train'] }))
      t = collectBy
    }
    items.push(this.item(last, 'collect_bags', 'Collect bags', t, t + BAG_COLLECT_MIN,
      { lat: this.hotel.lat, lng: this.hotel.lng }))
    t += BAG_COLLECT_MIN
    items.push(this.transfer(last, this.hotel, STATION, t, toStation))
    t += toStation.minutes
    items.push(this.item(last, 'buffer', 'Station buffer & platform', t, retDep, {
      lat: STATION.lat, lng: STATION.lng, anchor: true,
      notes: [`Return train guard: you reach the station ${pyRound(retDep - t)} min early`],
    }))
    const rt = this.item(last, 'train', `${ret.id} ${ret.name}`, retDep, retArr, {
      subtitle: `${STATION.name} → ${ORIGIN_STATION.name}`, cost: this.trainFare(ret.id), train_class: p.train_class,
      anchor: true, intercity: true, scheduled_dep: ret.dep, delay_min: rdelay,
    })
    if (rdelay) {
      rt.status = 'delayed'
      rt.notes.push(`Return train ${rdelay} min late: extra time used for sightseeing`)
    }
    items.push(rt)
    const ride = this.item(last, 'transfer', `${hlRet.label} home`, retArr, retArr + hlRet.minutes, {
      mode: hlRet.mode, cost: hlRet.cost, km: hlRet.km, intercity: true, frm: { name: ORIGIN_STATION.name },
      to: { name: home.label },
    })
    if (retArr >= t2m('22:00')) {
      ride.notes.push('Late-night arrival: verified cab with live-trip link shared to family')
      if (p.modes.includes('bus') && hlRet.mode === 'cab') ride.notes.push('Metro closes before you arrive, so a cab is booked instead')
      ride.safety = true
    }
    items.push(ride)
    items.push(this.item(last, 'arrive_home', 'Home sweet home', retArr + hlRet.minutes, retArr + hlRet.minutes,
      { lat: home.lat, lng: home.lng, subtitle: home.label, anchor: true }))
    days.push(this.dayRec(last, addDays(p.start_date, last - 1), 'Explore & head home', items))

    this.attachPlanB(days)
    return { days, ledger: { ...this.ledger }, events: this.events, used_cloakroom: this.used_cloakroom,
      visited: [...this.visited].sort() }
  }

  dayRec(n: number, date: string, title: string, items: Rec[]): Rec {
    return { day: n, date, title, items }
  }

  // ------------------------------------------------------------------ plan B
  /** For every visit, pre-compute a backup that is open in the same window, fits the
      budget, and delays the next stop by at most 10 minutes. */
  attachPlanB(days: Rec[]) {
    const inTrip = new Set(this.visited)
    const usedBackups = new Set<string>()
    for (const day of days) {
      const items: Rec[] = day.items
      items.forEach((it, i) => {
        if (it.type !== 'visit') return
        const prev = i > 0 && items[i - 1].type === 'transfer' ? items[i - 1] : null
        const nxt = i + 1 < items.length && items[i + 1].type === 'transfer' ? items[i + 1] : null
        if (!prev || !nxt || !prev.frm || !nxt.to) return
        const prevPlace: Loc = prev.frm
        const nextPlace: Loc = nxt.to
        const depart: number = prev.start_min
        const nextArrival: number = nxt.end_min
        const orig = this.attr[it.attraction_id]
        let best: [Cand, number, number] | null = null
        for (const alt of this.cat.attractions) {
          if (alt.kind !== 'visit' || inTrip.has(alt.id) || this.excluded.has(alt.id) || usedBackups.has(alt.id)
            || !this.accessible(alt)) continue
          const c = this.evaluate(alt, depart, prevPlace, () => 10_000, 20)
          if (!c) continue
          const back = this.legs(this.placeOf(alt), nextPlace, c.end)[0]
          const extra = c.end + back.minutes - nextArrival
          if (extra > 10) continue
          const costDelta = (alt.fee - orig.fee) * this.trav + c.leg.cost + back.cost - (prev.cost ?? 0) - (nxt.cost ?? 0)
          if (costDelta > Math.max(0, this.localLeft())) continue
          if (best === null || c.score > best[0].score) best = [c, extra, costDelta]
        }
        if (best) {
          const [c, extra, costDelta] = best
          const alt = c.a
          usedBackups.add(alt.id)
          const cd = round5(costDelta)
          const nextTxt = extra > 0 ? `+${Math.max(pyRound(extra), 0)} min` : 'on time'
          it.plan_b = {
            id: alt.id, name: alt.name, start: m2t(c.start), end: m2t(c.end), indoor: alt.indoor,
            extra_min: pyRound(extra), cost_delta: cd, close: alt.close, blurb: alt.blurb,
            reason: `Open till ${alt.close} · ${costDelta >= 0 ? '+' : '−'}₹${Math.abs(cd)} · next stop ${nextTxt}`,
          }
        }
      })
    }
  }
}
