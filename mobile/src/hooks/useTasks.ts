import { useCallback, useEffect, useRef, useState } from "react";
import { listTasks, TaskItem } from "../api/tasks";

type UseTasksOptions = {
  status?: "active" | "draft" | "all";
  from?: string;
  to?: string;
  auto?: boolean;
};

export function useTasks(userId: string | null, options: UseTasksOptions = {}) {
  const { status = "active", from, to, auto = true } = options;
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchTasks = useCallback(async () => {
    if (!userId) {
      setError("Missing user id.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { tasks: items, requestId: reqId } = await listTasks(userId, { status, from, to });
      if (!isMounted.current) return;
      setTasks(items);
      setRequestId(reqId);
    } catch (err) {
      if (!isMounted.current) return;
      setError(err instanceof Error ? err.message : "Unable to load tasks right now.");
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [userId, status, from, to]);

  useEffect(() => {
    if (!auto || !userId) {
      return;
    }
    fetchTasks();
  }, [auto, userId, fetchTasks]);

  return {
    tasks,
    loading,
    error,
    requestId,
    refetch: fetchTasks,
    setTasks,
    setError,
  };
}
