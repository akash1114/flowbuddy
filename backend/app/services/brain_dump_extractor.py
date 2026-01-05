"""Lightweight heuristics for extracting signals from brain dumps."""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import List


@dataclass
class ExtractionResult:
    signals: dict
    actionable: bool
    success: bool


EMOTION_KEYWORDS = {
    "overwhelmed": ["overwhelmed", "swamped", "underwater"],
    "stressed": ["stressed", "anxious", "worried"],
    "burned_out": ["burned out", "exhausted", "tired"],
    "motivated": ["excited", "motivated", "ready"],
}

BLOCKER_KEYWORDS = ["stuck", "blocked", "can't", "cannot", "because", "waiting", "unclear"]
RESOLUTION_KEYWORDS = ["resolution", "goal", "habit", "plan", "project"]
INTENT_KEYWORDS = ["i want", "i'd like", "i plan", "i will", "i'm going to"]
ACTIONABLE_HINTS = ["next step", "plan to", "will tomorrow", "i can", "i'll", "today i"]


def extract_signals(text: str) -> ExtractionResult:
    sentences = _split_sentences(text)
    lowered = text.lower()

    try:
        emotional_state = _detect_emotional_state(lowered)
        blockers = _collect_sentences(sentences, BLOCKER_KEYWORDS)
        resolution_refs = _collect_sentences(sentences, RESOLUTION_KEYWORDS)
        intent_shift = _find_intent_sentence(sentences)
        actionable = _is_actionable(lowered, blockers)

        signals_payload = {
            "emotional_state": emotional_state,
            "blockers": blockers,
            "resolution_refs": resolution_refs,
            "intent_shift": intent_shift,
        }
        return ExtractionResult(signals=signals_payload, actionable=actionable, success=True)
    except Exception:
        return ExtractionResult(
            signals={
                "emotional_state": None,
                "blockers": [],
                "resolution_refs": [],
                "intent_shift": None,
            },
            actionable=False,
            success=False,
        )


def _split_sentences(text: str) -> List[str]:
    parts = re.split(r"[.!?\n]+", text)
    return [p.strip() for p in parts if p.strip()]


def _detect_emotional_state(lower_text: str) -> str | None:
    for label, keywords in EMOTION_KEYWORDS.items():
        if any(keyword in lower_text for keyword in keywords):
            return label.replace("_", " ")
    return None


def _collect_sentences(sentences: List[str], keywords: List[str]) -> List[str]:
    collected: List[str] = []
    for sentence in sentences:
        lower_sentence = sentence.lower()
        if any(keyword in lower_sentence for keyword in keywords):
            collected.append(sentence)
    return collected


def _find_intent_sentence(sentences: List[str]) -> str | None:
    for sentence in sentences:
        lower_sentence = sentence.lower()
        if any(keyword in lower_sentence for keyword in INTENT_KEYWORDS):
            return sentence
    return None


def _is_actionable(lower_text: str, blockers: List[str]) -> bool:
    if any(hint in lower_text for hint in ACTIONABLE_HINTS):
        return True
    return bool(blockers)
