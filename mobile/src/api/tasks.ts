import { apiRequest } from "./client";

export type TaskItem = {
  id: string;
  resolution_id: string | null;
  title: string;
  scheduled_day: string | null;
  scheduled_time: string | null;
  duration_min: number | null;
  completed: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
  source: string;
};

export type TaskUpdateResponse = {
  id: string;
  completed: boolean;
  completed_at: string | null;
  request_id?: string;
};

export type TaskNoteUpdateResponse = {
  id: string;
  note: string | null;
  request_id: string;
};

type ListOptions = {
  status?: "active" | "draft" | "all";
  from?: string;
  to?: string;
};

export async function listTasks(userId: string, options: ListOptions = {}): Promise<{
  tasks: TaskItem[];
  requestId: string | null;
}> {
  const params = new URLSearchParams({ user_id: userId });
  if (options.status) params.append("status", options.status);
  if (options.from) params.append("from", options.from);
  if (options.to) params.append("to", options.to);

  const { data, response } = await apiRequest<TaskItem[]>(`/tasks?${params.toString()}`);
  return {
    tasks: data,
    requestId: response.headers.get("X-Request-Id"),
  };
}

export async function updateTaskCompletion(
  taskId: string,
  userId: string,
  completed: boolean,
): Promise<{ result: TaskUpdateResponse; requestId: string | null }> {
  const { data, response } = await apiRequest<TaskUpdateResponse>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: { user_id: userId, completed },
  });

  return {
    result: data,
    requestId: data.request_id || response.headers.get("X-Request-Id"),
  };
}

export async function updateTaskNote(
  taskId: string,
  userId: string,
  note: string | null,
): Promise<{ result: TaskNoteUpdateResponse; requestId: string | null }> {
  const { data, response } = await apiRequest<TaskNoteUpdateResponse>(`/tasks/${taskId}/note`, {
    method: "PATCH",
    body: { user_id: userId, note },
  });

  return {
    result: data,
    requestId: data.request_id || response.headers.get("X-Request-Id"),
  };
}
