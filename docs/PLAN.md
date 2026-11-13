# DelayProof: collaboration & companion features

Two branches present the same product in two ways:

| | `main` (full stack) | `frontend-only` |
|---|---|---|
| Engine | Python (`backend/app/engine`) | TypeScript (`frontend/src/engine`), identical output |
| Data | MongoDB Atlas | localStorage + IndexedDB (photos, tickets) |
| Live sync | WebSocket per trip | BroadcastChannel between browser tabs |
| Files | MongoDB `files` collection, served by the API | IndexedDB |
| Calendar | `.ics` download + live subscription feed | `.ics` download |
| AI agent | Offline rule brain on the server; LLM key slot in `backend/.env` | Offline rule brain in the browser; LLM key slot in Settings |

The screens (`frontend/src/components`) are the same on both branches. Only `src/api.ts` differs.

## Features

1. **AI trip assistant (chat).** "2 days in Jaipur with my parents, veg, ₹30k, no long walks" → asks only what it
   needs, shows place cards, travel-option comparisons and a full door-to-door plan preview, then creates the trip.
   Inside a trip it answers "what if my train is 2h late", "skip Jal Mahal", "add Albert Hall", "how do I get from
   Amber Fort to City Palace", "show day 2", "budget". Every answer runs through the planning engine, so plans are
   always feasible. The brain is offline rules today; an LLM brain plugs into the same tool layer via the key slot.
2. **Preferences.** Interests, pace, diet (any / veg / Jain), mobility (avoid stairs and long walks, cab on hills),
   avoid midday heat, day start/end, budget, travellers. Saved per user and applied to a trip (re-plans it).
3. **Sharing & members.** Add a friend directly, or share an invite code / link. Members see everything; receipt is
   split per member. Snapshot link imports a copy on another device (frontend-only).
4. **Group chat.** Per-trip thread. Re-plans post themselves ("Train 3h late → Hawa Mahal moved to Day 2").
   Polls, including "Swap X for its Plan B?" which applies itself on a majority yes. `@ai` answers in the thread.
5. **Ticket wallet.** Auto tickets from the package (train PNR, hotel voucher, entry tickets with QR) with live
   status, plus uploaded PDFs/photos attached to a stop.
6. **Memories.** Photo + caption pinned to a stop, shown on a memory wall and in the journal.
7. **Journal.** One entry per day, auto-drafted from the day's plan, changes and memories; mood; private or shared.
8. **Calendar.** Month and day views; `.ics` export; live subscription URL on the full stack.
9. **Trip mode.** One-screen companion for the day: now / next / leave-in countdown, the ticket you need, Running
   late (re-plans), Done, Skip, Plan B, Add memory, Message group, location check.

## Demo identity

One-click demo users (Priya, Rohit, Ananya, Kabir), remembered per browser tab. Two windows = two friends on the
same trip, chatting and voting live.
