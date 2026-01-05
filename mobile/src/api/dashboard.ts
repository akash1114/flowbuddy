import { apiRequest } from "./client";

export type DashboardTaskStats = {
  total: number;
  completed: number;
  scheduled: number;
  unscheduled: number;
};

export type DashboardActivity = {
  task_id: string;
  title: string;
  completed: boolean;
  completed_at: string | null;
  note_present: boolean;
};

export type DashboardResolution = {
  resolution_id: string;
  title: string;
  type: string;
  duration_weeks: number | null;
  status: string;
  week: {
    start: string;
    end: string;
  };
  tasks: DashboardTaskStats;
  completion_rate: number;
  recent_activity: DashboardActivity[];
};

export type DashboardResponse = {
  user_id: string;
  active_resolutions: DashboardResolution[];
  request_id: string;
};

export async function fetchDashboard(userId: string): Promise<{
  dashboard: DashboardResponse;
  requestId: string | null;
}> {
  const { data, response } = await apiRequest<DashboardResponse>(`/dashboard?user_id=${userId}`);
  return {
    dashboard: data,
    requestId: data.request_id || response.headers.get("X-Request-Id"),
  };
}
