"""Plan evaluation and guardrail enforcement for Sarthi AI."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Tuple

from app.services.effort_band import EFFORT_BAND_BUDGETS


@dataclass
class EvaluationResult:
    band: str
    weekly_minutes: List[int]
    max_tasks_per_day_week1: int
    avg_tasks_per_day_week1: float
    vagueness_flags: List[str] = field(default_factory=list)
    cadence_issues: List[str] = field(default_factory=list)
    budget_violations: List[str] = field(default_factory=list)
    overload_warnings: List[str] = field(default_factory=list)
    score: int = 100
    passed: bool = False
    repair_instructions: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "band": self.band,
            "weekly_minutes": self.weekly_minutes,
            "max_tasks_per_day_week1": self.max_tasks_per_day_week1,
            "avg_tasks_per_day_week1": self.avg_tasks_per_day_week1,
            "vagueness_flags": self.vagueness_flags,
            "cadence_issues": self.cadence_issues,
            "budget_violations": self.budget_violations,
            "overload_warnings": self.overload_warnings,
            "score": self.score,
            "passed": self.passed,
            "repair_instructions": self.repair_instructions,
        }


VAGUE_TOKENS = {"stuff", "do something", "try to"}


def evaluate_plan(
    plan: Dict[str, Any],
    band: str,
    resolution_type: str | None,
    goal_requirements: Dict[str, Any] | None = None,
) -> EvaluationResult:
    band = band if band in EFFORT_BAND_BUDGETS else "medium"
    budgets = EFFORT_BAND_BUDGETS[band]
    weekly_minutes: List[int] = []
    vagueness_flags: List[str] = []
    cadence_issues: List[str] = []
    budget_violations: List[str] = []
    overload_warnings: List[str] = []
    requirements = goal_requirements or {}
    required_activity = (requirements.get("activity") or "").lower()
    target_duration = requirements.get("target_duration_min")

    weeks_data = plan.get("weeks") or []
    if not weeks_data:
        weeks_data = plan.get("plan", {}).get("milestones", [])

    for week_entry in weeks_data:
        week_minutes = sum(_task_duration(task) for task in week_entry.get("tasks", []))
        weekly_minutes.append(week_minutes)

    week1_tasks = weeks_data[0].get("tasks", []) if weeks_data else []
    task_counts = _estimate_tasks_per_day(week1_tasks)
    max_tasks_per_day = max(task_counts.values(), default=0)
    avg_tasks_per_day = sum(task_counts.values()) / len(task_counts) if task_counts else 0.0

    for task in week1_tasks:
        title = (task.get("title") or "").strip().lower()
        if len(title.split()) < 3 and not any(keyword in title for keyword in {"scale", "chapter", "report", "session"}):
            vagueness_flags.append(task.get("title") or "Untitled task")
            continue
        if any(token == title or (token in title and len(title) < 20) for token in VAGUE_TOKENS):
            vagueness_flags.append(task.get("title") or "Untitled task")

    for minutes in weekly_minutes:
        allowed = budgets["weekly_minutes"] * 1.2
        if minutes > allowed:
            budget_violations.append(f"Week budget exceeded ({int(minutes)} min > {int(allowed)} min).")

    max_allowed = budgets["tasks_per_day"][1]
    if max_tasks_per_day > max_allowed:
        budget_violations.append(f"Week1 tasks/day exceeded ({max_tasks_per_day} > {max_allowed}).")

    if resolution_type in {"skill", "learning", "habit", "health"}:
        repeating = any(_is_repeating_task(task) for task in week1_tasks)
        if not repeating:
            cadence_issues.append("Needs a repeating practice loop in Week 1.")
        all_flex = all(_cadence_type(task) == "flex" for task in week1_tasks if week1_tasks)
        if all_flex:
            cadence_issues.append("Too many flex cadences for habit/skill goal.")

    for task in week1_tasks:
        duration = _task_duration(task)
        if duration > 120 and band not in {"intense"} and resolution_type not in {"project", "work"}:
            overload_warnings.append(f"{task.get('title', 'Task')} is too long ({duration} min).")
        elif duration > 180:
            overload_warnings.append(f"{task.get('title', 'Task')} exceeds 3 hours.")

    long_tasks = [task for task in week1_tasks if _task_duration(task) > 60]

    if band == "medium" and len(long_tasks) > 2:
        overload_warnings.append("Too many long tasks (>60 min) in Week 1 for medium band.")

    if required_activity:
        keywords = {word for word in required_activity.split()}
        activity_found = False
        for task in week1_tasks:
            haystack = " ".join(
                [
                    str(task.get("title") or "").lower(),
                    str(task.get("intent") or "").lower(),
                ]
            )
            if any(keyword in haystack for keyword in keywords):
                activity_found = True
                break
        if not activity_found:
            cadence_issues.append(f"Week 1 tasks must include {required_activity}.")

    if target_duration:
        tolerance = max(5, int(target_duration * 0.2))
        duration_found = any(
            abs(_task_duration(task) - target_duration) <= tolerance for task in week1_tasks
        )
        if not duration_found:
            cadence_issues.append(f"Missing session near requested duration (~{target_duration} min).")

    score = 100
    budget_violation_count = len(budget_violations)
    score -= 30 * budget_violation_count
    score -= 5 * len(vagueness_flags)
    score -= 5 * len(cadence_issues)
    score -= 15 * len(overload_warnings)
    score = max(score, 0)
    relaxed_budget_ok = budget_violation_count == 1 and score >= 60
    passed = (not budget_violations and score >= 50) or relaxed_budget_ok
    print(f"Budget violations: {budget_violations}")
    print(f"Score: {score}")
    print(f"Passed: {passed}")
    repair_instructions = ""
    if not passed:
        repair_instructions = _build_repair_instructions(budget_violations, vagueness_flags, cadence_issues, overload_warnings)

    return EvaluationResult(
        band=band,
        weekly_minutes=weekly_minutes,
        max_tasks_per_day_week1=max_tasks_per_day,
        avg_tasks_per_day_week1=avg_tasks_per_day,
        vagueness_flags=vagueness_flags,
        cadence_issues=cadence_issues,
        budget_violations=budget_violations,
        overload_warnings=overload_warnings,
        score=score,
        passed=passed,
        repair_instructions=repair_instructions,
    )


def _task_duration(task: Dict[str, Any]) -> int:
    value = task.get("estimated_duration_min") or task.get("duration_min")
    return int(value) if isinstance(value, (int, float)) else 30


def _estimate_tasks_per_day(tasks: List[Dict[str, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for task in tasks:
        if _task_duration(task) < 15:
            continue
        scheduled_day = task.get("scheduled_day") or task.get("suggested_day")
        if scheduled_day:
            counts.setdefault(str(scheduled_day), 0)
            counts[str(scheduled_day)] += 1
            continue
        cadence_type, cadence_count = _cadence_estimate(task)
        if cadence_type == "daily":
            counts.setdefault("daily", 0)
            counts["daily"] += 1
        elif cadence_type == "specific_days":
            days = task.get("cadence", {}).get("days") or []
            for day in days:
                counts.setdefault(day, 0)
                counts[day] += 1
        elif cadence_type == "x_per_week":
            counts.setdefault("weekly", 0)
            counts["weekly"] += cadence_count
        else:
            counts.setdefault("flex", 0)
            counts["flex"] += 1
    return counts


def _cadence_estimate(task: Dict[str, Any]) -> Tuple[str, int]:
    cadence = task.get("_cadence_struct") or task.get("cadence")
    if isinstance(cadence, dict):
        cadence_type = str(cadence.get("type") or cadence.get("cadence") or "").lower()
        cadence_count = cadence.get("count") or cadence.get("times_per_week") or 0
        days = cadence.get("days") or []
    else:
        cadence_type = str(cadence or "").lower()
        cadence_count = 0
        days = []
    if cadence_type == "daily":
        return cadence_type, 7
    if cadence_type == "specific_days":
        return cadence_type, len(days)
    if cadence_type == "x_per_week":
        return cadence_type, int(cadence_count or 0)
    return cadence_type or "flex", 1


def _cadence_type(task: Dict[str, Any]) -> str:
    cadence = task.get("_cadence_struct") or task.get("cadence")
    if isinstance(cadence, dict):
        return str(cadence.get("type") or cadence.get("cadence") or "").lower()
    if isinstance(cadence, str):
        return cadence.lower()
    return ""


def _is_repeating_task(task: Dict[str, Any]) -> bool:
    cadence_type, cadence_count = _cadence_estimate(task)
    if cadence_type == "daily":
        return True
    if cadence_type == "x_per_week" and cadence_count >= 5:
        return True
    if cadence_type == "specific_days" and cadence_count >= 5:
        return True
    return False


def _build_repair_instructions(
    budget: List[str],
    vagueness: List[str],
    cadence: List[str],
    overload: List[str],
) -> str:
    instructions: List[str] = []
    if budget:
        instructions.append("Reduce total minutes to stay within the effort band budget.")
    if vagueness:
        instructions.append("Replace vague titles with concrete actions and measurable outputs.")
    if cadence:
        instructions.append("Add repeating practice loops with clear cadence for habit/skill goals.")
    if overload:
        instructions.append("Limit excessively long sessions and spread tasks across days.")
    return " ".join(instructions[:4]) or "Adjust tasks to fit the effort band constraints."
