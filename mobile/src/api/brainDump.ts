import { apiRequest } from "./client";

export type BrainDumpSignals = {
  emotional_state: string | null;
  blockers: string[];
  resolution_refs: string[];
  intent_shift: string | null;
};

export type BrainDumpResponse = {
  id: string;
  acknowledgement: string;
  signals: BrainDumpSignals;
  actionable: boolean;
};

export type BrainDumpRequest = {
  user_id: string;
  text: string;
};

export async function submitBrainDump(payload: BrainDumpRequest): Promise<{
  response: BrainDumpResponse;
  requestId: string | null;
}> {
  const { data, response } = await apiRequest<BrainDumpResponse>("/brain-dump", {
    method: "POST",
    body: payload,
  });

  return {
    response: data,
    requestId: response.headers.get("X-Request-Id"),
  };
}
