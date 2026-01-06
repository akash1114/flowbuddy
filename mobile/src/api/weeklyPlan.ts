import { apiRequest } from "./client";

export type WeeklyPlanResponse = {
  user_id: string;
  week: { start: string; end: string };
  inputs: {
    active_resolutions: number;
    active_tasks_total: number;
    active_tasks_completed: number;
    completion_rate: number;
  };
  micro_resolution: {
    title: string;
    why_this: string;
    suggested_week_1_tasks: {
      title: string;
      duration_min: number | null;
      suggested_time: string | null;
    }[];
  };
  request_id: string;
};

type LatestResult = {
  plan: WeeklyPlanResponse | null;
  requestId: string | null;
  notFound: boolean;
};

export async function getWeeklyPlanLatest(userId: string): Promise<LatestResult> {
  try {
    const { data, response } = await apiRequest<WeeklyPlanResponse>(`/weekly-plan/latest?user_id=${userId}`);
    return { plan: data, requestId: data.request_id || response.headers.get("X-Request-Id"), notFound: false };
  } catch (error) {
    if (error instanceof Error && /404|not found|no weekly plan snapshot/i.test(error.message)) {
      return { plan: null, requestId: null, notFound: true };
    }
    throw error;
  }
}

export async function runWeeklyPlan(userId: string): Promise<{ plan: WeeklyPlanResponse; requestId: string | null }> {
  const { data, response } = await apiRequest<WeeklyPlanResponse>("/weekly-plan/run", {
    method: "POST",
    body: { user_id: userId },
  });
  return { plan: data, requestId: data.request_id || response.headers.get("X-Request-Id") };
}
