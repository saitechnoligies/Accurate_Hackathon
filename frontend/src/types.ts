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
