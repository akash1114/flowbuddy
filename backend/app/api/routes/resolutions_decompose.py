"""Resolution decomposition endpoint."""
from __future__ import annotations

from datetime import date, datetime, time, timezone
from time import perf_counter
from typing import Any, Dict, List
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.schemas.decomposition import (
    DecompositionRequest,
    DecompositionResponse,
    PlanMilestone,
    PlanPayload,
    WeekPlanSection,
)
from app.db.deps import get_db
from app.db.models.resolution import Resolution
from app.db.models.user import User
from app.db.models.task import Task
from app.observability.metrics import log_metric
from app.observability.tracing import trace
from app.services.resolution_decomposer import (
    decompose_resolution_with_llm,
    _fallback_plan,
)
from app.services.effort_band import infer_effort_band
from app.services.resolution_tasks import (
    delete_existing_draft_tasks,
    fetch_draft_tasks,
    serialize_draft_task,
)

router = APIRouter()


@router.post(
    "/resolutions/{resolution_id}/decompose",
    response_model=DecompositionResponse,
    tags=["resolutions"],
)
def decompose_resolution_endpoint(
    resolution_id: UUID,
    http_request: Request,
    payload: DecompositionRequest | None = None,
    db: Session = Depends(get_db),
) -> DecompositionResponse:
    """Generate or return a multi-week plan plus draft week-one tasks."""
    params = payload or DecompositionRequest()
    resolution = db.get(Resolution, resolution_id)
    if not resolution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resolution not found")

    request_id = getattr(http_request.state, "request_id", None)
    user = db.get(User, resolution.user_id)
    availability_profile = getattr(user, "availability_profile", None) if user else None
    resolution_domain = (resolution.domain or "personal") if hasattr(resolution, "domain") else "personal"
    metadata = dict(resolution.metadata_json or {})
    user_text = metadata.get("original_text") or metadata.get("raw_text") or resolution.title
    plan_weeks = _resolve_plan_weeks(params.weeks, resolution.duration_weeks)
    effort_band, band_rationale = infer_effort_band(user_text, resolution.type, plan_weeks)
    regenerate = params.regenerate
    resolution_category = resolution.category or metadata.get("category")

    base_metadata: Dict[str, Any] = {
        "route": f"/resolutions/{resolution_id}/decompose",
        "resolution_id": str(resolution_id),
        "user_id": str(resolution.user_id),
        "request_id": request_id,
        "domain": resolution_domain,
        "llm_input_text": user_text[:500],
    }

    start_time = perf_counter()
    success = False
    tasks_generated = 0
    plan_dict: Dict[str, Any] | None = None
    task_models: List[Task] = []
    weeks_data: List[Dict[str, Any]] = []

    try:
        with trace(
            "resolution.decomposition",
            metadata=base_metadata,
            user_id=str(resolution.user_id),
            request_id=request_id,
        ) as decomposition_trace:
            existing_plan = metadata.get("plan_v1")
            existing_tasks = fetch_draft_tasks(db, resolution.id)

            if existing_plan and existing_tasks and not regenerate:
                plan_dict = existing_plan
                task_models = existing_tasks
                weeks_data = _ensure_week_sections_have_ids(
                    _merge_week_sections(
                        plan_dict,
                        metadata.get("plan_weeks_detail"),
                        task_models,
                    )
                )
                if metadata.get("plan_weeks_detail") != weeks_data:
                    metadata["plan_weeks_detail"] = weeks_data
                    resolution.metadata_json = metadata
                    db.add(resolution)
                    db.commit()
            else:
                plan_dict = decompose_resolution_with_llm(
                    user_text,
                    plan_weeks,
                    resolution_type=resolution.type,
                    resolution_category=resolution_category,
                    user_context=metadata.get("user_context"),
                    effort_band=effort_band,
                    band_rationale=band_rationale,
                    request_id=request_id,
                    resolution_domain=resolution_domain,
                    availability_profile=availability_profile,
                )
                metadata["plan_v1"] = plan_dict
                metadata["why_this"] = plan_dict.get("why_this_matters")
                metadata["plan_generated_at"] = datetime.now(timezone.utc).isoformat()
                metadata.setdefault("original_text", user_text)

                resolution.metadata_json = metadata
                resolution.title = plan_dict.get("resolution_title", resolution.title)
                resolution.duration_weeks = plan_dict.get("duration_weeks") or plan_weeks

                if regenerate:
                    delete_existing_draft_tasks(db, resolution.id)

                tasks = _create_tasks_from_plan(resolution, plan_dict.get("week_1_tasks", []))
                tasks_generated = len(tasks)
                for task in tasks:
                    db.add(task)
                weeks_data = _ensure_week_sections_have_ids(_build_week_sections(plan_dict, tasks))
                metadata["plan_weeks_detail"] = weeks_data
                resolution.metadata_json = metadata
                db.add(resolution)
                db.commit()
                task_models = fetch_draft_tasks(db, resolution.id)
            if decomposition_trace and plan_dict:
                evaluation_summary = plan_dict.get("evaluation_summary") or {}
                summary_text = plan_dict.get("resolution_title") or ""
                seen_titles = []
                for task in plan_dict.get("week_1_tasks", []) or []:
                    title = task.get("title")
                    if title and title not in seen_titles:
                        seen_titles.append(title)
                trimmed_titles = seen_titles[:4]
                if trimmed_titles:
                    summary_text = f"{summary_text} | Week 1: {', '.join(trimmed_titles)}"
                decomposition_trace.update(
                    metadata={
                        "llm_input_text": user_text[:500],
                        "llm_output": {
                            "plan_title": plan_dict.get("resolution_title"),
                            "why_this": plan_dict.get("why_this_matters"),
                            "week_1_titles": trimmed_titles,
                        },
                        "llm_output_text": summary_text.strip()[:500],
                        "evaluation": evaluation_summary,
                    }
                )
            success = True
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store decomposition",
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error while generating plan",
        ) from exc
    finally:
        latency_ms = (perf_counter() - start_time) * 1000
        metric_metadata = {
            "resolution_id": str(resolution_id),
            "user_id": str(resolution.user_id),
            "regenerate": regenerate,
            "tasks_generated": tasks_generated,
        }
        if resolution.duration_weeks is not None:
            metric_metadata["duration_weeks"] = resolution.duration_weeks
        log_metric("resolution.decomposition.success", 1 if success else 0, metadata=metric_metadata)
        log_metric("resolution.decomposition.tasks_generated", tasks_generated, metadata=metric_metadata)
        log_metric("resolution.decomposition.latency_ms", latency_ms, metadata=metric_metadata)

    plan_payload = _build_plan_payload(plan_dict)
    if not weeks_data:
        weeks_data = _merge_week_sections(plan_dict or {}, metadata.get("plan_weeks_detail"), task_models)
    weeks_data = _ensure_week_sections_have_ids(weeks_data)
    if metadata.get("plan_weeks_detail") != weeks_data:
        metadata["plan_weeks_detail"] = weeks_data
        resolution.metadata_json = metadata
        db.add(resolution)
        db.commit()
        db.refresh(resolution)
    task_payload = [serialize_draft_task(task) for task in task_models]

    return DecompositionResponse(
        resolution_id=resolution.id,
        user_id=resolution.user_id,
        title=resolution.title,
        type=resolution.type,
        duration_weeks=resolution.duration_weeks,
        plan=plan_payload,
        week_1_tasks=task_payload,
        weeks=[WeekPlanSection(**section) for section in weeks_data],
        request_id=request_id or "",
    )


def _create_tasks_from_plan(resolution: Resolution, tasks_data: List[Dict[str, Any]]) -> List[Task]:
    created: List[Task] = []
    for entry in tasks_data:
        note = entry.get("note")
        metadata = {
            "draft": True,
            "source": "ai_decomposer",
            "intent": entry.get("intent"),
            "cadence": entry.get("cadence"),
            "confidence": entry.get("confidence"),
        }
        if isinstance(note, str) and note.strip():
            metadata["note"] = note.strip()
        duration_value = (
            entry.get("estimated_duration_min")
            if isinstance(entry.get("estimated_duration_min"), (int, float))
            else entry.get("duration_min")
        )
        suggested_day = entry.get("suggested_day") or entry.get("scheduled_day")
        suggested_time = entry.get("suggested_time") or entry.get("scheduled_time")
        task = Task(
            user_id=resolution.user_id,
            resolution_id=resolution.id,
            title=entry.get("title") or "Week 1 task",
            duration_min=int(duration_value) if duration_value is not None else None,
            scheduled_day=_parse_date(suggested_day),
            scheduled_time=_parse_time(suggested_time),
            metadata_json=metadata,
        )
        created.append(task)
    return created


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _parse_time(value: str | None) -> time | None:
    if not value:
        return None
    try:
        return time.fromisoformat(value)
    except ValueError:
        return None


def _format_time(value: time | None) -> str | None:
    if not value:
        return None
    return value.strftime("%H:%M")


def _build_plan_payload(plan: Dict[str, Any] | None) -> PlanPayload:
    if not isinstance(plan, dict):
        return PlanPayload(weeks=8, milestones=[])
    if "weeks" in plan and "milestones" in plan:
        try:
            return PlanPayload(**plan)
        except Exception:  # pragma: no cover - defensive conversion
            pass

    milestones = []
    for entry in plan.get("milestones", []):
        week = entry.get("week_number") or entry.get("week")
        focus = entry.get("focus_summary") or entry.get("focus")
        success = entry.get("success_criteria") or []
        if week is None or focus is None:
            continue
        milestones.append(PlanMilestone(week=week, focus=focus, success_criteria=list(success)))

    total_weeks = plan.get("duration_weeks") or (milestones[-1].week if milestones else None) or 8
    if not milestones:
        milestones = [
            PlanMilestone(week=1, focus="Establish a kind baseline", success_criteria=[]),
        ]
    return PlanPayload(weeks=total_weeks, milestones=milestones)


def _build_week_sections(plan: Dict[str, Any], tasks: List[Task]) -> List[Dict[str, Any]]:
    plan_payload = _build_plan_payload(plan) or PlanPayload(weeks=8, milestones=[])
    focus_map = {m.week: m.focus for m in plan_payload.milestones}
    plan_weeks_raw = plan.get("weeks") or []
    plan_tasks_map: Dict[int, List[Dict[str, Any]]] = {}
    for entry in plan_weeks_raw:
        if isinstance(entry, dict):
            week_idx = entry.get("week") or entry.get("week_number")
            if isinstance(week_idx, int):
                plan_tasks_map[week_idx] = [
                    _serialize_plan_task(task_dict) for task_dict in entry.get("tasks", []) if isinstance(task_dict, dict)
                ]

    sections: List[Dict[str, Any]] = []
    serialized_tasks = [_serialize_week_task(task) for task in tasks]
    for week_num in range(1, plan_payload.weeks + 1):
        sections.append(
            {
                "week": week_num,
                "focus": focus_map.get(week_num, ""),
                "tasks": serialized_tasks if week_num == 1 else plan_tasks_map.get(week_num, []),
            }
        )
    return sections


def _merge_week_sections(
    plan: Dict[str, Any],
    stored_sections: Any,
    tasks: List[Task],
) -> List[Dict[str, Any]]:
    base_sections = stored_sections if isinstance(stored_sections, list) else []
    plan_payload = _build_plan_payload(plan) or PlanPayload(weeks=8, milestones=[])
    focus_map = {m.week: m.focus for m in plan_payload.milestones}
    serialized_tasks = [_serialize_week_task(task) for task in tasks]
    section_map = {entry.get("week"): entry for entry in base_sections if isinstance(entry, dict)}
    merged: List[Dict[str, Any]] = []
    for week_num in range(1, plan_payload.weeks + 1):
        existing = section_map.get(week_num, {})
        focus_value = existing.get("focus") or focus_map.get(week_num, "")
        tasks_value = serialized_tasks if week_num == 1 else existing.get("tasks", [])
        merged.append(
            {
                "week": week_num,
                "focus": focus_value,
                "tasks": tasks_value,
            }
        )
    return merged


def _ensure_week_sections_have_ids(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for entry in sections or []:
        tasks_with_ids: List[Dict[str, Any]] = []
        for task in entry.get("tasks", []):
            task_dict = dict(task)
            task_dict["id"] = _normalize_task_id(task_dict.get("id"))
            tasks_with_ids.append(task_dict)
        normalized.append(
            {
                "week": entry.get("week"),
                "focus": entry.get("focus", ""),
                "tasks": tasks_with_ids,
            }
        )
    return normalized


def _serialize_week_task(task: Task) -> Dict[str, Any]:
    metadata = task.metadata_json or {}
    return {
        "id": str(task.id),
        "title": task.title,
        "scheduled_day": task.scheduled_day.isoformat() if task.scheduled_day else None,
        "scheduled_time": _format_time(task.scheduled_time),
        "duration_min": task.duration_min,
        "draft": True,
        "intent": metadata.get("intent"),
        "cadence": metadata.get("cadence"),
        "confidence": metadata.get("confidence"),
        "note": metadata.get("note"),
    }


def _serialize_plan_task(task: Dict[str, Any]) -> Dict[str, Any]:
    duration = task.get("estimated_duration_min") or task.get("duration_min")
    day_raw = task.get("suggested_day") or task.get("scheduled_day")
    time_raw = task.get("suggested_time") or task.get("scheduled_time")
    day = day_raw if _is_iso_date(day_raw) else None
    time_value = time_raw if _is_time_string(time_raw) else None
    return {
        "id": _normalize_task_id(task.get("id")),
        "title": task.get("title") or "Upcoming task",
        "scheduled_day": day,
        "scheduled_time": time_value,
        "duration_min": duration,
        "draft": True,
        "intent": task.get("intent"),
        "cadence": task.get("cadence"),
        "confidence": task.get("confidence"),
        "note": task.get("note"),
    }


def _normalize_task_id(raw_id) -> str:
    try:
        if raw_id:
            return str(UUID(str(raw_id)))
    except Exception:
        pass
    return str(uuid4())


def _is_iso_date(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def _is_time_string(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        time.fromisoformat(value)
        return True
    except ValueError:
        return False


def _resolve_plan_weeks(request_weeks: int | None, duration_weeks: int | None) -> int:
    if request_weeks:
        return max(4, min(12, request_weeks))
    if duration_weeks:
        return max(4, min(12, duration_weeks))
    return 8
