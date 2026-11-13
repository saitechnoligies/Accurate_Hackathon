/* Offline "rule brain" for the trip assistant.
   It understands trip requests with keyword and pattern rules, fills the details it needs, and does all real work
   through the planning engine (tools), so every answer is feasible. A Claude brain can replace parseIntent with
   model tool calls while keeping the same tools and cards. */
import type {
  AgentCard, AgentCreate, AgentReply, AgentState, Diet, Disruptions, Item, Mobility, PlaceCardItem, Prefs, Profile,
  Trip,
} from '../types'
import { CITY, MODES, PERSONAS, type AttractionData, type Catalog } from './data'
import { type Loc, travel } from './geo'
import type { View } from './replan'

export type AgentTools = {
  catalog: () => Catalog
  trip: Trip | null
  prefs: Prefs
  preview: (c: AgentCreate) => { profile: Profile; view: View }
  createTrip: (c: AgentCreate, title: string) => Trip
  disrupt: (patch: Partial<Disruptions>, label: string) => Trip
  skip: (id: string) => Trip
  pin: (id: string) => Trip
  swap: (id: string) => Trip
  reset: () => Trip
}

const rupee = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

const INTEREST_WORDS: [RegExp, string][] = [
  [/histor|heritage|\bforts?\b|palace|monument/, 'history'],
  [/food|eat|foodie|street food|thali|cuisine/, 'food'],
  [/photo|instagram|sunset|sunrise|golden hour|camera/, 'photography'],
  [/nature|garden|lake|green|hike|outdoor/, 'nature'],
  [/shop|market|bazaar|souvenir/, 'shopping'],
  [/cultur|museum|folk|tradition/, 'culture'],
  [/\bart\b|arts|craft|gallery/, 'art'],
  [/temple|spiritual|pray|religio/, 'spiritual'],
  [/science|astronom|observatory/, 'science'],
]

const TRIP_SUGGESTIONS = [
  'What if my train is 2 hours late?',
  'Show photography spots',
  'How do I get from Amber Fort to City Palace?',
  'Show day 2',
  "What's my budget?",
]
const NEW_SUGGESTIONS = [
  'Family of 4, 2 days, ₹30k, we love history and food',
  'Solo photographer, 3 days, sunsets, avoid the afternoon heat',
  'Student trip, ₹6,000, street food, as packed as possible',
  'Veg trip with my elderly parents, no long walks',
]

function norm(s: string) {
  return s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
}

function aliases(a: AttractionData): string[] {
  const base = norm(a.name.replace(/\(.*?\)/g, ''))
  const out = new Set([base, a.id.replace(/_/g, ' ')])
  const first = base.split(' ')[0]
  if (first.length > 3 && !['jaipur', 'city'].includes(first)) out.add(first)
  if (a.id === 'galtaji') out.add('monkey temple')
  if (a.id === 'jkk') out.add('jawahar')
  if (a.id === 'lmb') out.add('laxmi')
  if (a.id === 'amber_cafe') out.add('dhaba')
  return [...out]
}

/** Find attractions mentioned in text, longest alias first, in order of appearance. */
export function findPlaces(text: string, cat: Catalog): AttractionData[] {
  const t = norm(text)
  const hits: { a: AttractionData; at: number; len: number }[] = []
  for (const a of cat.attractions) {
    let best: { at: number; len: number } | null = null
    for (const al of aliases(a)) {
      const at = t.indexOf(al)
      if (at >= 0 && (!best || al.length > best.len)) best = { at, len: al.length }
    }
    if (best) hits.push({ a, ...best })
  }
  // drop hits contained in a longer hit (e.g. "amber" inside "amber fort" when both match different places)
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.len > h.len && o.at <= h.at && h.at + h.len <= o.at + o.len))
  return kept.sort((x, y) => x.at - y.at).map((h) => h.a)
}

function parseDuration(t: string): number | null {
  const h = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/)
  const m = t.match(/(\d+)\s*(?:m|min|mins|minutes)\b/)
  if (!h && !m) {
    if (/half an hour/.test(t)) return 30
    if (/an hour|one hour/.test(t)) return 60
    return null
  }
  return Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0))
}

function parseBudget(t: string): number | null {
  const m = t.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(k|thousand|lakh|l)?\b/)
    ?? t.match(/\b([\d,]+(?:\.\d+)?)\s*(k|thousand|lakh)\b/)
    ?? t.match(/budget\D{0,12}([\d,]{4,})/)
  if (!m) return null
  let n = Number(m[1].replace(/,/g, ''))
  const unit = m[2]
  if (unit === 'k' || unit === 'thousand') n *= 1000
  if (unit === 'lakh' || unit === 'l') n *= 100000
  return n >= 1000 ? Math.round(n) : null
}

export function parseSlots(text: string): Partial<AgentCreate> {
  const t = norm(text)
  const s: Partial<AgentCreate> = {}
  if (/\bfamily|kids|children|parents|wife|husband|my mom|my dad/.test(t)) s.persona_id = 'family'
  else if (/student|college|backpack|hostel|cheap|low budget|tight budget/.test(t)) s.persona_id = 'student'
  else if (/\bsolo\b|alone|by myself|photograph/.test(t)) s.persona_id = 'solo'

  const trav = t.match(/(\d+)\s*(?:people|persons|of us|adults|travell?ers|pax|friends|members)/)
    ?? t.match(/family of (\d+)|we are (\d+)|group of (\d+)/)
  if (trav) s.travelers = Number(trav[1] ?? trav[2] ?? trav[3])
  else if (/\bcouple\b|\bwife\b|\bhusband\b/.test(t) && !s.travelers) s.travelers = 2
  else if (/\bsolo\b|alone|by myself/.test(t)) s.travelers = 1

  const days = t.match(/(\d)\s*-?\s*(?:days?|d)\b/)
  const nights = t.match(/(\d)\s*nights?/)
  if (days) s.days = Number(days[1])
  else if (nights) s.days = Number(nights[1]) + 1
  else if (/weekend/.test(t)) s.days = 2
  if (s.days) s.days = Math.max(2, Math.min(3, s.days))

  const b = parseBudget(t)
  if (b) s.budget = b

  const interests = INTEREST_WORDS.filter(([re]) => re.test(t)).map(([, tag]) => tag)
  if (interests.length) s.interests = [...new Set(interests)]

  if (/relax|slow|chill|easy pace|no rush|leisure/.test(t)) s.pace = 'relaxed'
  else if (/packed|as much as possible|maximi|fast pace|cover everything/.test(t)) s.pace = 'packed'
  else if (/balanced|moderate/.test(t)) s.pace = 'balanced'

  if (/\bjain\b/.test(t)) s.diet = 'jain'
  else if (/non[- ]?veg/.test(t)) s.diet = 'any'
  else if (/\bveg\b|vegetarian|pure veg/.test(t)) s.diet = 'veg'

  if (/elderly|senior|grand ?parent|wheelchair|knee|no stairs|less walking|no long walks?|can'?t walk|mobility/.test(t))
    s.mobility = 'limited'
  if (/avoid (the )?(afternoon )?heat|hate (the )?heat|too hot|no midday|afternoon heat/.test(t)) s.avoid_heat = true
  return s
}

function inferPersona(s: Partial<AgentCreate>): string {
  if (s.persona_id) return s.persona_id
  if ((s.travelers ?? 1) >= 3) return 'family'
  if (s.budget && s.budget < 9000) return 'student'
  return 'solo'
}

function placeItem(a: AttractionData, trip: Trip | null): PlaceCardItem {
  const inTrip = !!trip?.days.some((d) => d.items.some((i) => i.attraction_id === a.id))
  return { id: a.id, name: a.name, blurb: a.blurb, fee: a.fee, open: a.open, close: a.close, tags: a.tags, indoor: a.indoor,
    flagship: a.flagship, stairs: a.stairs, in_trip: inTrip }
}

function stopsOf(items: Item[]) {
  return items.filter((i) => i.type === 'visit' || i.type === 'meal' || i.type === 'train' || i.type === 'cloakroom')
    .map((i) => ({ time: i.start, name: i.title, kind: i.type, status: i.status !== 'normal' ? i.status : undefined }))
}

function planCard(view: View, profile: Profile, create: AgentCreate | undefined, title: string): AgentCard {
  const persona = PERSONAS.find((p) => p.id === profile.persona_id)!
  const summary = [
    `${persona.emoji} ${profile.persona_label} · ${profile.travelers} traveller${profile.travelers > 1 ? 's' : ''} · ${profile.days} days`,
    `Interests: ${profile.interests.join(', ')} · ${profile.pace} pace`,
  ]
  const extra = [
    profile.diet && profile.diet !== 'any' ? `${profile.diet === 'jain' ? 'Jain' : 'Veg'} meals only` : '',
    profile.mobility === 'limited' ? 'No stair-heavy places, cabs on hills' : '',
    profile.avoid_heat ? 'Indoors 12:00–16:00' : '',
  ].filter(Boolean)
  if (extra.length) summary.push(extra.join(' · '))
  return {
    type: 'plan', title, summary, total: view.receipt.total, budget: view.receipt.budget, create,
    days: view.days.map((d, i) => ({
      day: d.day, date: d.date,
      stops: d.items.filter((it) => it.type === 'visit' || it.type === 'meal')
        .map((it) => ({ time: it.start, name: it.title, kind: it.type })),
      leave: i === 0 ? d.items[0]?.start : undefined,
      home: i === view.days.length - 1 ? d.items[d.items.length - 1]?.start : undefined,
    })),
  }
}

function placeLoc(name: string, cat: Catalog, trip: Trip | null): (Loc & { name: string }) | null {
  const t = norm(name)
  if (/station|junction|railway/.test(t)) return { ...CITY.station }
  if (/hotel|stay|hostel|haveli|room/.test(t) && trip) {
    const s = cat.stays.find((x) => x.id === trip.profile.stay_id)!
    return { name: s.name, lat: s.lat, lng: s.lng, zone: s.zone }
  }
  const a = findPlaces(name, cat)[0]
  return a ? { name: a.name, lat: a.lat, lng: a.lng, zone: a.zone } : null
}

function optionsCard(fromName: string, toName: string, tools: AgentTools): AgentCard | string {
  const cat = tools.catalog()
  const a = placeLoc(fromName, cat, tools.trip)
  const b = placeLoc(toName, cat, tools.trip)
  if (!a || !b) return `I couldn't find ${!a ? `"${fromName}"` : `"${toName}"`} in Jaipur. Try a place name like Amber Fort, City Palace or the station.`
  const trav = tools.trip?.profile.travelers ?? 1
  const opts = Object.keys(MODES).map((m) => ({ m, leg: travel(a, b, m, trav, cat.corridors) }))
    .filter((x) => x.leg)
    .map(({ m, leg }) => ({
      mode: m, label: MODES[m].label, minutes: leg!.minutes, cost: leg!.cost,
      note: [leg!.hill ? 'hill climb +35%' : '', leg!.congested ? 'Old City traffic' : '',
        leg!.buffer ? `+${Math.round(leg!.buffer)} min learned delay` : '', MODES[m].ac ? 'AC' : ''].filter(Boolean).join(' · '),
      best: false,
    }))
    .sort((x, y) => x.minutes - y.minutes)
  if (!opts.length) return 'Those two places are right next to each other: just walk.'
  opts[0].best = true
  return { type: 'options', title: `${a.name} → ${b.name}`, from: a.name, to: b.name, options: opts }
}

function wantsPlaces(t: string) {
  return /(show|suggest|recommend|what|which|list|find|any|good|best).{0,40}(places|spots|things|sights|attractions|to do|to see|to eat|restaurants|food|cafes?)/.test(t)
    || /^(places|spots|sights)\b/.test(t)
}

function placesCard(t: string, tools: AgentTools): AgentCard {
  const cat = tools.catalog()
  const tags = INTEREST_WORDS.filter(([re]) => re.test(t)).map(([, tag]) => tag)
  const wantMeal = /eat|food|restaurant|lunch|dinner|cafe|thali/.test(t)
  const indoor = /indoor|rain|cool|ac\b|heat/.test(t)
  const free = /free|no (entry )?fee|cheap/.test(t)
  const interests = tools.trip?.profile.interests ?? tools.prefs.interests
  const limited = (tools.trip?.profile.mobility ?? tools.prefs.mobility) === 'limited'
  const list = cat.attractions
    .filter((a) => (wantMeal ? a.kind === 'meal' : a.kind === 'visit' || (tags.includes('food') && a.kind === 'meal')))
    .filter((a) => !tags.length || wantMeal || a.tags.some((x) => tags.includes(x)))
    .filter((a) => !indoor || a.indoor)
    .filter((a) => !free || a.fee === 0)
    .filter((a) => !limited || !a.stairs)
    .map((a) => ({ a, s: (a.flagship ? 2 : 0) + a.tags.filter((x) => (tags.length ? tags : interests).includes(x)).length - a.fee / 1000 }))
    .sort((x, y) => y.s - x.s)
    .slice(0, 6)
    .map((x) => placeItem(x.a, tools.trip))
  const what = wantMeal ? 'Places to eat' : tags.length ? `${tags.map((x) => x[0].toUpperCase() + x.slice(1)).join(' & ')} spots` : 'Top picks for you'
  return { type: 'places', title: `${what}${indoor ? ' (indoor)' : ''}${free ? ' (free)' : ''}`, items: list }
}

function bannerCard(trip: Trip): AgentCard {
  return { type: 'banner', title: trip.banner.headline, lines: trip.banner.lines.slice(0, 4) }
}

function reply(r: string, state: AgentState, extra: Partial<AgentReply> = {}): AgentReply {
  return { reply: r, cards: [], suggestions: [], state, ...extra }
}

/** Main entry: one user message in, one assistant reply out. */
export function runAgent(text: string, state: AgentState, tools: AgentTools): AgentReply {
  const t = norm(text)
  const cat = tools.catalog()
  const trip = tools.trip
  const sug = trip ? TRIP_SUGGESTIONS : NEW_SUGGESTIONS

  if (!t || /^(hi|hello|hey|namaste|help|what can you do)\b/.test(t)) {
    return reply(trip
      ? "I'm your trip assistant. I can re-plan around delays and weather, add or skip places, compare ways to get around, and show your day or budget. Everything goes through the planner, so it always fits opening hours and your budget."
      : "Tell me about your trip in one line: who's going, how many days, budget, what you love, and anything to avoid. I'll build the whole door-to-door plan.",
    state, { suggestions: sug })
  }

  // ---------------- in-trip actions
  if (trip) {
    if (/\b(reset|start over|undo all|original plan)\b/.test(t)) {
      const nt = tools.reset()
      return reply('Back to the original package.', state, { trip: nt, suggestions: sug })
    }

    const isReturn = /return|going home|back home|way back/.test(t)
    if (/(train|shatabdi|double decker).{0,40}(late|delay)|(late|delay).{0,30}train/.test(t) || (/train/.test(t) && /on time/.test(t))) {
      const mins = /on time|not late|no delay/.test(t) ? 0 : parseDuration(t)
      if (mins === null) return reply('How late is the train? For example "train 2 hours late".', state, { suggestions: ['Train is 1 hour late', 'Train is 3 hours late'] })
      const patch = isReturn ? { return_delay_min: Math.min(mins, 300) } : { train_delay_min: Math.min(mins, 600) }
      const nt = tools.disrupt(patch, isReturn ? `return train ${mins} min late` : `train ${mins} min late`)
      return reply(mins ? `Done. ${nt.banner.headline}.` : 'Train set back to on time.', state,
        { trip: nt, cards: mins ? [bannerCard(nt)] : [], suggestions: ['Show day 1', 'Reset the plan', "What's my budget?"] })
    }
    if (/\b(rains?|raining|rainy|monsoon|storms?|showers?)\b/.test(t) && !/no rain/.test(t)) {
      const nt = tools.disrupt({ weather: 'rain' }, 'rain')
      return reply(`Rain plan on. ${nt.banner.headline}.`, state, { trip: nt, cards: [bannerCard(nt)], suggestions: ['Weather is clear now', 'Show indoor places'] })
    }
    if (/\b(heat|hot|heatwave|42|scorching|sunny|summer)\b/.test(t) && !/avoid|photo/.test(t)) {
      const nt = tools.disrupt({ weather: 'heat' }, '42°C heat')
      return reply(`Heat plan on. ${nt.banner.headline}.`, state, { trip: nt, cards: [bannerCard(nt)], suggestions: ['Weather is clear now', 'Show indoor places'] })
    }
    if (/weather (is )?(clear|fine|ok|good)|no rain|cooler now/.test(t)) {
      const nt = tools.disrupt({ weather: 'clear' }, 'clear weather')
      return reply('Weather back to clear; the full plan is restored.', state, { trip: nt, suggestions: sug })
    }
    if (/crowd|queue|rush|packed at/.test(t)) {
      const ps = findPlaces(t, cat).filter((a) => a.kind === 'visit')
      if (!ps.length) return reply('Where is the crowd? For example "huge crowd at Amber Fort".', state)
      const crowd = [...new Set([...trip.disruptions.crowd, ...ps.map((p) => p.id)])]
      const nt = tools.disrupt({ crowd }, `crowd at ${ps.map((p) => p.name).join(', ')}`)
      return reply(`Noted the crowd at ${ps.map((p) => p.name).join(', ')}. ${nt.banner.headline}.`, state, { trip: nt, cards: [bannerCard(nt)] })
    }
    const lateDay = t.match(/day (\d)/)
    if (/(start|leave|wake|running|we're|we are).{0,20}late/.test(t) && !/train/.test(t)) {
      const mins = parseDuration(t) ?? 60
      const day = lateDay ? Number(lateDay[1]) : Math.max(2, Math.min(trip.profile.days, 2))
      if (day === 1) {
        const nt = tools.disrupt({ train_delay_min: trip.disruptions.train_delay_min + mins }, `running ${mins} min late`)
        return reply(`Shifted Day 1 by ${mins} min. ${nt.banner.headline}.`, state, { trip: nt, cards: [bannerCard(nt)] })
      }
      const late = { ...trip.disruptions.late_start, [String(day)]: mins }
      const nt = tools.disrupt({ late_start: late }, `Day ${day} starting ${mins} min late`)
      return reply(`Day ${day} now starts ${mins} min late. ${nt.banner.headline}.`, state, { trip: nt, cards: [bannerCard(nt)] })
    }

    // how to get from A to B
    const route = t.match(/(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+?)(?:\?|$)/)
    if (route && /(how|get|go|reach|travel|ride|cab|auto|route|way)/.test(t)) {
      const c = optionsCard(route[1], route[2], tools)
      return typeof c === 'string' ? reply(c, state) : reply(`Here are your options. Fastest is ${(c as Extract<AgentCard, { type: 'options' }>).options[0].label}.`, state, { cards: [c] })
    }

    if (/\b(skip|remove|drop|cancel|don'?t want|not interested in)\b/.test(t)) {
      const ps = findPlaces(t, cat).filter((a) => a.kind === 'visit')
      if (!ps.length) return reply('Which place should I skip? For example "skip Jal Mahal".', state)
      let nt = trip
      for (const p of ps) nt = tools.skip(p.id)
      return reply(`Skipped ${ps.map((p) => p.name).join(', ')} and re-planned the day around it.`, state, { trip: nt, suggestions: ['Show day 1', 'Undo: reset the plan'] })
    }
    if (/\b(swap|replace|plan b|alternative)\b/.test(t)) {
      const p = findPlaces(t, cat)[0]
      if (!p) return reply('Which stop do you want to swap? For example "swap City Palace".', state)
      try {
        const nt = tools.swap(p.id)
        return reply(nt.message ?? `Swapped ${p.name} for its Plan B.`, state, { trip: nt })
      } catch (e) {
        return reply((e as Error).message, state)
      }
    }
    if (/\b(add|include|visit|see|go to|put)\b/.test(t) && findPlaces(t, cat).length && !wantsPlaces(t)) {
      const ps = findPlaces(t, cat).filter((a) => a.kind === 'visit')
      if (ps.length) {
        let nt = trip
        for (const p of ps) nt = tools.pin(p.id)
        const placed = ps.map((p) => {
          const it = nt.days.flatMap((d) => d.items).find((i) => i.attraction_id === p.id)
          return it ? `${p.name} on Day ${it.day} at ${it.start}` : `${p.name} (no feasible slot: closed or over budget at the free times)`
        })
        return reply(`Added ${placed.join('; ')}.`, state, { trip: nt, suggestions: ['Show day 1', 'Show day 2'] })
      }
    }
    if (/budget|cost|spend|money|receipt|expens|how much/.test(t)) {
      const r = trip.receipt
      return reply(`You're at ${rupee(r.total)} of ${rupee(r.budget)}: ${r.remaining >= 0 ? `${rupee(r.remaining)} left` : `${rupee(-r.remaining)} over`}.`, state, {
        cards: [{ type: 'budget', title: 'Trip receipt', lines: r.lines.filter((l) => l.amount).map((l) => ({ label: l.label, amount: l.amount })), total: r.total, budget: r.budget }],
      })
    }
    const dayQ = t.match(/day\s*(\d)|(today|tomorrow|first day|last day)/)
    if (dayQ && /(show|what|plan|itinerary|schedule|day)/.test(t) && !wantsPlaces(t)) {
      let n = dayQ[1] ? Number(dayQ[1]) : 1
      if (dayQ[2] === 'tomorrow') n = 2
      if (dayQ[2] === 'last day') n = trip.profile.days
      const d = trip.days.find((x) => x.day === n)
      if (!d) return reply(`Your trip has ${trip.days.length} days.`, state)
      return reply(`Day ${n}: ${d.title}.`, state, { cards: [{ type: 'day', title: `Day ${n} · ${d.title}`, stops: stopsOf(d.items) }] })
    }
    if (/itinerary|whole plan|full plan|my plan|schedule/.test(t)) {
      return reply('Here is your full plan.', state, {
        cards: trip.days.map((d) => ({ type: 'day' as const, title: `Day ${d.day} · ${d.title}`, stops: stopsOf(d.items) })),
      })
    }
    if (wantsPlaces(t) || INTEREST_WORDS.some(([re]) => re.test(t))) {
      const c = placesCard(t, tools)
      return reply(c.type === 'places' && c.items.length ? 'Here are some picks. Say "add <place>" to put one in the plan.' : 'Nothing matches that filter.', state, { cards: [c] })
    }
  }

  // ---------------- planning a new trip (or exploring without one)
  if (!trip && wantsPlaces(t)) {
    const c = placesCard(t, tools)
    return reply('Here are some picks in Jaipur. Tell me who is going and I will plan the full trip.', state, { cards: [c], suggestions: sug })
  }
  if (!trip) {
    const route = t.match(/(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+?)(?:\?|$)/)
    if (route) {
      const c = optionsCard(route[1], route[2], tools)
      if (typeof c !== 'string') return reply('Options for that ride:', state, { cards: [c] })
    }
  }

  const parsed = parseSlots(t)
  const confirm = /\b(yes|book it|create( it| this)?|looks good|go ahead|confirm|let'?s do it|perfect|save it)\b/.test(t)
  const slots: Partial<AgentCreate> = { ...state.slots, ...parsed }
  const hasAny = Object.keys(slots).length > 0

  if (confirm && state.slots.persona_id) {
    const c = buildCreate(state.slots, tools.prefs)
    const created = tools.createTrip(c, titleFor(c))
    return reply(`Done! "${created.title}" is saved with the full door-to-door plan. Leave home at ${created.days[0].items[0].start}.`,
      { slots: {} }, { created_trip_id: created.trip_id, trip: created })
  }
  if (!hasAny) {
    return reply(trip
      ? "I didn't catch that. Try one of these:"
      : "Who's travelling? Tell me something like \"family of 4, 2 days, ₹30k, love history\".", state, { suggestions: sug })
  }

  const c = buildCreate(slots, tools.prefs)
  const { profile, view } = tools.preview(c)
  const assumed: string[] = []
  if (!slots.days) assumed.push(`${profile.days} days`)
  if (!slots.budget) assumed.push(`a ${rupee(profile.budget)} budget`)
  if (!slots.travelers) assumed.push(`${profile.travelers} traveller${profile.travelers > 1 ? 's' : ''}`)
  const fromPrefs: string[] = []
  if (!parsed.diet && c.diet && c.diet !== 'any' && state.slots.diet === undefined) fromPrefs.push(`${c.diet} meals`)
  if (!parsed.mobility && c.mobility === 'limited' && state.slots.mobility === undefined) fromPrefs.push('limited mobility')
  const over = view.receipt.remaining < 0
  const lines = [
    `Here's your door-to-door plan: leave home ${view.days[0].items[0].start}, back home ${lastItem(view).start}, ${rupee(view.receipt.total)} all-in.`,
    assumed.length ? `I assumed ${assumed.join(', ')}.` : '',
    fromPrefs.length ? `Using your saved preferences: ${fromPrefs.join(', ')}.` : '',
    over ? `That's ${rupee(-view.receipt.remaining)} over budget; say "budget 20k" or "make it 2 days" to adjust.` : 'Say "create it" to save, or tell me what to change.',
  ].filter(Boolean)
  return reply(lines.join(' '), { slots }, {
    cards: [planCard(view, profile, c, titleFor(c))],
    suggestions: ['Create it', 'Make it 3 days', 'More food stops', 'Relaxed pace'],
  })
}

function lastItem(view: View): Item {
  const d = view.days[view.days.length - 1]
  return d.items[d.items.length - 1]
}

function buildCreate(s: Partial<AgentCreate>, prefs: Prefs): AgentCreate {
  const persona_id = inferPersona(s)
  return {
    persona_id,
    travelers: s.travelers,
    days: s.days,
    budget: s.budget,
    interests: s.interests,
    pace: s.pace,
    diet: (s.diet ?? prefs.diet) as Diet,
    mobility: (s.mobility ?? prefs.mobility) as Mobility,
    avoid_heat: s.avoid_heat ?? prefs.avoid_heat,
  }
}

function titleFor(c: AgentCreate): string {
  const p = PERSONAS.find((x) => x.id === c.persona_id)!
  const who = c.persona_id === 'family' ? 'Family' : c.persona_id === 'student' ? 'Backpacker' : 'Solo'
  return `${who} Jaipur ${c.days ?? p.days}-day trip`
}
