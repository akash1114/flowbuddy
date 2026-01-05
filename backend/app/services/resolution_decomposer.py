"""Deterministic heuristics that decompose resolutions into plans."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, time
from typing import Any, Dict, List

from app.services.resolution_intake import classify_resolution_type


@dataclass
class DraftTaskSpec:
    title: str
    duration_min: int | None = None
    scheduled_day: date | None = None
    scheduled_time: time | None = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DecompositionResult:
    plan: Dict[str, Any]
    week_one_tasks: List[DraftTaskSpec]
    resolution_type: str


PLAN_TEMPLATES = {
    "habit": [
        {
            "focus": "Establish a gentle routine",
            "success": [
                "Name the cue/time for the habit",
                "Complete at least two light reps",
            ],
        },
        {
            "focus": "Stabilize consistency",
            "success": [
                "Log three separate habit check-ins",
                "Document friction points and supports",
            ],
        },
        {
            "focus": "Add accountability layers",
            "success": [
                "Share progress with a supportive person",
                "Adjust ritual based on energy levels",
            ],
        },
        {
            "focus": "Reflect and reinforce",
            "success": [
                "Note what makes the habit rewarding",
                "Commit to one tweak for the next cycle",
            ],
        },
    ],
    "project": [
        {
            "focus": "Define scope and guardrails",
            "success": [
                "Document the goal, constraints, and done criteria",
                "Outline the first deliverables",
            ],
        },
        {
            "focus": "Ship the first thin slice",
            "success": [
                "Complete a testable slice of the project",
                "Collect quick feedback",
            ],
        },
        {
            "focus": "Expand coverage",
            "success": [
                "Hit a milestone that unlocks external review",
                "Remove at least one known blocker",
            ],
        },
        {
            "focus": "Stabilize and prep handoff",
            "success": [
                "Polish and document the current state",
                "List next priorities for future cycles",
            ],
        },
    ],
    "learning": [
        {
            "focus": "Set learning goals and resources",
            "success": [
                "Pick a primary resource path",
                "Block recurring study windows",
            ],
        },
        {
            "focus": "Practice core skills",
            "success": [
                "Complete two deliberate practice sessions",
                "Summarize key takeaways",
            ],
        },
        {
            "focus": "Apply and test",
            "success": [
                "Create a small artifact or quiz yourself",
                "Note strengths plus gaps",
            ],
        },
        {
            "focus": "Integrate learnings",
            "success": [
                "Teach or explain the topic to someone else",
                "Plan the next unit or challenge",
            ],
        },
    ],
    "health": [
        {
            "focus": "Gather baselines and supports",
            "success": [
                "Track current routines or symptoms",
                "Line up supportive gear or people",
            ],
        },
        {
            "focus": "Introduce small upgrades",
            "success": [
                "Complete gentle movement or nourishment goals",
                "Record how your body responds",
            ],
        },
        {
            "focus": "Progress the load safely",
            "success": [
                "Increase duration or intensity slightly",
                "Check in with rest and recovery",
            ],
        },
        {
            "focus": "Celebrate and adjust",
            "success": [
                "Note wins and energy shifts",
                "Set next focus for the following block",
            ],
        },
    ],
    "finance": [
        {
            "focus": "Clarify money picture",
            "success": [
                "Review accounts and recurring expenses",
                "Define a supportive weekly check-in",
            ],
        },
        {
            "focus": "Tune the system",
            "success": [
                "Create or update a light budget",
                "Automate one helpful transfer",
            ],
        },
        {
            "focus": "Execute saving or payoff steps",
            "success": [
                "Complete planned transfers or payments",
                "Log emotional/energy notes",
            ],
        },
        {
            "focus": "Review and rebalance",
            "success": [
                "Compare plan vs reality",
                "Choose a gentle tweak for next month",
            ],
        },
    ],
    "other": [
        {
            "focus": "Understand the goal and context",
            "success": [
                "Write down the reason this matters",
                "Define what success would look like",
            ],
        },
        {
            "focus": "Make steady progress",
            "success": [
                "Complete at least two small deliverables",
                "Capture learnings as you go",
            ],
        },
        {
            "focus": "Remove friction",
            "success": [
                "Identify blockers and propose fixes",
                "Ask for any support needed",
            ],
        },
        {
            "focus": "Lock in momentum",
            "success": [
                "Summarize what worked",
                "Choose next focus areas",
            ],
        },
    ],
}

TASK_TEMPLATES = {
    "habit": [
        {
            "title": "Pick the cue and location for “{title}”",
            "duration_min": 15,
            "notes": "Write the cue, environment, and support you’ll use.",
        },
        {
            "title": "Do a gentle rehearsal of “{title}”",
            "duration_min": 20,
            "notes": "Complete one light version and note how it feels.",
        },
        {
            "title": "Log reflections after the first reps",
            "duration_min": 10,
            "notes": "Capture what made it easier or harder.",
        },
    ],
    "project": [
        {
            "title": "Outline the scope for “{title}”",
            "duration_min": 30,
            "notes": "List goals, constraints, and a thin first slice.",
        },
        {
            "title": "Deliver a 1-hour prototype task",
            "duration_min": 45,
            "notes": "Build the smallest piece that proves direction.",
        },
        {
            "title": "Plan the next milestone checkpoint",
            "duration_min": 20,
            "notes": "Decide what done looks like for Week 2.",
        },
    ],
    "learning": [
        {
            "title": "Choose primary learning materials for “{title}”",
            "duration_min": 25,
            "notes": "Pick the course, book, or mentor notes you’ll use.",
        },
        {
            "title": "Schedule two 30-minute study blocks",
            "duration_min": 15,
            "notes": "Block the time on your calendar.",
        },
        {
            "title": "Take a quick baseline quiz or summary",
            "duration_min": 20,
            "notes": "Write what you already know and questions you have.",
        },
    ],
    "health": [
        {
            "title": "Capture current habits tied to “{title}”",
            "duration_min": 20,
            "notes": "Note sleep, energy, or other baselines.",
        },
        {
            "title": "Prep environment or gear",
            "duration_min": 15,
            "notes": "Lay out clothes, fill water, or ready the space.",
        },
        {
            "title": "Do one compassionate session",
            "duration_min": 30,
            "notes": "Keep it approachable and note how your body feels.",
        },
    ],
    "finance": [
        {
            "title": "Review last month’s spending for “{title}”",
            "duration_min": 25,
            "notes": "Tag recurring expenses and essentials.",
        },
        {
            "title": "Draft a simple weekly money check-in ritual",
            "duration_min": 15,
            "notes": "Decide when and where it happens.",
        },
        {
            "title": "Automate or schedule the first transfer",
            "duration_min": 20,
            "notes": "Set up the payment or savings move safely.",
        },
    ],
    "other": [
        {
            "title": "Write a lightweight brief for “{title}”",
            "duration_min": 25,
            "notes": "Capture the why, audience, and success signals.",
        },
        {
            "title": "Complete a 30-minute starter action",
            "duration_min": 30,
            "notes": "Pick something obvious to break inertia.",
        },
        {
            "title": "Reflect and log what you learned",
            "duration_min": 15,
            "notes": "Note questions to bring into Week 2.",
        },
    ],
}


def decompose_resolution(
    raw_text: str | None,
    title: str,
    current_type: str | None,
    plan_weeks: int,
) -> DecompositionResult:
    """Return the deterministic plan and week-one tasks."""
    source_text = raw_text or title
    derived_type = current_type or "other"
    if derived_type == "other":
        derived_type = classify_resolution_type(source_text)
    plan = _build_plan(derived_type, plan_weeks)
    tasks = _build_week_one_tasks(derived_type, title)
    return DecompositionResult(plan=plan, week_one_tasks=tasks, resolution_type=derived_type)


def _build_plan(resolution_type: str, plan_weeks: int) -> Dict[str, Any]:
    template = PLAN_TEMPLATES.get(resolution_type, PLAN_TEMPLATES["other"])
    milestones: List[Dict[str, Any]] = []
    for week in range(1, plan_weeks + 1):
        template_idx = min(week - 1, len(template) - 1)
        focus = template[template_idx]["focus"]
        success_templates = template[template_idx]["success"]
        success_items = [item for item in success_templates]
        milestones.append({"week": week, "focus": focus, "success_criteria": success_items})
    return {"weeks": plan_weeks, "milestones": milestones}


def _build_week_one_tasks(resolution_type: str, title: str) -> List[DraftTaskSpec]:
    template = TASK_TEMPLATES.get(resolution_type, TASK_TEMPLATES["other"])
    specs: List[DraftTaskSpec] = []
    for task in template:
        metadata = {}
        if task.get("notes"):
            metadata["notes"] = task["notes"].format(title=title)
        specs.append(
            DraftTaskSpec(
                title=task["title"].format(title=title),
                duration_min=task.get("duration_min"),
                metadata=metadata,
            )
        )
    return specs[:4]
