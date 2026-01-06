import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getWeeklyPlanLatest, runWeeklyPlan, WeeklyPlanResponse } from "../api/weeklyPlan";
import { useUserId } from "../state/user";

export default function WeeklyPlanScreen() {
  const { userId, loading: userLoading } = useUserId();
  const [plan, setPlan] = useState<WeeklyPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);

  const fetchPlan = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { plan: data, requestId: reqId, notFound: none } = await getWeeklyPlanLatest(userId);
      setPlan(data);
      setRequestId(reqId);
      setNotFound(none);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load weekly plan.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userLoading && userId) {
      fetchPlan();
    }
  }, [fetchPlan, userId, userLoading]);

  const handleGenerate = async () => {
    if (!userId) return;
    setRunning(true);
    setError(null);
    try {
      const { plan: data, requestId: reqId } = await runWeeklyPlan(userId);
      setPlan(data);
      setRequestId(reqId);
      setNotFound(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate weekly plan.");
    } finally {
      setRunning(false);
    }
  };

  if (userLoading || loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.helper}>Fetching your weekly snapshot…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPlan(); }} />}
    >
      <Text style={styles.title}>Weekly Plan</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {plan ? (
        <View style={styles.card}>
          <Text style={styles.week}>{plan.week.start} → {plan.week.end}</Text>
          <Text style={styles.sectionLabel}>Focus</Text>
          <Text style={styles.planTitle}>{plan.micro_resolution.title}</Text>
          <Text style={styles.body}>{plan.micro_resolution.why_this}</Text>

          <Text style={[styles.sectionLabel, styles.mt16]}>Suggested Tasks</Text>
          {plan.micro_resolution.suggested_week_1_tasks.map((task) => (
            <View key={task.title} style={styles.taskRow}>
              <Text style={styles.taskTitle}>{task.title}</Text>
              <Text style={styles.taskMeta}>
                {task.duration_min ? `${task.duration_min} min` : "Flexible"}
                {task.suggested_time ? ` · ${task.suggested_time}` : ""}
              </Text>
            </View>
          ))}

          <View style={styles.debugBox}>
            <Text style={styles.debugLabel}>Req ID: {requestId || plan.request_id || "—"}</Text>
            <Text style={styles.debugLabel}>Completion: {(plan.inputs.completion_rate * 100).toFixed(0)}%</Text>
          </View>
        </View>
      ) : null}

      {!plan && notFound ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No weekly plan yet</Text>
          <Text style={styles.helper}>When you’re ready, generate a gentle focus for next week.</Text>
          <TouchableOpacity style={[styles.button, running && styles.buttonDisabled]} onPress={handleGenerate} disabled={running}>
            {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Generate Weekly Plan</Text>}
          </TouchableOpacity>
        </View>
      ) : null}

      {plan ? (
        <TouchableOpacity style={[styles.button, running && styles.buttonDisabled]} onPress={handleGenerate} disabled={running}>
          {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Refresh Plan</Text>}
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: "#111",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e7f0",
    padding: 16,
    backgroundColor: "#fff",
  },
  week: {
    fontWeight: "600",
    color: "#1a73e8",
    marginBottom: 8,
  },
  sectionLabel: {
    fontWeight: "600",
    marginTop: 8,
    color: "#333",
  },
  planTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 4,
  },
  body: {
    marginTop: 6,
    color: "#444",
  },
  mt16: {
    marginTop: 16,
  },
  taskRow: {
    marginTop: 8,
  },
  taskTitle: {
    fontWeight: "500",
    color: "#222",
  },
  taskMeta: {
    color: "#666",
    fontSize: 12,
  },
  button: {
    marginTop: 12,
    backgroundColor: "#1a73e8",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonDisabled: {
    backgroundColor: "#8fb5f8",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  helper: {
    marginTop: 8,
    color: "#666",
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dfe3ec",
    padding: 16,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111",
  },
  error: {
    color: "#c62828",
  },
  debugBox: {
    marginTop: 16,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#f3f4f8",
  },
  debugLabel: {
    fontSize: 12,
    color: "#555",
  },
});
