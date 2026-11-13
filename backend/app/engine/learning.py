"""Self-learning loop.

1. Kept / Skipped feedback -> online logistic update of the scoring weights the
   planner uses (interest, flagship, budget, travel) plus per-persona tag affinity.
2. Actual ride durations -> exponential moving average on per-corridor delay buffers.
3. A synthetic trip seeder with a hidden "true" traveller model, used to show
   before/after holdout accuracy to the judges.
"""
from __future__ import annotations

import math
import random

from ..data.jaipur import CORRIDOR_BUFFERS, DEFAULT_WEIGHTS

LR = 0.15
EMA_ALPHA = 0.3
CLAMP_W = (0.0, 3.0)
CLAMP_AFF = (-2.0, 2.0)

EFFORT = {"amber_hill": 1.0, "nahargarh_hill": 0.9, "outskirts": 0.8, "east": 0.5, "south": 0.5,
          "old_city": 0.3, "central": 0.2, "station": 0.2}

# Hidden preferences used only by the synthetic seeder (the model never sees these directly)
TRUE_MODELS = {
    "family": {"bias": 0.3, "interest": 0.9, "flagship": 0.5, "budget": 0.5, "travel": 2.4,
               "tags": {"food": 1.3, "shopping": 1.0, "nature": -0.9, "science": -0.8, "spiritual": 0.5}},
    "student": {"bias": 0.2, "interest": 1.0, "flagship": 0.3, "budget": 2.8, "travel": 0.6,
                "tags": {"photography": 1.1, "food": 0.9, "history": -0.4, "shopping": -1.0}},
    "solo": {"bias": 0.1, "interest": 1.4, "flagship": 0.2, "budget": 0.7, "travel": 0.4,
             "tags": {"nature": 1.3, "photography": 1.2, "shopping": -1.2, "culture": -0.5}},
}
TRUE_BUFFERS = {
    "amber_hill|old_city": 24, "amber_hill|central": 21, "amber_hill|station": 27, "old_city|station": 15,
    "central|old_city": 10, "nahargarh_hill|old_city": 19, "old_city|old_city": 7, "central|station": 6,
    "outskirts|central": 18, "outskirts|old_city": 22, "east|old_city": 11,
}


def sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-max(-30, min(30, z))))


def features(a: dict, interests: list[str], travelers: int = 1, effort_scale: float = 1.0) -> dict:
    m = len(set(a["tags"]) & set(interests))
    return {
        "interest": 0.0 if m == 0 else min(1.0, 0.6 + 0.2 * (m - 1)),
        "flagship": 1.0 if a["flagship"] else 0.0,
        "budget": min(1.5, a["fee"] * travelers / 500),
        "travel": EFFORT.get(a["zone"], 0.4) * effort_scale,
        "tags": a["tags"],
    }


def predict(weights: dict, aff: dict, x: dict, bias: float = 0.4) -> float:
    tag = sum(aff.get(t, 0.0) for t in x["tags"]) / max(1, len(x["tags"]))
    z = (bias + weights["interest"] * x["interest"] + weights["flagship"] * x["flagship"]
         - weights["budget"] * x["budget"] - weights["travel"] * x["travel"] + tag)
    return sigmoid(z)


def update(weights: dict, aff: dict, x: dict, kept: bool, lr: float = LR) -> float:
    """One SGD step on log-loss. Mutates weights/aff in place, returns the prediction before the step."""
    p = predict(weights, aff, x)
    err = (1.0 if kept else 0.0) - p
    weights["interest"] = _clamp(weights["interest"] + lr * err * x["interest"], CLAMP_W)
    weights["flagship"] = _clamp(weights["flagship"] + lr * err * x["flagship"], CLAMP_W)
    weights["budget"] = _clamp(weights["budget"] - lr * err * x["budget"], CLAMP_W)
    weights["travel"] = _clamp(weights["travel"] - lr * err * x["travel"], CLAMP_W)
    for t in x["tags"]:
        aff[t] = _clamp(aff.get(t, 0.0) + lr * err / len(x["tags"]), CLAMP_AFF)
    return p


def update_corridor(buffer: float, planned_base: float, actual: float, alpha: float = EMA_ALPHA) -> float:
    observed_extra = max(0.0, actual - planned_base)
    return round(buffer + alpha * (observed_extra - buffer), 2)


def _clamp(v: float, lim: tuple) -> float:
    return round(max(lim[0], min(lim[1], v)), 4)


# --------------------------------------------------------------------------- simulation
def simulate(catalog: dict, persona: dict, n: int = 400, seed: int = 7, epochs: int = 12) -> dict:
    rng = random.Random(seed)
    truth = TRUE_MODELS[persona["id"]]
    visits = [a for a in catalog["attractions"] if a["kind"] == "visit"]

    events = []
    for _ in range(n):
        a = rng.choice(visits)
        travelers = max(1, persona["travelers"] + rng.choice([-1, 0, 0, 1]))
        x = features(a, persona["interests"], travelers, effort_scale=rng.uniform(0.5, 1.6))
        tag = sum(truth["tags"].get(t, 0.0) for t in x["tags"]) / len(x["tags"])
        z = (truth["bias"] + truth["interest"] * x["interest"] + truth["flagship"] * x["flagship"]
             - truth["budget"] * x["budget"] - truth["travel"] * x["travel"] + tag + rng.gauss(0, 0.35))
        events.append({"attraction_id": a["id"], "x": x, "kept": z > 0})
    split = int(n * 0.75)
    train, hold = events[:split], events[split:]

    weights = {k: catalog["weights"][k] for k in ("interest", "flagship", "budget", "travel")}
    aff = dict(catalog.get("tag_affinity", {}).get(persona["id"], {}))

    def acc():
        return round(sum((predict(weights, aff, e["x"]) > 0.5) == e["kept"] for e in hold) / len(hold), 3)

    curve = [{"epoch": 0, "accuracy": acc()}]
    for ep in range(1, epochs + 1):
        rng.shuffle(train)
        for e in train:
            update(weights, aff, e["x"], e["kept"])
        curve.append({"epoch": ep, "accuracy": acc()})

    # corridor buffers: rides with hidden true extra delay
    corridors = dict(catalog["corridors"])
    rides = []
    for _ in range(n):
        key = rng.choice(list(TRUE_BUFFERS))
        base = rng.uniform(15, 50)
        rides.append({"key": key, "base": base, "actual": base + TRUE_BUFFERS[key] + rng.gauss(0, 4)})
    r_train, r_hold = rides[:split], rides[split:]

    def mae(bufs):
        return round(sum(abs(r["actual"] - (r["base"] + bufs.get(r["key"], 6))) for r in r_hold) / len(r_hold), 2)

    mae_before = mae(corridors)
    learned = dict(corridors)
    for r in r_train:
        learned[r["key"]] = update_corridor(learned.get(r["key"], 6), r["base"], r["actual"])
    mae_after = mae(learned)

    return {
        "persona": persona["id"],
        "n_train": len(train),
        "n_holdout": len(hold),
        "kept_rate": round(sum(e["kept"] for e in events) / n, 3),
        "accuracy": {"before": curve[0]["accuracy"], "after": curve[-1]["accuracy"], "curve": curve},
        "weights_before": {k: catalog["weights"][k] for k in weights},
        "weights_after": weights,
        "tag_affinity_after": aff,
        "corridors": {
            "mae_before": mae_before,
            "mae_after": mae_after,
            "table": [{"corridor": k, "before": round(corridors.get(k, 6), 1), "after": round(learned[k], 1),
                       "true": TRUE_BUFFERS[k]} for k in TRUE_BUFFERS],
            "learned": learned,
        },
        "events": events[:split],
    }


def defaults() -> tuple[dict, dict]:
    return dict(DEFAULT_WEIGHTS), {k: float(v) for k, v in CORRIDOR_BUFFERS.items()}
