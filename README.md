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
| App | React 19 + TypeScript (Vite), Leaflet / react-leaflet |
| Engine | TypeScript, runs in the browser (`frontend/src/engine/`) |
| Storage | Browser `localStorage` (trips, learned weights, corridor buffers) |

**This is the `frontend-only` branch: no backend server and no database are needed.** The planner, re-plan and
learning engine that lived in the Python/FastAPI backend on `main` has been ported line for line to TypeScript
and gives identical plans for every persona and disruption (checked on 36 scenarios). The `backend/` folder is
kept only for reference.

## Run it

Prerequisites: Node 20+. Commands below are for Windows PowerShell; run each line separately
(PowerShell 5.1 does not support `&&`; use `;` to chain).

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

To deploy, run `npm run build` and upload `frontend/dist/` to any static host (Netlify, Vercel, GitHub Pages).
Asset paths are relative, so it also works from a sub-folder or opened through a local static server.

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

### Plan together & travel companion

| Feature | Where | How it works here (browser only) |
|---|---|---|
| **AI trip assistant** | Home + 🤖 Assistant tab | One-line requests ("family of 4, 2 days, ₹30k, veg, no long walks") become a full door-to-door plan preview; in a trip it handles "train 2h late", "it's raining", "skip / add / swap X", "how do I get from A to B", "show day 2", "budget". Every answer runs through the planner, so it cannot invent times or prices. Offline rule brain (`engine/agent.ts`); an LLM key slot is in Preferences. |
| **Preferences** | Avatar menu → Preferences | Interests, pace, diet (any/veg/Jain), walking (limited = no stair-heavy forts, short walks, cabs on hills), stay indoors 12–16, day start/end. "Save & re-plan" rebuilds the trip around them. |
| **Sharing & members** | 💬 Group tab | Add a friend directly or share an invite code / link (`?join=CODE`, works across tabs of this browser). A second link carries the whole trip, so it opens on any device. |
| **Group chat & polls** | 💬 Group tab | Re-plans post themselves; "Swap X for its Plan B?" polls apply the swap on a majority yes; `@ai` answers in the thread. Tabs sync live through a BroadcastChannel. |
| **Ticket wallet** | 🎫 Wallet | Package tickets generated from the plan with live status, plus uploaded PDFs/photos (IndexedDB, works offline). |
| **Memories & journal** | 📸 / 📓 | Photos pinned to stops; daily journal drafted from the plan, changes and memories; private or shared. |
| **Calendar** | 📅 Calendar | Month + day agenda and `.ics` export with alerts. (The live subscription feed needs the server: see `main`.) |
| **Trip mode** | 🧭 Start trip mode | Now / next / leave-in countdown, the ticket you need, Running late (re-plans), Done, Skip, Plan B, Add memory, Share status, location check. |
| **Demo identities** | Login | One click as Priya / Rohit / Ananya / Kabir, per browser tab. Two tabs = two friends on the same trip. |

`main` has the same screens backed by FastAPI + MongoDB Atlas with WebSocket sync and a live calendar feed. Both branches produce identical plans (126 scenarios checked).

## How the engine works

```
frontend/src/engine/
  data.ts           mock catalog: 19 places, 3 stays, 4 trains, ride modes, corridor buffers, personas
  geo.ts            travel model: haversine × road factor, hill ×1.35, Old City ×1.2, + learned buffer
  scheduler.ts      door-to-door planner (anchors + greedy scoring + Plan B)
  replan.ts         baseline vs re-plan diff, static-plan comparison, explanation banner, receipt
  learning.ts       online weight updates, corridor EMA, synthetic seeder + holdout evaluation
  store.ts          the "API": trips, members, chat, polls, wallet, memories, journal, learning (localStorage)
  agent.ts          offline trip assistant: intent + detail rules that call the planner
  users.ts / idb.ts demo identities; IndexedDB file store for photos and tickets
```

1. **Anchors never move**: trains, hotel check-in/checkout, closing times and the return-train deadline.
2. **Flexible stops are placed greedily.** At each step every open, affordable, weather-safe stop is scored:

   `score = w_interest·match + w_flagship·must-see − w_travel·hours − w_budget·cost + w_urgency·closing-soon − w_crowd·queue + learned tag affinity`

   A stop is feasible only if it finishes before closing and still leaves time to get back to the hotel (or to the station on the last day).
3. **Lunch** is inserted between 12:30 and 14:30, picking the cheapest nearby option for the persona.
4. **Re-plan** = rebuild with the same anchors and the new disruption, then diff against the baseline to explain every move.
5. **Plan B** is computed after the plan is built, for each stop, against the real gap between the previous and next stops.

The engine is deterministic and rule-based, so it never breaks during a demo, and every decision can be explained in plain English.

## Engine operations (`frontend/src/engine/store.ts`)

These mirror the REST endpoints of the backend on `main`, so moving back to a server later is a one-file change
(`src/api.ts`).

| Operation | Purpose |
|---|---|
| `api.meta()` | Personas, stays, trains, attractions, modes |
| `api.createTrip(opts)` | Create a trip from a persona (+ travellers, days, budget) |
| `api.trip(id)` | Current plan, baseline, receipt, banner, diff |
| `api.disrupt(id, d)` | Apply train delay / weather / crowd / late start / return delay |
| `api.swap(id, stop)` | Swap a stop for its Plan B (same day) |
| `api.feedback(id, stop, kept/skipped)` | Learning update (+ re-plan on skip) |
| `api.rideLog(id, ride)` | Actual ride time → corridor buffer update |
| `api.reset(id)` | Back to the original package |
| `api.learning()`, `api.setWeights(w)` | Model state, judge weight sliders |
| `api.simulate(persona, apply)` | Synthetic seeder: holdout accuracy & corridor error before/after (`apply` to persist) |
| `api.resetLearning()` | Reset learned weights and buffers |

## 5-minute demo script

Open two tabs of the same browser side by side: tab A as **Priya**, tab B as **Rohit** (Avatar menu → Switch user).

1. **Problem (20 s)**: the "domino effect" card: 3 h late → hotel detour → City Palace closed → tickets wasted.
2. **Plan by chat (45 s)**: in A, type *"Family of 4, 2 days, ₹30k, we love history and food, no long walks for my parents"*. The plan card shows leave-home time, every stop and the all-in cost; Priya's saved veg preference is applied. *Create it*.
3. **Plan together (40 s)**: Group tab → add Rohit. In B the trip appears. Create a Plan B swap poll; Rohit votes in B, Priya votes in A: the swap applies itself and both chats update live.
4. **Disrupt (50 s)**: Assistant: *"our train is 3 hours late"*. Banner: cloakroom drop, a flagship moved to Day 2, money saved. The group chat and the wallet (train ticket "running 180 min late") update on their own.
5. **Trip mode (45 s)**: start Trip mode: now / next / leave-in countdown, the ticket you need, *Running late +30* re-plans, add a memory, share status to the group.
6. **Memories & journal (30 s)**: the memory shows on the wall; Journal → *Draft from my day* writes the day from the plan, the delay and the memory.
7. **Judge AI (30 s)**: static vs DelayProof, weight sliders, *Run simulation*: holdout accuracy climbs (Family: 53% → 86%) and ride-time error drops (7.1 → 3.2 min).

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

1. **MVP (this build)**: Jaipur, 3 personas, rule-based engine, learning loop, all in the browser.
   The `main` branch has the same engine behind a FastAPI + MongoDB Atlas backend for shared, cross-device learning.
2. **Live data**: NTES train status, weather and fare APIs; push notification when a re-plan happens.
3. **Booking partners**: IRCTC, hotels and ASI tickets in one checkout; free rescheduling of the station pickup.
4. **More cities and group mode**: merge several travellers' preferences into one fair plan.
