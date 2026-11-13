"""DelayProof Trip API."""
from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import db as dbmod
from .data import jaipur
from .engine import learning
from .engine.geo import corridor_key
from .engine.profile import make_profile
from .engine.replan import build_view
from .engine.scheduler import normalize_disruptions

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await dbmod.connect()
    yield


app = FastAPI(title="DelayProof Trip API", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- models
class TripCreate(BaseModel):
    persona_id: Literal["student", "family", "solo"] = "family"
    travelers: int | None = Field(None, ge=1, le=8)
    budget: int | None = Field(None, ge=1000, le=500000)
    days: int | None = Field(None, ge=2, le=3)
    interests: list[str] | None = None
    pace: Literal["relaxed", "balanced", "packed"] | None = None
    start_date: str | None = None
    home_label: str | None = None


class DisruptionUpdate(BaseModel):
    train_delay_min: int | None = Field(None, ge=0, le=600)
    return_delay_min: int | None = Field(None, ge=0, le=300)
    weather: Literal["clear", "heat", "rain"] | None = None
    crowd: list[str] | None = None
    late_start: dict[str, int] | None = None


class SwapReq(BaseModel):
    attraction_id: str


class FeedbackReq(BaseModel):
    attraction_id: str
    action: Literal["kept", "skipped"]


class RideLogReq(BaseModel):
    from_zone: str
    to_zone: str
    planned_min: float = Field(gt=0)
    actual_min: float = Field(gt=0)
    buffer_used: float | None = None


class WeightsReq(BaseModel):
    weights: dict[str, float]


class SimulateReq(BaseModel):
    persona_id: Literal["student", "family", "solo"] = "family"
    n: int = Field(400, ge=50, le=3000)
    apply: bool = False
    seed: int = 7


# --------------------------------------------------------------------------- helpers
async def get_trip(trip_id: str) -> dict:
    trip = await dbmod.db().trips.find_one({"_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    return trip


async def trip_view(trip: dict, message: str | None = None) -> dict:
    catalog = await dbmod.load_catalog()
    view = build_view(catalog, trip["profile"], trip.get("disruptions"))
    return {"trip_id": trip["_id"], "profile": trip["profile"], "feedback": trip.get("feedback", {}),
            "message": message, **view}


async def save_disruptions(trip_id: str, d: dict):
    await dbmod.db().trips.update_one({"_id": trip_id}, {"$set": {"disruptions": d, "updated_at": now()}})


def find_item(view: dict, attraction_id: str) -> dict | None:
    for day in view["days"]:
        for it in day["items"]:
            if it.get("attraction_id") == attraction_id and it["type"] == "visit":
                return it
    return None


# --------------------------------------------------------------------------- meta
@app.get("/api/health")
async def health():
    return {"ok": True, "db": dbmod.db_mode}


@app.get("/api/meta")
async def meta():
    catalog = await dbmod.load_catalog()
    return {
        "city": jaipur.CITY,
        "origin": jaipur.ORIGIN,
        "personas": catalog["personas"],
        "stays": catalog["stays"],
        "trains": catalog["trains"],
        "attractions": catalog["attractions"],
        "zones": jaipur.ZONES,
        "modes": jaipur.MODES,
        "homes": jaipur.HOMES,
        "interests": sorted({t for a in catalog["attractions"] for t in a["tags"]}),
        "db": dbmod.db_mode,
    }


# --------------------------------------------------------------------------- trips
@app.post("/api/trips")
async def create_trip(req: TripCreate):
    catalog = await dbmod.load_catalog()
    try:
        profile = make_profile(catalog, req.persona_id, req.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))
    trip = {"_id": uuid.uuid4().hex[:10], "profile": profile, "disruptions": normalize_disruptions({}),
            "feedback": {}, "ride_logs": [], "created_at": now(), "updated_at": now()}
    await dbmod.db().trips.insert_one(trip)
    return await trip_view(trip)


@app.get("/api/trips/{trip_id}")
async def read_trip(trip_id: str):
    return await trip_view(await get_trip(trip_id))


@app.post("/api/trips/{trip_id}/disruptions")
async def set_disruptions(trip_id: str, req: DisruptionUpdate):
    trip = await get_trip(trip_id)
    d = normalize_disruptions(trip.get("disruptions"))
    for k, v in req.model_dump(exclude_none=True).items():
        d[k] = v
    d = normalize_disruptions(d)
    await save_disruptions(trip_id, d)
    trip["disruptions"] = d
    return await trip_view(trip)


@app.post("/api/trips/{trip_id}/reset")
async def reset_trip(trip_id: str):
    trip = await get_trip(trip_id)
    d = normalize_disruptions({})
    await dbmod.db().trips.update_one({"_id": trip_id}, {"$set": {"disruptions": d, "feedback": {}}})
    trip["disruptions"], trip["feedback"] = d, {}
    return await trip_view(trip, "Plan reset to the original package.")


@app.post("/api/trips/{trip_id}/swap")
async def swap(trip_id: str, req: SwapReq):
    trip = await get_trip(trip_id)
    view = await trip_view(trip)
    it = find_item(view, req.attraction_id)
    if not it or not it.get("plan_b"):
        raise HTTPException(400, "No Plan B available for this stop")
    d = normalize_disruptions(trip.get("disruptions"))
    d["swaps"][req.attraction_id] = it["plan_b"]["id"]
    d["swap_days"][it["plan_b"]["id"]] = it["day"]
    await save_disruptions(trip_id, d)
    trip["disruptions"] = d
    return await trip_view(trip, f"Swapped {it['title']} for {it['plan_b']['name']} ({it['plan_b']['reason']}).")


@app.post("/api/trips/{trip_id}/feedback")
async def feedback(trip_id: str, req: FeedbackReq):
    trip = await get_trip(trip_id)
    catalog = await dbmod.load_catalog()
    a = next((x for x in catalog["attractions"] if x["id"] == req.attraction_id), None)
    if not a:
        raise HTTPException(404, "Unknown attraction")
    profile = trip["profile"]
    model = await dbmod.db().model.find_one({"_id": "weights"})
    weights = model["weights"]
    aff_all = model.get("tag_affinity", {})
    aff = aff_all.get(profile["persona_id"], {})
    before = dict(weights)
    x = learning.features(a, profile["interests"], profile["travelers"])
    p = learning.update(weights, aff, x, req.action == "kept")
    aff_all[profile["persona_id"]] = aff
    await dbmod.db().model.update_one({"_id": "weights"}, {"$set": {"weights": weights, "tag_affinity": aff_all},
                                                            "$inc": {"updates": 1}})
    await dbmod.db().feedback.insert_one({"trip_id": trip_id, "persona_id": profile["persona_id"],
                                          "attraction_id": a["id"], "action": req.action, "predicted": round(p, 3),
                                          "synthetic": False, "at": now()})
    fb = dict(trip.get("feedback", {}))
    fb[a["id"]] = req.action
    d = normalize_disruptions(trip.get("disruptions"))
    if req.action == "skipped" and a["id"] not in d["skipped"]:
        d["skipped"].append(a["id"])
    await dbmod.db().trips.update_one({"_id": trip_id}, {"$set": {"feedback": fb, "disruptions": d}})
    trip["feedback"], trip["disruptions"] = fb, d
    delta = {k: round(weights[k] - before[k], 4) for k in ("interest", "flagship", "budget", "travel")}
    msg = (f"Marked {a['name']} as {req.action}. Model predicted keep-probability {p:.0%}; weights nudged "
           + ", ".join(f"{k} {'+' if v >= 0 else ''}{v}" for k, v in delta.items() if v) + ".")
    if req.action == "skipped":
        msg += " Re-planned without it."
    view = await trip_view(trip, msg)
    view["learning_delta"] = delta
    return view


@app.post("/api/trips/{trip_id}/ride-log")
async def ride_log(trip_id: str, req: RideLogReq):
    await get_trip(trip_id)
    key = corridor_key(req.from_zone, req.to_zone)
    doc = await dbmod.db().corridors.find_one({"_id": key}) or {"_id": key, "buffer": 6.0, "initial": 6.0, "samples": 0}
    buffer_used = req.buffer_used if req.buffer_used is not None else doc["buffer"]
    base = req.planned_min - buffer_used
    new = learning.update_corridor(doc["buffer"], base, req.actual_min)
    await dbmod.db().corridors.update_one({"_id": key}, {"$set": {"buffer": new, "initial": doc.get("initial", 6.0)},
                                                         "$inc": {"samples": 1}}, upsert=True)
    await dbmod.db().trips.update_one({"_id": trip_id}, {"$push": {"ride_logs": {**req.model_dump(), "at": now()}}})
    trip = await get_trip(trip_id)
    return await trip_view(trip, f"Logged ride on {key.replace('|', ' ↔ ')}: buffer {doc['buffer']:.1f} → {new:.1f} min "
                                 f"(you took {req.actual_min:.0f} min vs {req.planned_min:.0f} planned).")


# --------------------------------------------------------------------------- learning / judge drawer
@app.get("/api/learning")
async def learning_state():
    d = dbmod.db()
    model = await d.model.find_one({"_id": "weights"})
    corridors = [{"corridor": x["_id"], "buffer": x["buffer"], "initial": x.get("initial", x["buffer"]),
                  "samples": x.get("samples", 0)} async for x in d.corridors.find({})]
    real = await d.feedback.count_documents({"synthetic": False})
    synthetic = await d.feedback.count_documents({"synthetic": True})
    return {"weights": model["weights"], "defaults": jaipur.DEFAULT_WEIGHTS, "tag_affinity": model.get("tag_affinity", {}),
            "updates": model.get("updates", 0), "corridors": sorted(corridors, key=lambda c: c["corridor"]),
            "feedback": {"real": real, "synthetic": synthetic}, "db": dbmod.db_mode}


@app.put("/api/learning/weights")
async def set_weights(req: WeightsReq):
    model = await dbmod.db().model.find_one({"_id": "weights"})
    weights = model["weights"]
    for k, v in req.weights.items():
        if k in weights:
            weights[k] = max(0.0, min(3.0, float(v)))
    await dbmod.db().model.update_one({"_id": "weights"}, {"$set": {"weights": weights}})
    return await learning_state()


@app.post("/api/learning/simulate")
async def simulate(req: SimulateReq):
    catalog = await dbmod.load_catalog()
    persona = next(p for p in catalog["personas"] if p["id"] == req.persona_id)
    result = learning.simulate(catalog, persona, n=req.n, seed=req.seed)
    events = result.pop("events")
    if req.apply:
        d = dbmod.db()
        model = await d.model.find_one({"_id": "weights"})
        weights = {**model["weights"], **result["weights_after"]}
        aff_all = model.get("tag_affinity", {})
        aff_all[req.persona_id] = result["tag_affinity_after"]
        await d.model.update_one({"_id": "weights"}, {"$set": {"weights": weights, "tag_affinity": aff_all},
                                                      "$inc": {"updates": len(events)}})
        for key, buf in result["corridors"]["learned"].items():
            await d.corridors.update_one({"_id": key}, {"$set": {"buffer": buf}, "$inc": {"samples": 1},
                                                        "$setOnInsert": {"initial": 6.0}}, upsert=True)
        await d.feedback.insert_many([{"persona_id": req.persona_id, "attraction_id": e["attraction_id"],
                                       "action": "kept" if e["kept"] else "skipped", "synthetic": True, "at": now()}
                                      for e in events])
    result["applied"] = req.apply
    return result


@app.post("/api/learning/reset")
async def reset_learning():
    await dbmod.seed(force=True)
    return await learning_state()
