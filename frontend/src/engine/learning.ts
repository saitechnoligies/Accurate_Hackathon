/* Self-learning loop.

   1. Kept / Skipped feedback -> online logistic update of the scoring weights the
      planner uses (interest, flagship, budget, travel) plus per-persona tag affinity.
   2. Actual ride durations -> exponential moving average on per-corridor delay buffers.
   3. A synthetic trip seeder with a hidden "true" traveller model, used to show
      before/after holdout accuracy to the judges. */
import type { SimResult } from '../types'
import type { AttractionData, Catalog } from './data'
import { pyRound } from './geo'

const LR = 0.15
const EMA_ALPHA = 0.3
const CLAMP_W: [number, number] = [0, 3]
const CLAMP_AFF: [number, number] = [-2, 2]

const EFFORT: Record<string, number> = {
  amber_hill: 1.0, nahargarh_hill: 0.9, outskirts: 0.8, east: 0.5, south: 0.5, old_city: 0.3, central: 0.2, station: 0.2,
}

type Truth = { bias: number; interest: number; flagship: number; budget: number; travel: number; tags: Record<string, number> }

// Hidden preferences used only by the synthetic seeder (the model never sees these directly)
const TRUE_MODELS: Record<string, Truth> = {
  family: { bias: 0.3, interest: 0.9, flagship: 0.5, budget: 0.5, travel: 2.4,
    tags: { food: 1.3, shopping: 1.0, nature: -0.9, science: -0.8, spiritual: 0.5 } },
  student: { bias: 0.2, interest: 1.0, flagship: 0.3, budget: 2.8, travel: 0.6,
    tags: { photography: 1.1, food: 0.9, history: -0.4, shopping: -1.0 } },
  solo: { bias: 0.1, interest: 1.4, flagship: 0.2, budget: 0.7, travel: 0.4,
    tags: { nature: 1.3, photography: 1.2, shopping: -1.2, culture: -0.5 } },
}
const TRUE_BUFFERS: Record<string, number> = {
  'amber_hill|old_city': 24, 'amber_hill|central': 21, 'amber_hill|station': 27, 'old_city|station': 15,
  'central|old_city': 10, 'nahargarh_hill|old_city': 19, 'old_city|old_city': 7, 'central|station': 6,
  'outskirts|central': 18, 'outskirts|old_city': 22, 'east|old_city': 11,
}

export type Features = { interest: number; flagship: number; budget: number; travel: number; tags: string[] }
type W = Record<string, number>

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))))
const clamp = (v: number, [lo, hi]: [number, number]) => pyRound(Math.max(lo, Math.min(hi, v)), 4)

export function features(a: AttractionData, interests: string[], travelers = 1, effortScale = 1): Features {
  const m = a.tags.filter((t) => interests.includes(t)).length
  return {
    interest: m === 0 ? 0 : Math.min(1, 0.6 + 0.2 * (m - 1)),
    flagship: a.flagship ? 1 : 0,
    budget: Math.min(1.5, (a.fee * travelers) / 500),
    travel: (EFFORT[a.zone] ?? 0.4) * effortScale,
    tags: a.tags,
  }
}

export function predict(w: W, aff: W, x: Features, bias = 0.4): number {
  const tag = x.tags.reduce((s, t) => s + (aff[t] ?? 0), 0) / Math.max(1, x.tags.length)
  return sigmoid(bias + w.interest * x.interest + w.flagship * x.flagship - w.budget * x.budget - w.travel * x.travel + tag)
}

/** One SGD step on log-loss. Mutates w/aff in place, returns the prediction before the step. */
export function update(w: W, aff: W, x: Features, kept: boolean, lr = LR): number {
  const p = predict(w, aff, x)
  const err = (kept ? 1 : 0) - p
  w.interest = clamp(w.interest + lr * err * x.interest, CLAMP_W)
  w.flagship = clamp(w.flagship + lr * err * x.flagship, CLAMP_W)
  w.budget = clamp(w.budget - lr * err * x.budget, CLAMP_W)
  w.travel = clamp(w.travel - lr * err * x.travel, CLAMP_W)
  for (const t of x.tags) aff[t] = clamp((aff[t] ?? 0) + (lr * err) / x.tags.length, CLAMP_AFF)
  return p
}

export function updateCorridor(buffer: number, plannedBase: number, actual: number, alpha = EMA_ALPHA): number {
  const observedExtra = Math.max(0, actual - plannedBase)
  return pyRound(buffer + alpha * (observedExtra - buffer), 2)
}

// --------------------------------------------------------------------------- seeded RNG
function rngFrom(seed: number) {
  let s = seed >>> 0
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    random,
    choice: <T,>(xs: T[]): T => xs[Math.floor(random() * xs.length)],
    uniform: (a: number, b: number) => a + (b - a) * random(),
    gauss: (mu: number, sigma: number) => {
      const u = 1 - random()
      const v = random()
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    },
    shuffle: <T,>(xs: T[]) => {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[xs[i], xs[j]] = [xs[j], xs[i]]
      }
    },
  }
}

// --------------------------------------------------------------------------- simulation
export type SimFull = Omit<SimResult, 'applied'> & {
  tag_affinity_after: W
  corridors: SimResult['corridors'] & { learned: Record<string, number> }
  events: { attraction_id: string; kept: boolean }[]
}

export function simulate(catalog: Catalog, persona: Catalog['personas'][number], n = 400, seed = 7, epochs = 12): SimFull {
  const rng = rngFrom(seed)
  const truth = TRUE_MODELS[persona.id]
  const visitsList = catalog.attractions.filter((a) => a.kind === 'visit')

  const events: { attraction_id: string; x: Features; kept: boolean }[] = []
  for (let i = 0; i < n; i++) {
    const a = rng.choice(visitsList)
    const travelers = Math.max(1, persona.travelers + rng.choice([-1, 0, 0, 1]))
    const x = features(a, persona.interests, travelers, rng.uniform(0.5, 1.6))
    const tag = x.tags.reduce((s, t) => s + (truth.tags[t] ?? 0), 0) / x.tags.length
    const z = truth.bias + truth.interest * x.interest + truth.flagship * x.flagship - truth.budget * x.budget
      - truth.travel * x.travel + tag + rng.gauss(0, 0.35)
    events.push({ attraction_id: a.id, x, kept: z > 0 })
  }
  const split = Math.trunc(n * 0.75)
  const train = events.slice(0, split)
  const hold = events.slice(split)

  const keys = ['interest', 'flagship', 'budget', 'travel']
  const weights: W = Object.fromEntries(keys.map((k) => [k, catalog.weights[k]]))
  const aff: W = { ...(catalog.tag_affinity[persona.id] ?? {}) }

  const acc = () => pyRound(hold.filter((e) => (predict(weights, aff, e.x) > 0.5) === e.kept).length / hold.length, 3)

  const curve = [{ epoch: 0, accuracy: acc() }]
  for (let ep = 1; ep <= epochs; ep++) {
    rng.shuffle(train)
    for (const e of train) update(weights, aff, e.x, e.kept)
    curve.push({ epoch: ep, accuracy: acc() })
  }

  // corridor buffers: rides with hidden true extra delay
  const corridors = { ...catalog.corridors }
  const rides: { key: string; base: number; actual: number }[] = []
  const trueKeys = Object.keys(TRUE_BUFFERS)
  for (let i = 0; i < n; i++) {
    const key = rng.choice(trueKeys)
    const base = rng.uniform(15, 50)
    rides.push({ key, base, actual: base + TRUE_BUFFERS[key] + rng.gauss(0, 4) })
  }
  const rTrain = rides.slice(0, split)
  const rHold = rides.slice(split)
  const mae = (bufs: Record<string, number>) =>
    pyRound(rHold.reduce((s, r) => s + Math.abs(r.actual - (r.base + (bufs[r.key] ?? 6))), 0) / rHold.length, 2)

  const maeBefore = mae(corridors)
  const learned = { ...corridors }
  for (const r of rTrain) learned[r.key] = updateCorridor(learned[r.key] ?? 6, r.base, r.actual)
  const maeAfter = mae(learned)

  return {
    persona: persona.id,
    n_train: train.length,
    n_holdout: hold.length,
    kept_rate: pyRound(events.filter((e) => e.kept).length / n, 3),
    accuracy: { before: curve[0].accuracy, after: curve[curve.length - 1].accuracy, curve },
    weights_before: Object.fromEntries(keys.map((k) => [k, catalog.weights[k]])),
    weights_after: weights,
    tag_affinity_after: aff,
    corridors: {
      mae_before: maeBefore,
      mae_after: maeAfter,
      table: trueKeys.map((k) => ({ corridor: k, before: pyRound(corridors[k] ?? 6, 1), after: pyRound(learned[k], 1),
        true: TRUE_BUFFERS[k] })),
      learned,
    },
    events: train.map((e) => ({ attraction_id: e.attraction_id, kept: e.kept })),
  }
}
