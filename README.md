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

### Plan together & travel companion

| Feature | Where | How it works |
|---|---|---|
| **AI trip assistant** | Home + 🤖 Assistant tab | One-line requests ("family of 4, 2 days, ₹30k, veg, no long walks") become a full door-to-door plan preview; in a trip it handles "train 2h late", "it's raining", "skip / add / swap X", "how do I get from A to B", "show day 2", "budget". Every answer runs through the planner, so it cannot invent times or prices. Offline rule brain today; an LLM plugs into the same tools (`backend/app/engine/llm.py`, key in `backend/.env`). |
| **Preferences** | Avatar menu → Preferences | Interests, pace, diet (any/veg/Jain), walking (limited = no stair-heavy forts, short walks, cabs on hills), stay indoors 12–16, day start/end. Saved per user; "Save & re-plan" rebuilds the trip around them. |
| **Sharing & members** | 💬 Group tab | Add a friend directly or share an invite code / link (`?join=CODE`). Members see everything; receipt split per member. |
| **Group chat & polls** | 💬 Group tab | Every re-plan posts itself with the engine's explanation. "Swap X for its Plan B?" polls apply the swap on a majority yes. `@ai` answers inside the thread. Live over a WebSocket. |
| **Ticket wallet** | 🎫 Wallet | Package tickets (train PNR, hotel voucher, entry tickets with QR) generated from the plan with live status ("running 180 min late", "moved to Day 2"), plus uploaded PDFs/photos. |
| **Memories** | 📸 Memories | Photo + caption pinned to a stop; shown in the journal. |
| **Journal** | 📓 Journal | One page per day, drafted from the day's plan, changes and memories; mood; private or shared. |
| **Calendar** | 📅 Calendar | Month + day agenda, `.ics` export with alerts, and a **live subscription feed** (`/api/trips/{id}/calendar.ics`): when the plan re-heals, the phone calendar follows. |
| **Trip mode** | 🧭 Start trip mode | One-screen companion: now / next / leave-in countdown, the ticket you need, Running late (re-plans), Done, Skip, Plan B, Add memory, Share status, location check. |
| **Demo identities** | Login | One click as Priya / Rohit / Ananya / Kabir, remembered per browser tab. Two windows = two friends on the same trip. |
| **Live forecast & air quality** | 🧭 Guide, Plan tab | Open-Meteo daily forecast for the trip dates and CAMS air quality, keyless, cached with their fetch time. A "simulate heatwave" switch is labelled Simulated. |
| **Proactive suggestions** | Plan tab (top) | Detectors over the plan + live data: forecast ≥ 40°C or rain on a trip day, AQI > 150, budget ≥ 90% (including logged extras), a must-see at crowd peak, late-night arrival. Accepting one re-plans through the engine (heat/rain plan, drop the priciest optional stop, Plan B swap, add masks to packing). Dismiss or mute a category. |
| **Freshness labels** | Everywhere live data appears | Every figure is marked Live, Cached or Simulated, with its source and time. |
| **Place photos** | Timeline, assistant cards, Guide, Trip mode | Wikipedia thumbnails with a link to the source page; places without a licensed photo show none. |
| **City brief** | 🧭 Guide | Wikivoyage excerpts (Understand, Get in, Get around, Eat, Buy, Stay safe) under CC BY-SA, with our own offline notes as fallback; helplines (112, 108, 1800-11-1363, 139, 1091). |
| **Booking hand-offs** | Timeline, Wallet, Trip mode, Guide | Directions (Google Maps), Uber / Rapido for the next ride, IRCTC and NTES running status for trains, Booking.com prefilled with the stay, dates and party. No fake inventory. |
| **Voice** | Assistant, Group chat | Tap the mic to speak (Web Speech API), 🔊 to hear replies, and "remind me to … in N minutes" sets a reminder (toast + voice + notification). Trip mode has one-tap "remind me in 10 min". |
| **Packing list** | 🧳 Packing | Shared by the group (MongoDB, live over the WebSocket), with assignees and ticks. Suggestions come from the plan and forecast. |
| **Expenses & settle-up** | 💸 Expenses | "I paid the package" splits the receipt across members; log extras with who paid and who shares; balances and the fewest transfers to settle; spending by day vs plan. |
| **Installable & offline** | Browser "Install app" | Web manifest + service worker cache the app shell and seen map tiles (API calls always go to the network). |

The `frontend-only` branch has the same screens with everything in the browser (localStorage + IndexedDB, live sync between tabs). Both branches produce identical plans (126 scenarios checked).

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
| GET / POST / PUT | `/api/users`, `/api/users/{id}/prefs`, `/api/users/{id}/trips` | Demo identities, preferences, a user's trips |
| POST | `/api/trips/{id}/pin`, `/prefs`, `/mode` | Add a stop, apply preferences, trip mode on/off |
| POST / DELETE | `/api/trips/{id}/members`, `/api/join` | Add/remove members, join by invite code |
| GET / POST | `/api/trips/{id}/messages`, `/polls`, `/messages/{mid}/vote` | Group chat, polls (swap polls apply themselves) |
| POST | `/api/agent` | Trip assistant (plan, re-plan, places, ride options) |
| GET / POST / DELETE | `/api/trips/{id}/tickets`, `/memories`, `/api/files/{id}` | Wallet, memories, stored files |
| GET / PUT | `/api/trips/{id}/journal` | Journal entries (own + shared) |
| GET | `/api/trips/{id}/calendar.ics` | Live calendar subscription |
| GET / POST / PATCH / DELETE | `/api/trips/{id}/packing` | Shared packing list (add, tick, assign, remove) |
| GET / POST / DELETE | `/api/trips/{id}/expenses`, `/expenses/package` | Expenses; "I paid the package" |
| WS | `/api/ws` | Live update events for every open screen |

## 5-minute demo script

Open two browser windows side by side: window A as **Priya**, window B as **Rohit**.

1. **Problem (20 s)**: the "domino effect" card: 3 h late → hotel detour → City Palace closed → tickets wasted.
2. **Plan by chat (45 s)**: in A, type *"Family of 4, 2 days, ₹30k, we love history and food, no long walks for my parents"*. The plan card shows leave-home time, every stop and the all-in cost; Priya's saved veg preference is applied. *Create it*.
3. **Plan together (40 s)**: Group tab → add Rohit. In B, Rohit sees the trip appear. Create a Plan B swap poll; Rohit votes in B, Priya votes in A: the swap applies itself and both chats update live.
4. **Disrupt (50 s)**: Assistant: *"our train is 3 hours late"*. Banner: cloakroom drop, a flagship moved to Day 2, money saved. The group chat and the wallet (train ticket "running 180 min late") update on their own; the subscribed calendar follows.
5. **Trip mode (45 s)**: start Trip mode: now / next / leave-in countdown, the ticket you need, *Running late +30* re-plans, add a memory, share status to the group.
6. **Memories & journal (30 s)**: the memory shows on the wall; Journal → *Draft from my day* writes the day from the plan, the delay and the memory.
7. **Judge AI (30 s)**: static vs DelayProof, weight sliders, *Run simulation*: holdout accuracy climbs (≈69% → 81%) and ride-time error drops (≈7.0 → 3.1 min).

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
