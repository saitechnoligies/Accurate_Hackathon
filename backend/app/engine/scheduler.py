"""Door-to-door trip planner.

The plan is a single timeline per day. Fixed anchors (trains, hotel check-in /
checkout, closing times, the return-train deadline) never move; flexible stops are
re-arranged greedily around them. Every re-plan is "keep the anchors, rearrange the
flexible stops", which keeps the engine deterministic and explainable.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

from ..data.jaipur import CITY, MODES, ORIGIN
from .geo import m2t, round5, t2m, travel

PACE = {
    "relaxed": {"dur": 1.15, "max_visits": 4},
    "balanced": {"dur": 1.0, "max_visits": 5},
    "packed": {"dur": 0.9, "max_visits": 7},
}
STATION_BUFFER = 30          # be at the station this many minutes before departure
CHECKIN_MIN = 20             # bag drop & check-in
CLOAKROOM_TRIGGER = 90       # train delay (min) after which bags go to the station cloakroom
BAG_COLLECT_MIN = 10
LUNCH = (t2m("12:30"), t2m("14:30"))
HEAT = (t2m("12:00"), t2m("16:00"))
CROWD_SURGE_EXTRA = 60       # extra queue when a crowd surge is reported
PEAK_EXTRA = 15              # normal queue at crowd peak for flagship spots
MUST_SEE_BONUS = 1.5
PIN_BONUS = 2.5
SCORE_THRESHOLD = 0.15
METRO_LAST = t2m("22:45")

STATION = {**CITY["station"]}
ORIGIN_STATION = {**ORIGIN["station"], "zone": "delhi"}


def normalize_disruptions(d: dict | None) -> dict:
    d = dict(d or {})
    return {
        "train_delay_min": int(d.get("train_delay_min") or 0),
        "return_delay_min": int(d.get("return_delay_min") or 0),
        "weather": d.get("weather") or "clear",          # clear | heat | rain
        "crowd": list(d.get("crowd") or []),               # attraction ids with a crowd surge
        "late_start": {str(k): int(v) for k, v in (d.get("late_start") or {}).items() if int(v)},  # day -> minutes
        "skipped": list(d.get("skipped") or []),           # attractions the traveller skipped
        "swaps": dict(d.get("swaps") or {}),               # original id -> plan B id
        "swap_days": {k: int(v) for k, v in (d.get("swap_days") or {}).items()},  # plan B id -> day it replaces
    }


def overlaps(a0, a1, b0, b1) -> bool:
    return a0 < b1 and b0 < a1


class Planner:
    def __init__(self, catalog: dict, profile: dict, disruptions: dict | None = None):
        self.cat = catalog
        self.p = profile
        self.d = normalize_disruptions(disruptions)
        self.w = catalog["weights"]
        self.aff = catalog.get("tag_affinity", {}).get(profile["persona_id"], {})
        self.attr = {a["id"]: a for a in catalog["attractions"]}
        self.stay = next(s for s in catalog["stays"] if s["id"] == profile["stay_id"])
        self.trains = {t["id"]: t for t in catalog["trains"]}
        self.corr = catalog["corridors"]
        self.pace = PACE[profile["pace"]]
        self.trav = int(profile["travelers"])
        self.n = 0
        self.visited: set[str] = set()
        self.excluded = set(self.d["skipped"]) | set(self.d["swaps"].keys())
        self.pinned = set(self.d["swaps"].values())
        self.ledger = {k: 0 for k in ["train", "stay", "home_transfers", "local_rides", "tickets", "meals", "extras"]}
        self.events: list[dict] = []   # engine decisions used for the explanation banner
        self.hotel = {"name": self.stay["name"], "lat": self.stay["lat"], "lng": self.stay["lng"], "zone": self.stay["zone"]}
        self.used_cloakroom = False
        self.cur_day = 1

    # ------------------------------------------------------------------ helpers
    def item(self, day: int, type_: str, title: str, start: float, end: float, **kw) -> dict:
        self.n += 1
        return {"id": f"d{day}-{self.n}", "day": day, "type": type_, "title": title,
                "start_min": round(start), "end_min": round(end), "start": m2t(start), "end": m2t(end),
                "status": "normal", "notes": [], **kw}

    def place_of(self, a: dict) -> dict:
        return {"name": a["name"], "lat": a["lat"], "lng": a["lng"], "zone": a["zone"], "id": a["id"]}

    def modes_at(self, t: float) -> list[str]:
        modes = [m for m in self.p["modes"] if m != "walk"]
        if self.d["weather"] in ("heat", "rain") and "cab" in modes and (self.d["weather"] == "rain" or HEAT[0] <= t <= HEAT[1]):
            modes = ["cab"] + [m for m in modes if m != "cab"]
        return modes

    def legs(self, a: dict, b: dict, t: float) -> list[dict]:
        out = []
        if "walk" in self.p["modes"] and not (self.d["weather"] == "heat" and HEAT[0] <= t <= HEAT[1]) \
                and self.d["weather"] != "rain":
            w = travel(a, b, "walk", self.trav, self.corr)
            if w:
                return [w]
        for m in self.modes_at(t):
            leg = travel(a, b, m, self.trav, self.corr)
            if leg:
                out.append(leg)
        if not out:  # very short hop: walk regardless
            w = travel(a, b, "walk", self.trav, self.corr) or {
                "mode": "walk", "km": 0.3, "minutes": 5, "base_minutes": 5, "buffer": 0, "cost": 0, "hill": False,
                "congested": False}
            out = [w]
        return out

    def mins(self, a: dict, b: dict, t: float = 0) -> int:
        return self.legs(a, b, t)[0]["minutes"]

    def transfer(self, day: int, a: dict, b: dict, t: float, leg: dict, upgraded_from: dict | None = None) -> dict:
        it = self.item(day, "transfer", f"{MODES[leg['mode']]['label']} to {b['name']}", t, t + leg["minutes"],
                       mode=leg["mode"], cost=leg["cost"], km=leg["km"], buffer=leg["buffer"],
                       frm={k: a.get(k) for k in ("name", "lat", "lng", "zone")},
                       to={k: b.get(k) for k in ("name", "lat", "lng", "zone")})
        if leg["hill"]:
            it["notes"].append("Hill climb: winding ghat road (+35% time)")
        if leg["congested"]:
            it["notes"].append("Old City lanes: congestion factor applied")
        if leg["buffer"]:
            it["notes"].append(f"Learned corridor buffer +{leg['buffer']:.0f} min")
        if upgraded_from:
            saved = upgraded_from["minutes"] - leg["minutes"]
            extra = leg["cost"] - upgraded_from["cost"]
            it["status"] = "upgraded"
            it["notes"].append(f"Upgraded from {MODES[upgraded_from['mode']]['label']}: saves {saved} min for +₹{extra}")
            self.events.append({"type": "upgrade", "to": b["name"], "from_mode": upgraded_from["mode"],
                                "to_mode": leg["mode"], "saved_min": saved, "extra_cost": extra})
        default_first = next((m for m in self.p["modes"] if m != "walk"), None)
        if self.d["weather"] in ("heat", "rain") and leg["mode"] == "cab" and default_first != "cab":
            it["notes"].append("AC cab chosen for the " + ("rain" if self.d["weather"] == "rain" else "afternoon heat"))
        self.ledger["local_rides"] += leg["cost"]
        return it

    # ------------------------------------------------------------------ budget
    def stay_cost(self) -> int:
        nights = max(0, self.p["days"] - 1)
        if self.stay["per"] == "bed":
            return self.stay["price_per_night"] * self.trav * nights
        return self.stay["price_per_night"] * math.ceil(self.trav / 4) * nights

    def train_fare(self, train_id: str) -> int:
        return self.trains[train_id]["classes"][self.p["train_class"]] * self.trav

    def home_leg(self, t: float) -> dict:
        home = self.p["home"]
        km = home["to_station_km"]
        budget_traveller = "bus" in self.p["modes"]
        if budget_traveller and t <= METRO_LAST:
            return {"mode": "metro", "label": "Delhi Metro", "minutes": round(km / 30 * 60 + 15), "cost": 40 * self.trav,
                    "km": km}
        vehicles = math.ceil(self.trav / 4)
        return {"mode": "cab", "label": "Cab", "minutes": round(km / 24 * 60 + 10),
                "cost": round5(vehicles * (80 + 16 * km)), "km": km}

    def local_left(self) -> float:
        fixed = self.fixed_estimate
        local = self.ledger["local_rides"] + self.ledger["tickets"] + self.ledger["meals"] + self.ledger["extras"]
        reserve = 250 * self.p["days"]
        return self.p["budget"] - fixed - local - reserve

    # ------------------------------------------------------------------ scoring
    def interest(self, a: dict) -> float:
        m = len(set(a["tags"]) & set(self.p["interests"]))
        return 0.0 if m == 0 else min(1.0, 0.6 + 0.2 * (m - 1))

    def affinity(self, a: dict) -> float:
        vals = [self.aff.get(t, 0.0) for t in a["tags"]]
        return sum(vals) / len(vals) if vals else 0.0

    def weather_ok(self, a: dict, start: float, end: float) -> bool:
        if a["indoor"]:
            return True
        if self.d["weather"] == "rain":
            return False
        if self.d["weather"] == "heat" and overlaps(start, end, *HEAT):
            return False
        return True

    def evaluate(self, a: dict, t: float, loc: dict, deadline, max_wait: int = 45) -> dict | None:
        o, c = t2m(a["open"]), t2m(a["close"])
        dur = a["duration"] * (self.pace["dur"] if a["kind"] == "visit" else 1)
        legs = self.legs(loc, self.place_of(a), t)
        for i, leg in enumerate(legs):
            arrive = t + leg["minutes"]
            start = max(arrive, o)
            wait = start - arrive
            if wait > max_wait:
                continue
            queue = 0
            if a["id"] in self.d["crowd"]:
                queue = CROWD_SURGE_EXTRA
            elif a["flagship"] and t2m(a["crowd_peak"][0]) <= start <= t2m(a["crowd_peak"][1]):
                queue = PEAK_EXTRA
            end = start + queue + dur
            if end > c or end > deadline(self.place_of(a)):
                continue
            if not self.weather_ok(a, start, end):
                return None
            cost = a["fee"] * self.trav + leg["cost"]
            if cost > self.local_left():
                continue
            per_day = max(800.0, (self.p["budget"] - self.fixed_estimate) / max(1, self.p["days"]))
            w = self.w
            if a["kind"] == "meal":
                score = -leg["minutes"] / 20 - w["budget"] * cost / (300 * self.trav) + self.affinity(a)
            else:
                score = (w["interest"] * self.interest(a)
                         + w["flagship"] * (1 if a["flagship"] else 0)
                         + (MUST_SEE_BONUS if a["flagship"] else 0)
                         + self.affinity(a)
                         - w["travel"] * leg["minutes"] / 60
                         - w["budget"] * cost / per_day
                         + w["urgency"] * (1 if c - t <= 180 else 0)
                         - w["crowd"] * queue / 60
                         - 0.3 * wait / 30
                         + (PIN_BONUS if a["id"] in self.pinned else 0)
                         + (0.6 if a["indoor"] and self.d["weather"] in ("heat", "rain") else 0))
            upgraded = i > 0 and leg["minutes"] < legs[0]["minutes"] and leg["cost"] > legs[0]["cost"]
            return {"a": a, "leg": leg, "upgraded_from": legs[0] if upgraded else None, "arrive": arrive,
                    "start": start, "end": end, "queue": queue, "cost": cost, "score": round(score, 3)}
        return None

    # ------------------------------------------------------------------ day filling
    def pool(self):
        days = self.d["swap_days"]
        return [a for a in self.cat["attractions"]
                if a["kind"] == "visit" and a["id"] not in self.visited and a["id"] not in self.excluded
                and days.get(a["id"], self.cur_day) == self.cur_day]

    def add_stop(self, day: int, items: list, c: dict, loc: dict):
        a = c["a"]
        items.append(self.transfer(day, loc, self.place_of(a), c["arrive"] - c["leg"]["minutes"], c["leg"],
                                   c["upgraded_from"]))
        kind = "meal" if a["kind"] == "meal" else "visit"
        it = self.item(day, kind, a["name"], c["start"], c["end"], attraction_id=a["id"], lat=a["lat"], lng=a["lng"],
                       zone=a["zone"], fee=a["fee"], cost=a["fee"] * self.trav, indoor=a["indoor"],
                       flagship=a["flagship"], tags=a["tags"], blurb=a["blurb"], open=a["open"], close=a["close"],
                       score=c["score"])
        if c["queue"]:
            it["notes"].append(("Crowd surge" if c["queue"] >= CROWD_SURGE_EXTRA else "Peak hour") +
                               f": +{c['queue']} min queue")
        if c["start"] > c["arrive"]:
            it["notes"].append(f"Opens {a['open']}: {round(c['start'] - c['arrive'])} min wait")
        if a["id"] in self.pinned:
            it["status"] = "rescued"
            it["notes"].append("Plan B swap you chose")
        items.append(it)
        if kind == "meal":
            self.ledger["meals"] += a["fee"] * self.trav
        else:
            self.ledger["tickets"] += a["fee"] * self.trav
            self.visited.add(a["id"])
        return c["end"], self.place_of(a)

    def fill_day(self, day: int, t: float, loc: dict, deadline, items: list):
        self.cur_day = day
        visits = 0
        had_lunch = t > LUNCH[1]
        while True:
            if not had_lunch and t >= LUNCH[0] - 30:
                had_lunch = True
                if t <= LUNCH[1]:
                    meals = [self.evaluate(a, t, loc, deadline) for a in self.cat["attractions"] if a["kind"] == "meal"]
                    meals = [m for m in meals if m and m["start"] <= LUNCH[1]]
                    if meals:
                        best = max(meals, key=lambda m: m["score"])
                        t, loc = self.add_stop(day, items, best, loc)
                        continue
            if visits >= self.pace["max_visits"]:
                break
            cands = [self.evaluate(a, t, loc, deadline) for a in self.pool()]
            cands = [c for c in cands if c]
            if not cands:
                break
            best = max(cands, key=lambda c: c["score"])
            relevant = best["a"]["flagship"] or self.interest(best["a"]) > 0 or best["a"]["id"] in self.pinned \
                or (best["a"]["indoor"] and self.d["weather"] in ("heat", "rain"))
            if best["score"] < SCORE_THRESHOLD and not relevant:
                break
            t, loc = self.add_stop(day, items, best, loc)
            visits += 1
        return t, loc

    def late_start(self, day: int) -> int:
        return self.d["late_start"].get(str(day), 0)

    # ------------------------------------------------------------------ build
    def build(self) -> dict:
        p = self.p
        out, ret = self.trains[p["outbound"]], self.trains[p["return"]]
        delay, rdelay = self.d["train_delay_min"], self.d["return_delay_min"]
        day_start, day_end = t2m(p["day_start"]), t2m(p["day_end"])
        home = {**p["home"], "name": p["home"]["label"], "zone": "delhi"}
        start_date = date.fromisoformat(p["start_date"])

        hl_out = self.home_leg(t2m(out["dep"]))
        ret_arr = t2m(ret["arr"]) + rdelay
        hl_ret = self.home_leg(ret_arr)
        self.fixed_estimate = (self.train_fare(out["id"]) + self.train_fare(ret["id"]) + self.stay_cost()
                               + hl_out["cost"] + hl_ret["cost"])
        self.ledger["train"] = self.train_fare(out["id"]) + self.train_fare(ret["id"])
        self.ledger["stay"] = self.stay_cost()
        self.ledger["home_transfers"] = hl_out["cost"] + hl_ret["cost"]

        days = []
        # ============================== Day 1: home -> train -> Jaipur
        items: list[dict] = []
        dep = t2m(out["dep"])
        arr_sched = t2m(out["arr"])
        arr = arr_sched + delay
        leave = dep - STATION_BUFFER - hl_out["minutes"]
        items.append(self.item(1, "home", "Leave home", leave, leave, lat=home["lat"], lng=home["lng"],
                               subtitle=home["label"], anchor=True,
                               notes=[f"Leave-by time = train {out['dep']} − {STATION_BUFFER} min station buffer − "
                                      f"{hl_out['minutes']} min ride"]))
        items.append(self.item(1, "transfer", f"{hl_out['label']} to {ORIGIN_STATION['name']}", leave,
                               leave + hl_out["minutes"], mode=hl_out["mode"], cost=hl_out["cost"], km=hl_out["km"],
                               intercity=True, frm={"name": home["label"]}, to={"name": ORIGIN_STATION["name"]}))
        items.append(self.item(1, "buffer", "Station entry & find your coach", dep - STATION_BUFFER, dep,
                               notes=["Security check and platform walk"]))
        tr = self.item(1, "train", f"{out['id']} {out['name']}", dep, arr, subtitle=f"{ORIGIN_STATION['name']} → {STATION['name']}",
                       cost=self.train_fare(out["id"]), train_class=p["train_class"], scheduled_arr=out["arr"],
                       delay_min=delay, anchor=True, intercity=True)
        if delay:
            tr["status"] = "delayed"
            tr["notes"].append(f"Running {delay} min late: now arrives {m2t(arr)} (scheduled {out['arr']})")
        items.append(tr)

        t, loc = arr, STATION
        if delay >= CLOAKROOM_TRIGGER:
            self.used_cloakroom = True
            fee = CITY["cloakroom"]["fee"] * self.trav
            items.append(self.item(1, "cloakroom", "Drop bags at station cloakroom", t, t + CITY["cloakroom"]["minutes"],
                                   lat=STATION["lat"], lng=STATION["lng"], cost=fee, status="rescued",
                                   notes=["Skips the hotel detour so you reach sights before they close",
                                          "Hotel informed of late check-in; pre-booked pickup moved to evening"]))
            self.ledger["extras"] += fee
            self.events.append({"type": "cloakroom", "fee": fee})
            t += CITY["cloakroom"]["minutes"]

            def deadline(place):
                back = self.mins(place, STATION, day_end) + BAG_COLLECT_MIN + self.mins(STATION, self.hotel, day_end)
                return day_end - back
        else:
            leg = self.legs(STATION, self.hotel, t)[0]
            items.append(self.transfer(1, STATION, self.hotel, t, leg))
            t += leg["minutes"]
            early = t < t2m(self.stay["checkin"])
            items.append(self.item(1, "checkin", "Bag drop & check-in" if not early else "Bag drop (room ready at "
                                   f"{self.stay['checkin']})", t, t + CHECKIN_MIN, lat=self.hotel["lat"],
                                   lng=self.hotel["lng"], anchor=True, subtitle=self.stay["name"]))
            t += CHECKIN_MIN
            loc = self.hotel

            def deadline(place):
                return day_end - self.mins(place, self.hotel, day_end)

        t, loc = self.fill_day(1, t, loc, deadline, items)
        if self.used_cloakroom:
            leg = self.legs(loc, STATION, t)[0]
            items.append(self.transfer(1, loc, STATION, t, leg))
            t += leg["minutes"]
            items.append(self.item(1, "collect_bags", "Collect bags from cloakroom", t, t + BAG_COLLECT_MIN,
                                   lat=STATION["lat"], lng=STATION["lng"]))
            t += BAG_COLLECT_MIN
            leg = self.legs(STATION, self.hotel, t)[0]
            items.append(self.transfer(1, STATION, self.hotel, t, leg))
            t += leg["minutes"]
            items.append(self.item(1, "checkin", "Late check-in & rest", t, t + CHECKIN_MIN, lat=self.hotel["lat"],
                                   lng=self.hotel["lng"], anchor=True, subtitle=self.stay["name"]))
        else:
            if loc is not self.hotel:
                leg = self.legs(loc, self.hotel, t)[0]
                items.append(self.transfer(1, loc, self.hotel, t, leg))
                t += leg["minutes"]
            items.append(self.item(1, "hotel", "Back at hotel", t, t, lat=self.hotel["lat"], lng=self.hotel["lng"],
                                   subtitle=self.stay["name"]))
        days.append(self._day(1, start_date, "Arrive & explore", items))

        # ============================== Middle days
        for day in range(2, p["days"]):
            items = []
            s = day_start + self.late_start(day)
            st = self.item(day, "hotel", "Start from hotel", s, s, lat=self.hotel["lat"], lng=self.hotel["lng"],
                           subtitle=self.stay["name"])
            if self.late_start(day):
                st["status"] = "delayed"
                st["notes"].append(f"Starting {self.late_start(day)} min late")
            items.append(st)

            def deadline(place):
                return day_end - self.mins(place, self.hotel, day_end)

            t, loc = self.fill_day(day, s, self.hotel, deadline, items)
            if loc is not self.hotel:
                leg = self.legs(loc, self.hotel, t)[0]
                items.append(self.transfer(day, loc, self.hotel, t, leg))
                t += leg["minutes"]
            items.append(self.item(day, "hotel", "Back at hotel", t, t, lat=self.hotel["lat"], lng=self.hotel["lng"]))
            days.append(self._day(day, start_date + timedelta(days=day - 1), "Full day in Jaipur", items))

        # ============================== Last day: checkout -> sights -> train -> home
        last = p["days"]
        items = []
        s = day_start + self.late_start(last)
        co = self.item(last, "checkout", "Check out (bags held at front desk)", s, s + 15, lat=self.hotel["lat"],
                       lng=self.hotel["lng"], anchor=True, subtitle=self.stay["name"])
        if self.late_start(last):
            co["status"] = "delayed"
            co["notes"].append(f"Starting {self.late_start(last)} min late")
        items.append(co)
        ret_dep = t2m(ret["dep"]) + rdelay
        to_station = self.legs(self.hotel, STATION, ret_dep - 60)[0]
        collect_by = ret_dep - STATION_BUFFER - to_station["minutes"] - BAG_COLLECT_MIN

        def deadline(place):
            return collect_by - self.mins(place, self.hotel, collect_by)

        t, loc = self.fill_day(last, s + 15, self.hotel, deadline, items)
        if loc is not self.hotel:
            leg = self.legs(loc, self.hotel, t)[0]
            items.append(self.transfer(last, loc, self.hotel, t, leg))
            t += leg["minutes"]
        if collect_by - t > 20:
            items.append(self.item(last, "free", "Free time near the hotel", t, collect_by, lat=self.hotel["lat"],
                                   lng=self.hotel["lng"], notes=["Buffer protecting your return train"]))
            t = collect_by
        items.append(self.item(last, "collect_bags", "Collect bags", t, t + BAG_COLLECT_MIN, lat=self.hotel["lat"],
                               lng=self.hotel["lng"]))
        t += BAG_COLLECT_MIN
        items.append(self.transfer(last, self.hotel, STATION, t, to_station))
        t += to_station["minutes"]
        items.append(self.item(last, "buffer", "Station buffer & platform", t, ret_dep, lat=STATION["lat"],
                               lng=STATION["lng"], anchor=True,
                               notes=[f"Return train guard: you reach the station {round(ret_dep - t)} min early"]))
        rt = self.item(last, "train", f"{ret['id']} {ret['name']}", ret_dep, ret_arr,
                       subtitle=f"{STATION['name']} → {ORIGIN_STATION['name']}", cost=self.train_fare(ret["id"]),
                       train_class=p["train_class"], anchor=True, intercity=True, scheduled_dep=ret["dep"],
                       delay_min=rdelay)
        if rdelay:
            rt["status"] = "delayed"
            rt["notes"].append(f"Return train {rdelay} min late: extra time used for sightseeing")
        items.append(rt)
        ride = self.item(last, "transfer", f"{hl_ret['label']} home", ret_arr, ret_arr + hl_ret["minutes"],
                         mode=hl_ret["mode"], cost=hl_ret["cost"], km=hl_ret["km"], intercity=True,
                         frm={"name": ORIGIN_STATION["name"]}, to={"name": home["label"]})
        late_night = ret_arr >= t2m("22:00")
        if late_night:
            ride["notes"].append("Late-night arrival: verified cab with live-trip link shared to family")
            if "bus" in p["modes"] and hl_ret["mode"] == "cab":
                ride["notes"].append("Metro closes before you arrive, so a cab is booked instead")
            ride["safety"] = True
        items.append(ride)
        items.append(self.item(last, "arrive_home", "Home sweet home", ret_arr + hl_ret["minutes"],
                               ret_arr + hl_ret["minutes"], lat=home["lat"], lng=home["lng"], subtitle=home["label"],
                               anchor=True))
        days.append(self._day(last, start_date + timedelta(days=last - 1), "Explore & head home", items))

        self.attach_plan_b(days)
        return {"days": days, "ledger": dict(self.ledger), "events": self.events, "used_cloakroom": self.used_cloakroom,
                "visited": sorted(self.visited)}

    def _day(self, n: int, d: date, title: str, items: list) -> dict:
        return {"day": n, "date": d.isoformat(), "title": title, "items": items}

    # ------------------------------------------------------------------ plan B
    def attach_plan_b(self, days: list):
        """For every visit, pre-compute a backup that is open in the same window, fits the
        budget, and delays the next stop by at most 10 minutes."""
        in_trip = set(self.visited)
        used_backups: set[str] = set()
        for day in days:
            items = day["items"]
            for i, it in enumerate(items):
                if it["type"] != "visit":
                    continue
                prev = items[i - 1] if i > 0 and items[i - 1]["type"] == "transfer" else None
                nxt = items[i + 1] if i + 1 < len(items) and items[i + 1]["type"] == "transfer" else None
                if not prev or not nxt or not prev.get("frm") or not nxt.get("to"):
                    continue
                prev_place, next_place = prev["frm"], nxt["to"]
                depart, next_arrival = prev["start_min"], nxt["end_min"]
                orig = self.attr[it["attraction_id"]]
                best = None
                for alt in self.cat["attractions"]:
                    if alt["kind"] != "visit" or alt["id"] in in_trip or alt["id"] in self.excluded \
                            or alt["id"] in used_backups:
                        continue
                    c = self.evaluate(alt, depart, prev_place, lambda _p: 10_000, max_wait=20)
                    if not c:
                        continue
                    back = self.legs(self.place_of(alt), next_place, c["end"])[0]
                    extra = c["end"] + back["minutes"] - next_arrival
                    if extra > 10:
                        continue
                    cost_delta = (alt["fee"] - orig["fee"]) * self.trav + c["leg"]["cost"] + back["cost"] \
                        - prev.get("cost", 0) - nxt.get("cost", 0)
                    if cost_delta > max(0, self.local_left()):
                        continue
                    if best is None or c["score"] > best[0]["score"]:
                        best = (c, extra, cost_delta)
                if best:
                    c, extra, cost_delta = best
                    alt = c["a"]
                    used_backups.add(alt["id"])
                    it["plan_b"] = {"id": alt["id"], "name": alt["name"], "start": m2t(c["start"]), "end": m2t(c["end"]),
                                    "indoor": alt["indoor"], "extra_min": round(extra), "cost_delta": round5(cost_delta),
                                    "close": alt["close"], "blurb": alt["blurb"],
                                    "reason": f"Open till {alt['close']} · "
                                              f"{'+' if cost_delta >= 0 else '−'}₹{abs(round5(cost_delta))} · "
                                              f"next stop {'+' if extra > 0 else ''}{max(round(extra), 0) if extra > 0 else 'on time'}"
                                              f"{' min' if extra > 0 else ''}"}
