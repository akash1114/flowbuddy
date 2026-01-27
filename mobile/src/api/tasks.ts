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
  resolution_id?: string;
};

export async function listTasks(userId: string, options: ListOptions = {}): Promise<{
  tasks: TaskItem[];
  requestId: string | null;
}> {
  const params = new URLSearchParams({ user_id: userId });
  if (options.status) params.append("status", options.status);
  if (options.from) params.append("from", options.from);
  if (options.to) params.append("to", options.to);
  if (options.resolution_id) params.append("resolution_id", options.resolution_id);

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

export async function getTask(taskId: string, userId: string): Promise<TaskItem> {
  const params = new URLSearchParams({ user_id: userId });
  const { data } = await apiRequest<TaskItem>(`/tasks/${taskId}?${params.toString()}`);
  return data;
}

export async function deleteTask(taskId: string, userId: string): Promise<void> {
  const params = new URLSearchParams({ user_id: userId });
  await apiRequest<null>(`/tasks/${taskId}?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function updateTask(
  taskId: string,
  userId: string,
  payload: {
    title?: string;
    completed?: boolean;
    scheduled_day?: string | null;
    scheduled_time?: string | null;
    note?: string | null;
  },
): Promise<TaskItem> {
  const { data } = await apiRequest<TaskItem>(`/tasks/${taskId}/edit`, {
    method: "PATCH",
    body: { user_id: userId, ...payload },
  });
  return data;
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

export async function createTask(payload: {
  user_id: string;
  title: string;
  scheduled_day?: string | null;
  scheduled_time?: string | null;
  duration_min?: number | null;
  note?: string | null;
  resolution_id?: string | null;
}): Promise<TaskItem> {
  const body: Record<string, unknown> = {
    user_id: payload.user_id,
    title: payload.title,
  };
  if (payload.scheduled_day) body.scheduled_day = payload.scheduled_day;
  if (payload.scheduled_time) body.scheduled_time = payload.scheduled_time;
  if (typeof payload.duration_min === "number") body.duration_min = payload.duration_min;
  if (payload.note !== undefined) body.note = payload.note;
  if (payload.resolution_id) body.resolution_id = payload.resolution_id;

  const { data } = await apiRequest<TaskItem>("/tasks", {
    method: "POST",
    body,
  });
  return data;
}
