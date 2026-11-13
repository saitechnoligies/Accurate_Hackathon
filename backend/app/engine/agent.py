"""Offline "rule brain" for the trip assistant (Python twin of frontend agent.ts on the frontend-only branch).

It understands trip requests with keyword and pattern rules, fills the details it needs, and does all real work
through the planning engine (tools), so every answer is feasible. An LLM brain can replace the intent rules with
model tool calls while keeping the same tools and cards (see llm.py).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from ..data.jaipur import CITY, MODES, PERSONAS
from .geo import travel


@dataclass
class Tools:
    catalog: dict
    trip: dict | None
    prefs: dict
    preview: Callable[[dict], tuple[dict, dict]]
    create_trip: Callable[[dict, str], Awaitable[dict]]
    disrupt: Callable[[dict, str], Awaitable[dict]]
    skip: Callable[[str], Awaitable[dict]]
    pin: Callable[[str], Awaitable[dict]]
    swap: Callable[[str], Awaitable[dict]]
    reset: Callable[[], Awaitable[dict]]


def rupee(n: float) -> str:
    n = round(n)
    s = str(abs(n))
    if len(s) > 3:  # Indian grouping
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return f"{'-' if n < 0 else ''}₹{s}"


INTEREST_WORDS = [
    (r"histor|heritage|\bforts?\b|palace|monument", "history"),
    (r"food|eat|foodie|street food|thali|cuisine", "food"),
    (r"photo|instagram|sunset|sunrise|golden hour|camera", "photography"),
    (r"nature|garden|lake|green|hike|outdoor", "nature"),
    (r"shop|market|bazaar|souvenir", "shopping"),
    (r"cultur|museum|folk|tradition", "culture"),
    (r"\bart\b|arts|craft|gallery", "art"),
    (r"temple|spiritual|pray|religio", "spiritual"),
    (r"science|astronom|observatory", "science"),
]

TRIP_SUGGESTIONS = ["What if my train is 2 hours late?", "Show photography spots",
                    "How do I get from Amber Fort to City Palace?", "Show day 2", "What's my budget?"]
NEW_SUGGESTIONS = ["Family of 4, 2 days, ₹30k, we love history and food",
                   "Solo photographer, 3 days, sunsets, avoid the afternoon heat",
                   "Student trip, ₹6,000, street food, as packed as possible",
                   "Veg trip with my elderly parents, no long walks"]


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower().replace("’", "'")).strip()


def has(pat: str, t: str) -> bool:
    return re.search(pat, t) is not None


def aliases(a: dict) -> list[str]:
    base = norm(re.sub(r"\(.*?\)", "", a["name"]))
    out = [base, a["id"].replace("_", " ")]
    first = base.split(" ")[0]
    if len(first) > 3 and first not in ("jaipur", "city"):
        out.append(first)
    extra = {"galtaji": "monkey temple", "jkk": "jawahar", "lmb": "laxmi", "amber_cafe": "dhaba"}
    if a["id"] in extra:
        out.append(extra[a["id"]])
    return list(dict.fromkeys(out))


def find_places(text: str, cat: dict) -> list[dict]:
    t = norm(text)
    hits = []
    for a in cat["attractions"]:
        best = None
        for al in aliases(a):
            at = t.find(al)
            if at >= 0 and (best is None or len(al) > best[1]):
                best = (at, len(al))
        if best:
            hits.append({"a": a, "at": best[0], "len": best[1]})
    kept = [h for h in hits if not any(o is not h and o["len"] > h["len"] and o["at"] <= h["at"]
                                       and h["at"] + h["len"] <= o["at"] + o["len"] for o in hits)]
    return [h["a"] for h in sorted(kept, key=lambda h: h["at"])]


def parse_duration(t: str) -> int | None:
    h = re.search(r"(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b", t)
    m = re.search(r"(\d+)\s*(?:m|min|mins|minutes)\b", t)
    if not h and not m:
        if "half an hour" in t:
            return 30
        if has(r"an hour|one hour", t):
            return 60
        return None
    return round((float(h.group(1)) * 60 if h else 0) + (int(m.group(1)) if m else 0))


def parse_budget(t: str) -> int | None:
    m = (re.search(r"(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(k|thousand|lakh|l)?\b", t)
         or re.search(r"\b([\d,]+(?:\.\d+)?)\s*(k|thousand|lakh)\b", t)
         or re.search(r"budget\D{0,12}([\d,]{4,})", t))
    if not m:
        return None
    n = float(m.group(1).replace(",", ""))
    unit = m.group(2) if m.lastindex and m.lastindex >= 2 else None
    if unit in ("k", "thousand"):
        n *= 1000
    if unit in ("lakh", "l"):
        n *= 100000
    return round(n) if n >= 1000 else None


def parse_slots(text: str) -> dict:
    t = norm(text)
    s: dict[str, Any] = {}
    if has(r"\bfamily|kids|children|parents|wife|husband|my mom|my dad", t):
        s["persona_id"] = "family"
    elif has(r"student|college|backpack|hostel|cheap|low budget|tight budget", t):
        s["persona_id"] = "student"
    elif has(r"\bsolo\b|alone|by myself|photograph", t):
        s["persona_id"] = "solo"

    trav = (re.search(r"(\d+)\s*(?:people|persons|of us|adults|travell?ers|pax|friends|members)", t)
            or re.search(r"family of (\d+)|we are (\d+)|group of (\d+)", t))
    if trav:
        s["travelers"] = int(next(g for g in trav.groups() if g))
    elif has(r"\bcouple\b|\bwife\b|\bhusband\b", t):
        s["travelers"] = 2
    elif has(r"\bsolo\b|alone|by myself", t):
        s["travelers"] = 1

    days = re.search(r"(\d)\s*-?\s*(?:days?|d)\b", t)
    nights = re.search(r"(\d)\s*nights?", t)
    if days:
        s["days"] = int(days.group(1))
    elif nights:
        s["days"] = int(nights.group(1)) + 1
    elif "weekend" in t:
        s["days"] = 2
    if s.get("days"):
        s["days"] = max(2, min(3, s["days"]))

    b = parse_budget(t)
    if b:
        s["budget"] = b
    interests = list(dict.fromkeys(tag for pat, tag in INTEREST_WORDS if has(pat, t)))
    if interests:
        s["interests"] = interests

    if has(r"relax|slow|chill|easy pace|no rush|leisure", t):
        s["pace"] = "relaxed"
    elif has(r"packed|as much as possible|maximi|fast pace|cover everything", t):
        s["pace"] = "packed"
    elif has(r"balanced|moderate", t):
        s["pace"] = "balanced"

    if has(r"\bjain\b", t):
        s["diet"] = "jain"
    elif has(r"non[- ]?veg", t):
        s["diet"] = "any"
    elif has(r"\bveg\b|vegetarian|pure veg", t):
        s["diet"] = "veg"
    if has(r"elderly|senior|grand ?parent|wheelchair|knee|no stairs|less walking|no long walks?|can'?t walk|mobility", t):
        s["mobility"] = "limited"
    if has(r"avoid (the )?(afternoon )?heat|hate (the )?heat|too hot|no midday|afternoon heat", t):
        s["avoid_heat"] = True
    return s


def infer_persona(s: dict) -> str:
    if s.get("persona_id"):
        return s["persona_id"]
    if (s.get("travelers") or 1) >= 3:
        return "family"
    if s.get("budget") and s["budget"] < 9000:
        return "student"
    return "solo"


def place_item(a: dict, trip: dict | None) -> dict:
    in_trip = bool(trip) and any(i.get("attraction_id") == a["id"] for d in trip["days"] for i in d["items"])
    return {"id": a["id"], "name": a["name"], "blurb": a["blurb"], "fee": a["fee"], "open": a["open"],
            "close": a["close"], "tags": a["tags"], "indoor": a["indoor"], "flagship": a["flagship"],
            "stairs": a.get("stairs"), "in_trip": in_trip}


def stops_of(items: list[dict]) -> list[dict]:
    return [{"time": i["start"], "name": i["title"], "kind": i["type"],
             "status": i["status"] if i["status"] != "normal" else None}
            for i in items if i["type"] in ("visit", "meal", "train", "cloakroom")]


def plan_card(view: dict, profile: dict, create: dict | None, title: str) -> dict:
    persona = next(p for p in PERSONAS if p["id"] == profile["persona_id"])
    trav = profile["travelers"]
    summary = [f"{persona['emoji']} {profile['persona_label']} · {trav} traveller{'s' if trav > 1 else ''} · {profile['days']} days",
               f"Interests: {', '.join(profile['interests'])} · {profile['pace']} pace"]
    extra = [x for x in [
        ("Jain" if profile.get("diet") == "jain" else "Veg") + " meals only" if profile.get("diet") not in (None, "any") else "",
        "No stair-heavy places, cabs on hills" if profile.get("mobility") == "limited" else "",
        "Indoors 12:00–16:00" if profile.get("avoid_heat") else "",
    ] if x]
    if extra:
        summary.append(" · ".join(extra))
    days = view["days"]
    return {"type": "plan", "title": title, "summary": summary, "total": view["receipt"]["total"],
            "budget": view["receipt"]["budget"], "create": create,
            "days": [{"day": d["day"], "date": d["date"],
                      "stops": [{"time": it["start"], "name": it["title"], "kind": it["type"]}
                                for it in d["items"] if it["type"] in ("visit", "meal")],
                      "leave": d["items"][0]["start"] if i == 0 else None,
                      "home": d["items"][-1]["start"] if i == len(days) - 1 else None}
                     for i, d in enumerate(days)]}


def place_loc(name: str, cat: dict, trip: dict | None) -> dict | None:
    t = norm(name)
    if has(r"station|junction|railway", t):
        return dict(CITY["station"])
    if has(r"hotel|stay|hostel|haveli|room", t) and trip:
        s = next(x for x in cat["stays"] if x["id"] == trip["profile"]["stay_id"])
        return {"name": s["name"], "lat": s["lat"], "lng": s["lng"], "zone": s["zone"]}
    found = find_places(name, cat)
    if not found:
        return None
    a = found[0]
    return {"name": a["name"], "lat": a["lat"], "lng": a["lng"], "zone": a["zone"]}


def options_card(from_name: str, to_name: str, tools: Tools) -> dict | str:
    cat = tools.catalog
    a, b = place_loc(from_name, cat, tools.trip), place_loc(to_name, cat, tools.trip)
    if not a or not b:
        missing = from_name if not a else to_name
        return f"I couldn't find \"{missing}\" in Jaipur. Try a place name like Amber Fort, City Palace or the station."
    trav = tools.trip["profile"]["travelers"] if tools.trip else 1
    opts = []
    for m, spec in MODES.items():
        leg = travel(a, b, m, trav, cat["corridors"])
        if not leg:
            continue
        note = " · ".join(x for x in ["hill climb +35%" if leg["hill"] else "", "Old City traffic" if leg["congested"] else "",
                                      f"+{round(leg['buffer'])} min learned delay" if leg["buffer"] else "",
                                      "AC" if spec["ac"] else ""] if x)
        opts.append({"mode": m, "label": spec["label"], "minutes": leg["minutes"], "cost": leg["cost"], "note": note,
                     "best": False})
    opts.sort(key=lambda o: o["minutes"])
    if not opts:
        return "Those two places are right next to each other: just walk."
    opts[0]["best"] = True
    return {"type": "options", "title": f"{a['name']} → {b['name']}", "from": a["name"], "to": b["name"], "options": opts}


def wants_places(t: str) -> bool:
    return has(r"(show|suggest|recommend|what|which|list|find|any|good|best).{0,40}(places|spots|things|sights|attractions|to do|to see|to eat|restaurants|food|cafes?)", t) \
        or has(r"^(places|spots|sights)\b", t)


def places_card(t: str, tools: Tools) -> dict:
    cat = tools.catalog
    tags = [tag for pat, tag in INTEREST_WORDS if has(pat, t)]
    want_meal = has(r"eat|food|restaurant|lunch|dinner|cafe|thali", t)
    indoor = has(r"indoor|rain|cool|ac\b|heat", t)
    free = has(r"free|no (entry )?fee|cheap", t)
    interests = tools.trip["profile"]["interests"] if tools.trip else tools.prefs.get("interests", [])
    limited = (tools.trip["profile"].get("mobility") if tools.trip else tools.prefs.get("mobility")) == "limited"
    scored = []
    for a in cat["attractions"]:
        if want_meal:
            if a["kind"] != "meal":
                continue
        elif not (a["kind"] == "visit" or ("food" in tags and a["kind"] == "meal")):
            continue
        if tags and not want_meal and not any(x in tags for x in a["tags"]):
            continue
        if indoor and not a["indoor"]:
            continue
        if free and a["fee"] != 0:
            continue
        if limited and a.get("stairs"):
            continue
        ref = tags or interests
        scored.append((a, (2 if a["flagship"] else 0) + sum(1 for x in a["tags"] if x in ref) - a["fee"] / 1000))
    scored.sort(key=lambda x: -x[1])
    items = [place_item(a, tools.trip) for a, _ in scored[:6]]
    what = "Places to eat" if want_meal else (" & ".join(x.capitalize() for x in tags) + " spots" if tags else "Top picks for you")
    return {"type": "places", "title": f"{what}{' (indoor)' if indoor else ''}{' (free)' if free else ''}", "items": items}


def banner_card(trip: dict) -> dict:
    return {"type": "banner", "title": trip["banner"]["headline"], "lines": trip["banner"]["lines"][:4]}


def reply(r: str, state: dict, **extra) -> dict:
    return {"reply": r, "cards": [], "suggestions": [], "state": state, **extra}


ROUTE = r"(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+?)(?:\?|$)"


async def run_agent(text: str, state: dict, tools: Tools) -> dict:  # noqa: C901 - one rule table
    t = norm(text)
    cat = tools.catalog
    trip = tools.trip
    sug = TRIP_SUGGESTIONS if trip else NEW_SUGGESTIONS

    if not t or has(r"^(hi|hello|hey|namaste|help|what can you do)\b", t):
        return reply(
            "I'm your trip assistant. I can re-plan around delays and weather, add or skip places, compare ways to get around, and show your day or budget. Everything goes through the planner, so it always fits opening hours and your budget."
            if trip else
            "Tell me about your trip in one line: who's going, how many days, budget, what you love, and anything to avoid. I'll build the whole door-to-door plan.",
            state, suggestions=sug)

    if trip:
        if has(r"\b(reset|start over|undo all|original plan)\b", t):
            return reply("Back to the original package.", state, trip=await tools.reset(), suggestions=sug)

        is_return = has(r"return|going home|back home|way back", t)
        if has(r"(train|shatabdi|double decker).{0,40}(late|delay)|(late|delay).{0,30}train", t) or ("train" in t and "on time" in t):
            mins = 0 if has(r"on time|not late|no delay", t) else parse_duration(t)
            if mins is None:
                return reply('How late is the train? For example "train 2 hours late".', state,
                             suggestions=["Train is 1 hour late", "Train is 3 hours late"])
            patch = {"return_delay_min": min(mins, 300)} if is_return else {"train_delay_min": min(mins, 600)}
            nt = await tools.disrupt(patch, f"{'return ' if is_return else ''}train {mins} min late")
            return reply(f"Done. {nt['banner']['headline']}." if mins else "Train set back to on time.", state, trip=nt,
                         cards=[banner_card(nt)] if mins else [],
                         suggestions=["Show day 1", "Reset the plan", "What's my budget?"])
        if has(r"\b(rains?|raining|rainy|monsoon|storms?|showers?)\b", t) and "no rain" not in t:
            nt = await tools.disrupt({"weather": "rain"}, "rain")
            return reply(f"Rain plan on. {nt['banner']['headline']}.", state, trip=nt, cards=[banner_card(nt)],
                         suggestions=["Weather is clear now", "Show indoor places"])
        if has(r"\b(heat|hot|heatwave|42|scorching|sunny|summer)\b", t) and not has(r"avoid|photo", t):
            nt = await tools.disrupt({"weather": "heat"}, "42°C heat")
            return reply(f"Heat plan on. {nt['banner']['headline']}.", state, trip=nt, cards=[banner_card(nt)],
                         suggestions=["Weather is clear now", "Show indoor places"])
        if has(r"weather (is )?(clear|fine|ok|good)|no rain|cooler now", t):
            nt = await tools.disrupt({"weather": "clear"}, "clear weather")
            return reply("Weather back to clear; the full plan is restored.", state, trip=nt, suggestions=sug)
        if has(r"crowd|queue|rush|packed at", t):
            ps = [a for a in find_places(t, cat) if a["kind"] == "visit"]
            if not ps:
                return reply('Where is the crowd? For example "huge crowd at Amber Fort".', state)
            crowd = list(dict.fromkeys([*trip["disruptions"]["crowd"], *[p["id"] for p in ps]]))
            names = ", ".join(p["name"] for p in ps)
            nt = await tools.disrupt({"crowd": crowd}, f"crowd at {names}")
            return reply(f"Noted the crowd at {names}. {nt['banner']['headline']}.", state, trip=nt, cards=[banner_card(nt)])
        late_day = re.search(r"day (\d)", t)
        if has(r"(start|leave|wake|running|we're|we are).{0,20}late", t) and "train" not in t:
            mins = parse_duration(t) or 60
            day = int(late_day.group(1)) if late_day else max(2, min(trip["profile"]["days"], 2))
            if day == 1:
                nt = await tools.disrupt({"train_delay_min": trip["disruptions"]["train_delay_min"] + mins}, f"running {mins} min late")
                return reply(f"Shifted Day 1 by {mins} min. {nt['banner']['headline']}.", state, trip=nt, cards=[banner_card(nt)])
            late = {**trip["disruptions"]["late_start"], str(day): mins}
            nt = await tools.disrupt({"late_start": late}, f"Day {day} starting {mins} min late")
            return reply(f"Day {day} now starts {mins} min late. {nt['banner']['headline']}.", state, trip=nt, cards=[banner_card(nt)])

        route = re.search(ROUTE, t)
        if route and has(r"(how|get|go|reach|travel|ride|cab|auto|route|way)", t):
            c = options_card(route.group(1), route.group(2), tools)
            if isinstance(c, str):
                return reply(c, state)
            return reply(f"Here are your options. Fastest is {c['options'][0]['label']}.", state, cards=[c])

        if has(r"\b(skip|remove|drop|cancel|don'?t want|not interested in)\b", t):
            ps = [a for a in find_places(t, cat) if a["kind"] == "visit"]
            if not ps:
                return reply('Which place should I skip? For example "skip Jal Mahal".', state)
            nt = trip
            for p in ps:
                nt = await tools.skip(p["id"])
            return reply(f"Skipped {', '.join(p['name'] for p in ps)} and re-planned the day around it.", state, trip=nt,
                         suggestions=["Show day 1", "Undo: reset the plan"])
        if has(r"\b(swap|replace|plan b|alternative)\b", t):
            found = find_places(t, cat)
            if not found:
                return reply('Which stop do you want to swap? For example "swap City Palace".', state)
            try:
                nt = await tools.swap(found[0]["id"])
                return reply(nt.get("message") or f"Swapped {found[0]['name']} for its Plan B.", state, trip=nt)
            except ValueError as e:
                return reply(str(e), state)
        if has(r"\b(add|include|visit|see|go to|put)\b", t) and find_places(t, cat) and not wants_places(t):
            ps = [a for a in find_places(t, cat) if a["kind"] == "visit"]
            if ps:
                nt = trip
                for p in ps:
                    nt = await tools.pin(p["id"])
                placed = []
                for p in ps:
                    it = next((i for d in nt["days"] for i in d["items"] if i.get("attraction_id") == p["id"]), None)
                    placed.append(f"{p['name']} on Day {it['day']} at {it['start']}" if it
                                  else f"{p['name']} (no feasible slot: closed or over budget at the free times)")
                return reply(f"Added {'; '.join(placed)}.", state, trip=nt, suggestions=["Show day 1", "Show day 2"])
        if has(r"budget|cost|spend|money|receipt|expens|how much", t):
            r = trip["receipt"]
            left = f"{rupee(r['remaining'])} left" if r["remaining"] >= 0 else f"{rupee(-r['remaining'])} over"
            return reply(f"You're at {rupee(r['total'])} of {rupee(r['budget'])}: {left}.", state, cards=[{
                "type": "budget", "title": "Trip receipt",
                "lines": [{"label": ln["label"], "amount": ln["amount"]} for ln in r["lines"] if ln["amount"]],
                "total": r["total"], "budget": r["budget"]}])
        day_q = re.search(r"day\s*(\d)|(today|tomorrow|first day|last day)", t)
        if day_q and has(r"(show|what|plan|itinerary|schedule|day)", t) and not wants_places(t):
            n = int(day_q.group(1)) if day_q.group(1) else 1
            if day_q.group(2) == "tomorrow":
                n = 2
            if day_q.group(2) == "last day":
                n = trip["profile"]["days"]
            d = next((x for x in trip["days"] if x["day"] == n), None)
            if not d:
                return reply(f"Your trip has {len(trip['days'])} days.", state)
            return reply(f"Day {n}: {d['title']}.", state, cards=[{"type": "day", "title": f"Day {n} · {d['title']}", "stops": stops_of(d["items"])}])
        if has(r"itinerary|whole plan|full plan|my plan|schedule", t):
            return reply("Here is your full plan.", state, cards=[
                {"type": "day", "title": f"Day {d['day']} · {d['title']}", "stops": stops_of(d["items"])} for d in trip["days"]])
        if wants_places(t) or any(has(p, t) for p, _ in INTEREST_WORDS):
            c = places_card(t, tools)
            return reply('Here are some picks. Say "add <place>" to put one in the plan.' if c["items"] else "Nothing matches that filter.",
                         state, cards=[c])

    if not trip and wants_places(t):
        return reply("Here are some picks in Jaipur. Tell me who is going and I will plan the full trip.", state,
                     cards=[places_card(t, tools)], suggestions=sug)
    if not trip:
        route = re.search(ROUTE, t)
        if route:
            c = options_card(route.group(1), route.group(2), tools)
            if not isinstance(c, str):
                return reply("Options for that ride:", state, cards=[c])

    parsed = parse_slots(t)
    confirm = has(r"\b(yes|book it|create( it| this)?|looks good|go ahead|confirm|let'?s do it|perfect|save it)\b", t)
    prev = state.get("slots") or {}
    slots = {**prev, **parsed}

    if confirm and prev.get("persona_id"):
        c = build_create(prev, tools.prefs)
        created = await tools.create_trip(c, title_for(c))
        return reply(f"Done! \"{created['title']}\" is saved with the full door-to-door plan. Leave home at {created['days'][0]['items'][0]['start']}.",
                     {"slots": {}}, created_trip_id=created["trip_id"], trip=created)
    if not slots:
        return reply("I didn't catch that. Try one of these:" if trip else
                     "Who's travelling? Tell me something like \"family of 4, 2 days, ₹30k, love history\".", state, suggestions=sug)

    c = build_create(slots, tools.prefs)
    profile, view = tools.preview(c)
    assumed = []
    if not slots.get("days"):
        assumed.append(f"{profile['days']} days")
    if not slots.get("budget"):
        assumed.append(f"a {rupee(profile['budget'])} budget")
    if not slots.get("travelers"):
        tr = profile["travelers"]
        assumed.append(f"{tr} traveller{'s' if tr > 1 else ''}")
    from_prefs = []
    if "diet" not in parsed and c.get("diet") not in (None, "any") and "diet" not in prev:
        from_prefs.append(f"{c['diet']} meals")
    if "mobility" not in parsed and c.get("mobility") == "limited" and "mobility" not in prev:
        from_prefs.append("limited mobility")
    days = view["days"]
    lines = [
        f"Here's your door-to-door plan: leave home {days[0]['items'][0]['start']}, back home {days[-1]['items'][-1]['start']}, {rupee(view['receipt']['total'])} all-in.",
        f"I assumed {', '.join(assumed)}." if assumed else "",
        f"Using your saved preferences: {', '.join(from_prefs)}." if from_prefs else "",
        (f"That's {rupee(-view['receipt']['remaining'])} over budget; say \"budget 20k\" or \"make it 2 days\" to adjust."
         if view["receipt"]["remaining"] < 0 else 'Say "create it" to save, or tell me what to change.'),
    ]
    return reply(" ".join(x for x in lines if x), {"slots": slots}, cards=[plan_card(view, profile, c, title_for(c))],
                 suggestions=["Create it", "Make it 3 days", "More food stops", "Relaxed pace"])


def build_create(s: dict, prefs: dict) -> dict:
    return {
        "persona_id": infer_persona(s),
        "travelers": s.get("travelers"),
        "days": s.get("days"),
        "budget": s.get("budget"),
        "interests": s.get("interests"),
        "pace": s.get("pace"),
        "diet": s.get("diet") or prefs.get("diet", "any"),
        "mobility": s.get("mobility") or prefs.get("mobility", "normal"),
        "avoid_heat": s["avoid_heat"] if s.get("avoid_heat") is not None else bool(prefs.get("avoid_heat")),
    }


def title_for(c: dict) -> str:
    p = next(x for x in PERSONAS if x["id"] == c["persona_id"])
    who = {"family": "Family", "student": "Backpacker"}.get(c["persona_id"], "Solo")
    return f"{who} Jaipur {c.get('days') or p['days']}-day trip"
