"""Builds the full trip view: baseline plan, re-planned trip, what changed and why,
and what a static (non-healing) planner would have lost."""
from __future__ import annotations

from datetime import datetime, timezone

from .geo import m2t, t2m
from .scheduler import Planner, normalize_disruptions

RECEIPT_LABELS = [
    ("train", "Trains (to Jaipur & back)"),
    ("stay", "Base stay"),
    ("home_transfers", "Home ↔ station rides"),
    ("local_rides", "Local rides in Jaipur"),
    ("tickets", "Entry tickets"),
    ("meals", "Meals & chai"),
    ("extras", "Extras (cloakroom etc.)"),
]


def live_only(d: dict) -> dict:
    """User edits (skips, swaps) are part of the baseline; live disruptions are not."""
    return {"skipped": d["skipped"], "swaps": d["swaps"], "swap_days": d["swap_days"], "pins": d["pins"]}


def has_live(d: dict) -> bool:
    return bool(d["train_delay_min"] or d["return_delay_min"] or d["weather"] != "clear" or d["crowd"]
                or d["late_start"])


def visits(result: dict) -> dict:
    out = {}
    for day in result["days"]:
        for it in day["items"]:
            if it["type"] == "visit":
                out[it["attraction_id"]] = it
    return out


def build_view(catalog: dict, profile: dict, disruptions: dict | None) -> dict:
    d = normalize_disruptions(disruptions)
    baseline = Planner(catalog, profile, live_only(d)).build()
    current = Planner(catalog, profile, d).build() if has_live(d) else baseline
    attr = {a["id"]: a for a in catalog["attractions"]}

    changes = diff(baseline, current, d, attr, profile)
    naive = naive_outcome(baseline, d, attr, profile)
    base_v, cur_v = visits(baseline), visits(current)
    flag_total = [a for a in base_v if attr[a]["flagship"]]
    flag_kept = [a for a in flag_total if a in cur_v]

    total = sum(current["ledger"].values())
    receipt = {
        "lines": [{"key": k, "label": label, "amount": current["ledger"].get(k, 0)} for k, label in RECEIPT_LABELS],
        "total": total,
        "budget": profile["budget"],
        "remaining": profile["budget"] - total,
        "baseline_total": sum(baseline["ledger"].values()),
    }
    banner = make_banner(d, changes, current["events"], naive, len(flag_kept), len(flag_total), profile)
    return {
        "days": current["days"],
        "baseline_days": baseline["days"],
        "receipt": receipt,
        "changes": changes,
        "naive": naive,
        "banner": banner,
        "stats": {
            "flagships_total": len(flag_total),
            "flagships_kept": len(flag_kept),
            "stops": len(cur_v),
            "baseline_stops": len(base_v),
            "used_cloakroom": current["used_cloakroom"],
        },
        "disruptions": d,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def diff(baseline: dict, current: dict, d: dict, attr: dict, profile: dict) -> list[dict]:
    if current is baseline:
        return []
    base, cur = visits(baseline), visits(current)
    arrival = next((it for it in current["days"][0]["items"] if it["type"] == "train"), None)
    changes = []
    for aid, b in base.items():
        a = attr[aid]
        if aid not in cur:
            changes.append({"kind": "dropped", "id": aid, "name": a["name"], "from_day": b["day"],
                            "from": b["start"], "reason": drop_reason(a, b, d, profile)})
            continue
        c = cur[aid]
        if c["day"] != b["day"]:
            c["status"] = "moved"
            if c["day"] > b["day"]:
                late_close = arrival and t2m(a["close"]) - arrival["end_min"] > 240
                if b["day"] == 1 and d["train_delay_min"] and arrival and not late_close:
                    why = f"It closes at {a['close']} and your train now reaches Jaipur at {arrival['end']}"
                elif b["day"] == 1 and d["train_delay_min"]:
                    why = "Your shortened Day 1 only had room for stops that close earlier"
                else:
                    why = f"Day {b['day']} no longer has room before it closes at {a['close']}"
                reason = f"{why}, so it moved to Day {c['day']} at {c['start']} instead of being lost."
            else:
                reason = f"Open till {a['close']}, so it moved up to Day {c['day']} at {c['start']} to fill the freed slot."
            c["notes"].append(f"Moved from Day {b['day']} {b['start']}")
            changes.append({"kind": "moved", "id": aid, "name": a["name"], "from_day": b["day"], "from": b["start"],
                            "to_day": c["day"], "to": c["start"], "reason": reason, "flagship": a["flagship"]})
        elif abs(c["start_min"] - b["start_min"]) >= 30:
            c["notes"].append(f"Re-timed from {b['start']}")
            changes.append({"kind": "retimed", "id": aid, "name": a["name"], "from_day": b["day"], "from": b["start"],
                            "to_day": c["day"], "to": c["start"],
                            "reason": f"Shifted from {b['start']} to {c['start']} on Day {c['day']}.",
                            "flagship": a["flagship"]})
    for aid, c in cur.items():
        if aid in base:
            continue
        a = attr[aid]
        if c["status"] == "normal":
            c["status"] = "rescued"
        if d["weather"] in ("heat", "rain") and a["indoor"]:
            reason = f"Indoor and cool, so it replaces outdoor time during the {'heat' if d['weather'] == 'heat' else 'rain'}."
        elif t2m(a["close"]) >= t2m("19:30"):
            reason = f"Open till {a['close']}, so it fills an evening slot that would otherwise be wasted."
        else:
            reason = "Fits the gap the disruption opened up, within budget."
        c["notes"].append("Added by re-plan")
        changes.append({"kind": "added", "id": aid, "name": a["name"], "to_day": c["day"], "to": c["start"],
                        "reason": reason, "flagship": a["flagship"]})
    order = {"moved": 0, "added": 1, "dropped": 2, "retimed": 3}
    changes.sort(key=lambda x: (order[x["kind"]], x.get("to_day", x.get("from_day", 0))))
    return changes


def drop_reason(a: dict, b: dict, d: dict, profile: dict) -> str:
    if a["id"] in d["crowd"]:
        return f"Crowd surge reported at {a['name']}: an hour-long queue would break the rest of the day."
    if d["weather"] == "rain" and not a["indoor"]:
        return "Outdoor stop, removed for the rain."
    if d["weather"] == "heat" and not a["indoor"]:
        return "Outdoor stop with no shaded slot outside 12:00–16:00 heat."
    if str(profile["days"]) in d["late_start"] and b["day"] == profile["days"]:
        return "Dropped to protect your return train; it had the lowest value for you."
    return "Lowest-value stop that no longer fits the shortened day."


def naive_outcome(baseline: dict, d: dict, attr: dict, profile: dict) -> dict:
    """What a static itinerary would do: keep the same plan and just run late."""
    trav = profile["travelers"]
    missed, heat_exposed = [], []
    wasted = 0
    missed_train = False
    for day in baseline["days"]:
        shift = 0
        if day["day"] == 1:
            shift_from_train = d["train_delay_min"]
        else:
            shift_from_train = 0
        shift = d["late_start"].get(str(day["day"]), 0)
        after_train = False
        first_local_ride_charged = False
        for it in day["items"]:
            if day["day"] == 1 and it["type"] == "train":
                after_train = True
                continue
            s = shift + (shift_from_train if after_train else 0)
            if it["type"] == "transfer" and day["day"] == 1 and after_train and not first_local_ride_charged:
                first_local_ride_charged = True
                if d["train_delay_min"] >= 60:
                    wasted += it.get("cost", 0)  # pre-booked pickup no-show
            if it["type"] == "visit":
                a = attr[it["attraction_id"]]
                end = it["end_min"] + s
                if a["id"] in d["crowd"]:
                    shift += 60
                    end += 60
                if end > t2m(a["close"]):
                    missed.append({"name": a["name"], "flagship": a["flagship"], "lost": a["fee"] * trav})
                    wasted += a["fee"] * trav
                elif not a["indoor"]:
                    if d["weather"] == "rain" or (d["weather"] == "heat" and it["start_min"] + s < t2m("16:00")
                                                  and end > t2m("12:00")):
                        heat_exposed.append(a["name"])
            if it["type"] == "train" and day["day"] == len(baseline["days"]) and day["day"] > 1:
                dep = it["start_min"] + d["return_delay_min"]
                # the stop before the station buffer is the arrival at the station
                arrive_station = next((x["start_min"] for x in day["items"] if x["type"] == "buffer"), dep) + s
                if arrive_station > dep:
                    missed_train = True
                    wasted += it.get("cost", 0)
    return {
        "missed": missed,
        "flagships_missed": sum(1 for m in missed if m["flagship"]),
        "wasted": wasted,
        "missed_train": missed_train,
        "exposed": heat_exposed,
    }


def make_banner(d, changes, events, naive, kept, total, profile) -> dict:
    causes = []
    if d["train_delay_min"]:
        h, m = divmod(d["train_delay_min"], 60)
        causes.append(f"train {h}h{m:02d} late" if h else f"train {m} min late")
    if d["weather"] == "heat":
        causes.append("42°C heat")
    if d["weather"] == "rain":
        causes.append("rain")
    if d["crowd"]:
        causes.append("crowd surge")
    for day, mins in d["late_start"].items():
        causes.append(f"Day {day} starting {mins} min late")
    if d["return_delay_min"]:
        causes.append(f"return train {d['return_delay_min']} min late")
    if not causes:
        return {"active": False, "headline": "Your door-to-door plan is ready",
                "lines": ["Every stop already has a Plan B that is open at the same time and fits your budget."],
                "savings": []}

    verbs = {"added": "Added", "dropped": "Dropped", "moved": "Moved"}
    lines = [f"{verbs[c['kind']]} {c['name']}: {c['reason']}" for c in changes if c["kind"] in verbs][:6]
    for e in events:
        if e["type"] == "cloakroom":
            lines.insert(0, f"Bags go to the station cloakroom (₹{e['fee']}) so you skip the hotel detour; "
                            "check-in moved to the evening.")
        if e["type"] == "upgrade":
            lines.append(f"Ride to {e['to']} upgraded to {e['to_mode'].replace('_', ' ')}: saves {e['saved_min']} min "
                         f"for +₹{e['extra_cost']}, beating the closing time.")
    savings = []
    if naive["wasted"]:
        savings.append({"label": "Money saved", "value": f"₹{naive['wasted']:,}",
                        "detail": "tickets & pickups a static plan would waste"})
    if total:
        static_kept = total - naive["flagships_missed"]
        savings.append({"label": "Must-see kept", "value": f"{kept}/{total}",
                        "detail": f"static plan keeps {static_kept}/{total}"})
    if naive["missed_train"]:
        savings.append({"label": "Return train", "value": "Protected", "detail": "a static plan would miss it"})
    if naive["exposed"]:
        savings.append({"label": "Outdoor exposure avoided", "value": str(len(naive["exposed"])),
                        "detail": ", ".join(naive["exposed"][:3])})
    if not lines:
        lines.append("All your stops still fit; times were adjusted around the disruption.")
    return {"active": True, "headline": "Re-planned around " + ", ".join(causes), "lines": lines, "savings": savings}
