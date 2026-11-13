export type Place = { name: string; lat?: number; lng?: number; zone?: string }

export type PlanB = {
  id: string
  name: string
  start: string
  end: string
  indoor: boolean
  extra_min: number
  cost_delta: number
  close: string
  blurb: string
  reason: string
}

export type ItemType =
  | 'home' | 'transfer' | 'buffer' | 'train' | 'checkin' | 'cloakroom' | 'visit' | 'meal'
  | 'checkout' | 'collect_bags' | 'hotel' | 'free' | 'arrive_home'

export type Status = 'normal' | 'delayed' | 'moved' | 'rescued' | 'upgraded'

export type Item = {
  id: string
  day: number
  type: ItemType
  title: string
  subtitle?: string
  start: string
  end: string
  start_min: number
  end_min: number
  status: Status
  notes: string[]
  cost?: number
  mode?: string
  km?: number
  buffer?: number
  frm?: Place
  to?: Place
  intercity?: boolean
  lat?: number
  lng?: number
  zone?: string
  attraction_id?: string
  fee?: number
  indoor?: boolean
  flagship?: boolean
  tags?: string[]
  blurb?: string
  open?: string
  close?: string
  plan_b?: PlanB
  anchor?: boolean
  delay_min?: number
  scheduled_arr?: string
  safety?: boolean
}

export type Day = { day: number; date: string; title: string; items: Item[] }

export type Disruptions = {
  train_delay_min: number
  return_delay_min: number
  weather: 'clear' | 'heat' | 'rain'
  crowd: string[]
  late_start: Record<string, number>
  skipped: string[]
  swaps: Record<string, string>
  swap_days?: Record<string, number>
  pins?: string[]
}

export type Change = {
  kind: 'moved' | 'added' | 'dropped' | 'retimed'
  id: string
  name: string
  from_day?: number
  from?: string
  to_day?: number
  to?: string
  reason: string
  flagship?: boolean
}

export type Profile = {
  persona_id: string
  persona_label: string
  travelers: number
  budget: number
  days: number
  interests: string[]
  pace: string
  stay_id: string
  modes: string[]
  train_class: string
  outbound: string
  return: string
  day_start: string
  day_end: string
  home: { label: string; lat: number; lng: number; to_station_km: number }
  start_date: string
  diet?: Diet
  mobility?: Mobility
  avoid_heat?: boolean
}

export type Diet = 'any' | 'veg' | 'jain'
export type Mobility = 'normal' | 'limited'

export type Prefs = {
  interests: string[]
  pace: 'relaxed' | 'balanced' | 'packed'
  diet: Diet
  mobility: Mobility
  avoid_heat: boolean
  day_start: string
  day_end: string
  budget?: number
  travelers?: number
}

export type User = { id: string; name: string; emoji: string; color: string; prefs: Prefs }

export type Role = 'owner' | 'editor' | 'viewer'
export type Member = { user_id: string; role: Role; joined_at: string }

export type TripSummary = {
  trip_id: string
  title: string
  persona_label: string
  start_date: string
  days: number
  travelers: number
  owner_id: string
  members: Member[]
  mode_on: boolean
  budget: number
  updated_at: string
}

export type PollOption = { id: string; label: string }
export type Poll = {
  question: string
  options: PollOption[]
  votes: Record<string, string>
  action?: { type: 'swap'; attraction_id: string; alt_id: string; alt_name: string }
  closed?: boolean
  result?: string
}

export type Message = {
  id: string
  trip_id: string
  user_id: string // a user id, 'agent' or 'system'
  kind: 'text' | 'system' | 'poll' | 'agent'
  text: string
  at: string
  poll?: Poll
  cards?: AgentCard[]
}

export type Ticket = {
  id: string
  trip_id: string
  kind: 'train' | 'hotel' | 'entry' | 'custom'
  title: string
  subtitle?: string
  code?: string
  status?: string
  day?: number
  item_id?: string
  time?: string
  auto?: boolean
  file?: string // data URL (frontend-only) or API URL (full stack)
  file_name?: string
  added_by?: string
  at?: string
}

export type Memory = {
  id: string
  trip_id: string
  user_id: string
  day: number
  stop: string
  item_id?: string
  caption: string
  photo?: string
  at: string
}

export type JournalEntry = {
  trip_id: string
  day: number
  user_id: string
  text: string
  mood: string
  shared: boolean
  updated_at: string
}

export type PlaceCardItem = {
  id: string; name: string; blurb: string; fee: number; open: string; close: string; tags: string[]
  indoor: boolean; flagship: boolean; stairs?: boolean; in_trip?: boolean
}
export type AgentCard =
  | { type: 'places'; title: string; items: PlaceCardItem[] }
  | { type: 'options'; title: string; from: string; to: string;
      options: { mode: string; label: string; minutes: number; cost: number; note?: string; best?: boolean }[] }
  | { type: 'plan'; title: string; summary: string[]; total: number; budget: number;
      days: { day: number; date: string; stops: { time: string; name: string; kind: string }[]; leave?: string; home?: string }[];
      create?: AgentCreate }
  | { type: 'day'; title: string; stops: { time: string; name: string; kind: string; status?: string }[] }
  | { type: 'budget'; title: string; lines: { label: string; amount: number }[]; total: number; budget: number }
  | { type: 'banner'; title: string; lines: string[] }

export type AgentCreate = {
  persona_id: string; travelers?: number; days?: number; budget?: number; interests?: string[]; pace?: string
  diet?: Diet; mobility?: Mobility; avoid_heat?: boolean
}

export type AgentState = { slots: Partial<AgentCreate>; asked?: string[] }

export type AgentReply = {
  reply: string
  cards: AgentCard[]
  suggestions: string[]
  state: AgentState
  trip?: Trip
  created_trip_id?: string
}

export type PackItem = {
  id: string
  trip_id: string
  text: string
  category: string
  assignee?: string // user who brings it
  done_by?: string // user who packed it
  added_by?: string
  why?: string // reason when suggested by the plan
}

export type Expense = {
  id: string
  trip_id: string
  title: string
  amount: number
  paid_by: string
  split: string[] // user ids sharing the cost
  day: number
  category: 'package' | 'extra'
  at: string
}

export type TripEvent = {
  type: 'trip' | 'messages' | 'tickets' | 'memories' | 'journal' | 'trips' | 'packing' | 'expenses'
  trip_id?: string
}

export type Receipt = {
  lines: { key: string; label: string; amount: number }[]
  total: number
  budget: number
  remaining: number
  baseline_total: number
}

export type Banner = {
  active: boolean
  headline: string
  lines: string[]
  savings: { label: string; value: string; detail: string }[]
}

export type Naive = {
  missed: { name: string; flagship: boolean; lost: number }[]
  flagships_missed: number
  wasted: number
  missed_train: boolean
  exposed: string[]
}

export type Trip = {
  trip_id: string
  title?: string
  owner_id?: string
  members?: Member[]
  mode_on?: boolean
  invite_code?: string
  profile: Profile
  feedback: Record<string, 'kept' | 'skipped'>
  message: string | null
  days: Day[]
  baseline_days: Day[]
  receipt: Receipt
  changes: Change[]
  naive: Naive
  banner: Banner
  stats: { flagships_total: number; flagships_kept: number; stops: number; baseline_stops: number; used_cloakroom: boolean }
  disruptions: Disruptions
  learning_delta?: Record<string, number>
}

export type Persona = {
  id: string
  label: string
  emoji: string
  travelers: number
  budget: number
  days: number
  interests: string[]
  pace: string
  stay_type: string
  description: string
}

export type Attraction = {
  id: string
  name: string
  lat: number
  lng: number
  zone: string
  open: string
  close: string
  fee: number
  flagship: boolean
  indoor: boolean
  kind: 'visit' | 'meal'
  tags: string[]
}

export type Meta = {
  city: { name: string; center: [number, number]; station: Place }
  personas: Persona[]
  stays: { id: string; name: string; type: string; lat: number; lng: number; price_per_night: number; perks: string[] }[]
  attractions: Attraction[]
  modes: Record<string, { label: string }>
  interests: string[]
  db: string
}

export type LearningState = {
  weights: Record<string, number>
  defaults: Record<string, number>
  tag_affinity: Record<string, Record<string, number>>
  updates: number
  corridors: { corridor: string; buffer: number; initial: number; samples: number }[]
  feedback: { real: number; synthetic: number }
  db: string
}

export type SimResult = {
  persona: string
  n_train: number
  n_holdout: number
  kept_rate: number
  accuracy: { before: number; after: number; curve: { epoch: number; accuracy: number }[] }
  weights_before: Record<string, number>
  weights_after: Record<string, number>
  corridors: {
    mae_before: number
    mae_after: number
    table: { corridor: string; before: number; after: number; true: number }[]
  }
  applied: boolean
}
