import { apiRequest } from "./client";

export type AgentLogListItem = {
  id: string;
  created_at: string;
  action_type: string;
  undo_available: boolean;
  summary: string;
  request_id: string | null;
};

export type AgentLogListResult = {
  items: AgentLogListItem[];
  nextCursor: string | null;
  requestId: string | null;
};

type AgentLogListResponse = {
  user_id: string;
  items: AgentLogListItem[];
  next_cursor: string | null;
  request_id: string;
};

export async function listAgentLog(
  userId: string,
  options: { limit?: number; cursor?: string | null; actionType?: string | null } = {},
): Promise<AgentLogListResult> {
  const params = new URLSearchParams();
  params.append("user_id", userId);
  params.append("limit", String(options.limit ?? 20));
  if (options.cursor) {
    params.append("cursor", options.cursor);
  }
  if (options.actionType) {
    params.append("action_type", options.actionType);
  }

  const { data, response } = await apiRequest<AgentLogListResponse>(`/agent-log?${params.toString()}`);
  return {
    items: data.items,
    nextCursor: data.next_cursor,
    requestId: data.request_id || response.headers.get("X-Request-Id"),
  };
}

export type AgentLogDetail = {
  id: string;
  user_id: string;
  created_at: string;
  action_type: string;
  undo_available: boolean;
  payload: Record<string, unknown>;
  summary: string;
  request_id: string | null;
  request_id_header: string;
};

type AgentLogDetailResponse = AgentLogDetail;

export async function getAgentLogItem(userId: string, logId: string): Promise<{
  item: AgentLogDetailResponse;
  requestId: string | null;
}> {
  const { data, response } = await apiRequest<AgentLogDetailResponse>(`/agent-log/${logId}?user_id=${userId}`);
  const headerId = response.headers.get("X-Request-Id");
  return {
    item: data,
    requestId: data.request_id || data.request_id_header || headerId,
  };
}
