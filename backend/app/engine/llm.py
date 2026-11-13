"""Provision for an LLM-powered assistant brain.

The demo runs on the offline rule brain (agent.py). To switch the brain to an LLM:
  1. install your provider's SDK
  2. set LLM_API_KEY and AI_BRAIN=llm in backend/.env
  3. implement `run_llm_agent` with the provider's tool-calling API, exposing the same tools agent.Tools offers
     (preview / create_trip / disrupt / skip / pin / swap / reset / places / travel options).
The planner stays the source of truth: the model only chooses which tool to call, so it cannot invent times or prices.
"""
from __future__ import annotations

import os


def brain() -> str:
    return "llm" if os.getenv("AI_BRAIN", "offline") == "llm" and os.getenv("LLM_API_KEY") else "offline"


def has_key() -> bool:
    return bool(os.getenv("LLM_API_KEY"))


async def run_llm_agent(*_args, **_kwargs):  # pragma: no cover - provision only
    raise NotImplementedError("LLM brain not enabled for the demo; the offline rule brain is used.")
