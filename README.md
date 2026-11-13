# DelayProof Trip

**Problem Statement 2: Smarter Travel, Better Experience.**
A door-to-door, self-healing trip package: home → train → Jaipur → home, on one budget-tracked receipt.
When a train runs late, the heat spikes or a crowd surges, the plan repairs itself and explains what changed.

> In India one late train breaks the whole chain. A tourist whose Ajmer Shatabdi reaches Jaipur 3 hours late
> misses City Palace's 17:00 closing, wastes the pre-booked pickup and tickets, and drags bags through 42°C heat.
> DelayProof keeps the must-see spots by moving them to tomorrow, drops bags at the station cloakroom, and
> protects the return train.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + TypeScript (Vite), Leaflet / react-leaflet |
| Backend | Python 3.13, FastAPI, Motor (async MongoDB) |
| Database | MongoDB Atlas (falls back to in-memory automatically if Atlas is unreachable) |

## Run it

Prerequisites: Python 3.11+, Node 20+. Commands below are for Windows PowerShell; run each line separately
(PowerShell 5.1 does not support `&&`; use `;` to chain).

**1. Backend** (port 8000)

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
```

Edit `backend/.env` and set `MONGO_URI` (Atlas connection string). Set `USE_MEMORY_DB=1` to run fully offline.

```bash
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

On startup the API seeds the Jaipur catalog (attractions, stays, trains, personas) and the initial model weights.

**2. Frontend** (port 5173, proxies `/api` to the backend)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Features → problem-statement pillars

| Feature | Where | Pillar |
|---|---|---|
| **Door-to-door timeline**: leave-by time from home, station buffer, train, check-in, sights, checkout, return train, ride home | Journey strip + timeline | Smart routes |
| **One package receipt**: trains + stay + home rides + local rides + tickets + meals vs budget | Receipt card | Personalized |
| **Persona presets**: student backpacker (hostel, buses), family (haveli, AC cabs), solo photographer (boutique, autos) | Landing | Personalized |
| **Self-healing re-plan**: train delay, 42°C heat, rain, crowd surge, late start, return-train delay | "Simulate real life" panel | Dynamic & intelligent |
| **Must-see cascade**: flagship stops that no longer fit Day 1 move to Day 2; late-closing stops fill Day 1 evening | Re-plan engine | Dynamic & intelligent |
| **Station cloakroom rescue**: delay ≥ 90 min → bags at the station, check-in moved to evening | Day 1 timeline | Dynamic & intelligent |
| **Return-train guard**: last day is planned backwards from the return train; low-value stops are dropped first | Last-day timeline | Smarter decisions |
| **Pre-computed Plan B** for every stop: open in the same window, fits the budget, delays the next stop ≤ 10 min. One-tap swap | Timeline | Smarter, faster decisions |
| **Smart commute upgrades**: bus → auto → express auto → cab when a closing time is tight and the budget allows | Transfer rows | Smarter decisions |
| **Hill physics & corridor buffers**: +35% on ghat roads to Amber/Nahargarh, Old City congestion, learned per-corridor delay | Transfer notes | Smart routes |
| **Explainable re-plan banner**: what moved, why, money saved vs a static plan | Banner | Live insights |
| **Live mode**: scrub the clock, see "right now", next stop and "leave in N min" | Timeline | Live insights |
| **Self-learning**: Kept/Skipped updates scoring weights (online logistic regression); "log actual time" updates corridor buffers (EMA) | Timeline + Judge drawer | Self-learning & growth |
| **Judge AI drawer**: static vs DelayProof comparison, weight sliders, synthetic seeder with holdout accuracy chart, corridor table | 🧠 Judge AI | All |
| **Offline pocket pass**: printable itinerary with Plan Bs and helplines | 🖨️ Pocket pass | Usability |
| **Late-night safety**: arrivals after 22:00 get a verified cab and a live-trip share note | Last transfer | Usability |

## How the engine works

```
backend/app/
  data/jaipur.py         mock catalog: 19 places, 3 stays, 4 trains, ride modes, corridor buffers, personas
  engine/geo.py          travel model: haversine × road factor, hill ×1.35, Old City ×1.2, + learned buffer
  engine/scheduler.py    door-to-door planner (anchors + greedy scoring + Plan B)
  engine/replan.py       baseline vs re-plan diff, static-plan comparison, explanation banner, receipt
  engine/learning.py     online weight updates, corridor EMA, synthetic seeder + holdout evaluation
  main.py                FastAPI routes
```

1. **Anchors never move**: trains, hotel check-in/checkout, closing times and the return-train deadline.
2. **Flexible stops are placed greedily.** At each step every open, affordable, weather-safe stop is scored:

   `score = w_interest·match + w_flagship·must-see − w_travel·hours − w_budget·cost + w_urgency·closing-soon − w_crowd·queue + learned tag affinity`

   A stop is feasible only if it finishes before closing and still leaves time to get back to the hotel (or to the station on the last day).
3. **Lunch** is inserted between 12:30 and 14:30, picking the cheapest nearby option for the persona.
4. **Re-plan** = rebuild with the same anchors and the new disruption, then diff against the baseline to explain every move.
5. **Plan B** is computed after the plan is built, for each stop, against the real gap between the previous and next stops.

The engine is deterministic and rule-based, so it never breaks during a demo, and every decision can be explained in plain English.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status and DB mode (atlas / memory) |
| GET | `/api/meta` | Personas, stays, trains, attractions, modes |
| POST | `/api/trips` | Create a trip from a persona (+ travellers, days, budget) |
| GET | `/api/trips/{id}` | Current plan, baseline, receipt, banner, diff |
| POST | `/api/trips/{id}/disruptions` | Apply train delay / weather / crowd / late start / return delay |
| POST | `/api/trips/{id}/swap` | Swap a stop for its Plan B (same day) |
| POST | `/api/trips/{id}/feedback` | Kept / Skipped → learning update (+ re-plan on skip) |
| POST | `/api/trips/{id}/ride-log` | Actual ride time → corridor buffer update |
| POST | `/api/trips/{id}/reset` | Back to the original package |
| GET / PUT | `/api/learning`, `/api/learning/weights` | Model state, judge weight sliders |
| POST | `/api/learning/simulate` | Synthetic seeder: holdout accuracy & corridor error before/after (`apply` to persist) |
| POST | `/api/learning/reset` | Reset learned weights and buffers |

## 4-minute demo script

1. **Problem (30 s)**: the landing page's "domino effect" card: 3 h late → hotel detour → City Palace closed → tickets wasted.
2. **Plan (40 s)**: click *Family Weekend*. Show the journey strip (leave home 04:35 → home 23:45) and the one-package receipt.
3. **Disrupt (60 s)**: Train **+3h**. Banner: cloakroom drop, a flagship moved to Day 2, money saved, must-see kept vs a static plan. Map: grey dashed original route vs blue new route.
4. **More real life (40 s)**: **42°C heat** swaps outdoor stops for indoor ones and AC cabs. **Day 2 +3h** drops low-value stops to protect the return train.
5. **Plan B & learning (40 s)**: one-tap Plan B swap; mark a stop Kept/Skipped; log an actual ride time.
6. **Judge AI (30 s)**: static vs DelayProof, weight sliders, *Run simulation*: holdout accuracy climbs (≈69% → 81%) and ride-time error drops (≈7.0 → 3.1 min).

## Mock vs real

| Real logic (working now) | Mock data (labelled) | Production source |
|---|---|---|
| Door-to-door scheduler, anchors, deadlines | Train timings and delays | NTES / RailYatri live status |
| Cascade, Plan B, mode upgrades | Ride fares | Ola / Uber / Rapido APIs |
| Budget receipt | Ticket prices, opening hours | ASI e-tickets, Google Places |
| Explanation and static-plan comparison | Weather toggle | IMD / OpenWeather hourly |
| Online learning + corridor EMA | Crowd surge toggle | Popular-times / queue sensors |
| Holdout evaluation | Synthetic feedback (seeded, labelled) | Real Kept/Skipped + GPS ride logs |

## Roadmap

1. **MVP (this build)**: Jaipur, 3 personas, rule-based engine, learning loop, Atlas persistence.
2. **Live data**: NTES train status, weather and fare APIs; push notification when a re-plan happens.
3. **Booking partners**: IRCTC, hotels and ASI tickets in one checkout; free rescheduling of the station pickup.
4. **More cities and group mode**: merge several travellers' preferences into one fair plan.
