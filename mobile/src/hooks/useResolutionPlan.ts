import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decomposeResolution,
  getResolution,
  PlanMilestone,
  ResolutionDetail,
  ResolutionResponse,
  WeekOneTask,
} from "../api/resolutions";

export type PlanData = {
  title: string;
  type: string;
  duration_weeks: number | null;
  plan: {
    weeks: number;
    milestones: PlanMilestone[];
  };
};

export type EditableTask = {
  id: string;
  title: string;
  scheduled_day: string;
  scheduled_time: string;
  duration_min: string;
  original: WeekOneTask;
};

type UseResolutionPlanArgs = {
  resolutionId: string;
  userId: string | null;
  initialResolution?: ResolutionResponse;
};

export function useResolutionPlan({ resolutionId, userId, initialResolution }: UseResolutionPlanArgs) {
  const [plan, setPlan] = useState<PlanData | null>(() => {
    if (!initialResolution) return null;
    return {
      title: initialResolution.title,
      type: initialResolution.type,
      duration_weeks: initialResolution.duration_weeks,
      plan: {
        weeks: initialResolution.duration_weeks ?? 8,
        milestones: [],
      },
    };
  });
  const [tasks, setTasks] = useState<EditableTask[]>([]);
  const [loading, setLoading] = useState<boolean>(!initialResolution);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const defaultWeeks = useMemo(() => initialResolution?.duration_weeks ?? undefined, [initialResolution]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mapTasks = useCallback((rawTasks: WeekOneTask[]): EditableTask[] => {
    return rawTasks.map((task) => ({
      id: task.id,
      title: task.title,
      scheduled_day: task.scheduled_day ?? "",
      scheduled_time: task.scheduled_time ?? "",
      duration_min: task.duration_min != null ? String(task.duration_min) : "",
      original: task,
    }));
  }, []);

  const assignPlanData = useCallback(
    (resolution: ResolutionDetail) => {
      if (!mountedRef.current) return;
      setPlan({
        title: resolution.title,
        type: resolution.type,
        duration_weeks: resolution.duration_weeks,
        plan: resolution.plan || {
          weeks: resolution.duration_weeks ?? 8,
          milestones: [],
        },
      });
    },
    [],
  );

  const fetchPlan = useCallback(
    async ({ regenerate = false }: { regenerate?: boolean } = {}) => {
      if (!userId) {
        setError("Missing user id.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { resolution } = await getResolution(resolutionId, userId);
        const planData = resolution.plan;
        const hasDraftTasks = resolution.draft_tasks.length > 0;

        if (planData && hasDraftTasks && !regenerate) {
          assignPlanData(resolution);
          if (mountedRef.current) {
            setTasks(mapTasks(resolution.draft_tasks));
          }
          return;
        }

        const shouldDecompose = regenerate || !planData || !hasDraftTasks;
        if (shouldDecompose) {
          const body: { weeks?: number; regenerate?: boolean } = {};
          if (defaultWeeks && defaultWeeks >= 4 && defaultWeeks <= 12) {
            body.weeks = defaultWeeks;
          }
          if (regenerate) {
            body.regenerate = true;
          }
          const { result } = await decomposeResolution(resolutionId, body);
          if (mountedRef.current) {
            setPlan({
              title: result.title,
              type: result.type,
              duration_weeks: result.duration_weeks,
              plan: result.plan,
            });
            setTasks(mapTasks(result.week_1_tasks));
          }
        } else if (planData) {
          assignPlanData(resolution);
          if (mountedRef.current) {
            setTasks(mapTasks(resolution.draft_tasks));
          }
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Unable to load plan.");
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [userId, resolutionId, assignPlanData, defaultWeeks, mapTasks],
  );

  useEffect(() => {
    if (!userId) {
      return;
    }
    fetchPlan();
  }, [userId, fetchPlan]);

  const regenerate = useCallback(() => fetchPlan({ regenerate: true }), [fetchPlan]);

  return {
    plan,
    tasks,
    loading,
    error,
    setTasks,
    refetch: fetchPlan,
    regenerate,
  };
}
