"""Heuristics that normalize resolution text."""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import List, Tuple


@dataclass
class ResolutionIntakeResult:
    title: str
    type: str


MAX_TITLE_LENGTH = 80
TYPE_KEYWORDS: List[Tuple[str, Tuple[str, ...]]] = [
    (
        "health",
        (
            "sleep",
            "run",
            "exercise",
            "workout",
            "gym",
            "meditate",
            "yoga",
            "walk",
            "wellness",
            "health",
        ),
    ),
    (
        "habit",
        (
            "habit",
            "daily",
            "every day",
            "each morning",
            "routine",
            "consistent",
            "consistently",
        ),
    ),
    (
        "finance",
        (
            "budget",
            "save",
            "spend less",
            "pay off",
            "debt",
            "money",
            "finance",
            "invest",
        ),
    ),
    (
        "learning",
        (
            "learn",
            "study",
            "course",
            "class",
            "reading",
            "certificate",
            "train",
            "practice",
        ),
    ),
    (
        "project",
        (
            "project",
            "launch",
            "ship",
            "finish",
            "complete",
            "build",
            "deliver",
            "write",
        ),
    ),
]


def derive_resolution_fields(text: str) -> ResolutionIntakeResult:
    """Return normalized title and best-effort classification."""
    normalized_title = _normalize_title(text)
    resolution_type = _classify_type(text)
    return ResolutionIntakeResult(title=normalized_title, type=resolution_type)


def _normalize_title(text: str) -> str:
    trimmed = text.strip()
    if not trimmed:
        return "Resolution"

    first_sentence = _first_sentence(trimmed)
    candidate = first_sentence or trimmed
    candidate = candidate.strip()
    if len(candidate) <= MAX_TITLE_LENGTH:
        return candidate
    shortened = candidate[:MAX_TITLE_LENGTH].rstrip(",;:- ")
    return f"{shortened}..."


def _first_sentence(text: str) -> str:
    parts = re.split(r"[.!?\n]+", text, maxsplit=1)
    return parts[0] if parts else text


def _classify_type(text: str) -> str:
    lowered = text.lower()
    for type_name, keywords in TYPE_KEYWORDS:
        if any(keyword in lowered for keyword in keywords):
            return type_name
    return "other"
