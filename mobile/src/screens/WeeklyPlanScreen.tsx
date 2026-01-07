import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import { Sun, Coffee, Circle } from "lucide-react-native";
import { getWeeklyPlanLatest, runWeeklyPlan, WeeklyPlanResponse } from "../api/weeklyPlan";
import { useUserId } from "../state/user";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../types/navigation";

type WeeklyPlanNav = NativeStackNavigationProp<RootStackParamList, "WeeklyPlan">;

export default function WeeklyPlanScreen() {
  const { userId, loading: userLoading } = useUserId();
  const navigation = useNavigation<WeeklyPlanNav>();
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

  if ((userLoading || loading) && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6B8DBF" />
        <Text style={styles.helper}>Fetching your weekly snapshot…</Text>
      </View>
    );
  }

  const dateLabel = plan ? formatRange(plan.week.start, plan.week.end) : "";

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPlan(); }} />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Weekly Plan</Text>
        <TouchableOpacity style={styles.linkButton} onPress={() => navigation.navigate("WeeklyPlanHistory")}>
          <Text style={styles.linkText}>History</Text>
        </TouchableOpacity>
      </View>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchPlan}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {plan ? (
        <>
          <View style={styles.focusCard}>
            <Text style={styles.dateLabel}>{dateLabel}</Text>
            <Text style={styles.focusTitle}>{plan.micro_resolution.title}</Text>
            <Text style={styles.focusBody}>{plan.micro_resolution.why_this}</Text>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Suggested Actions</Text>
          </View>
          {plan.micro_resolution.suggested_week_1_tasks.map((task) => (
            <View key={task.title} style={styles.taskRow}>
              <Circle size={10} color="#6B8DBF" />
              <View style={styles.taskContent}>
                <Text style={styles.taskTitle}>{task.title}</Text>
                <Text style={styles.taskMeta}>
                  {task.duration_min ? `${task.duration_min} min` : "Flexible"}
                  {task.suggested_time ? ` · ${task.suggested_time}` : ""}
                </Text>
              </View>
            </View>
          ))}

          <View style={styles.debugBox}>
            <Text style={styles.debugLabel}>Req ID: {requestId || plan.request_id || "—"}</Text>
            <Text style={styles.debugLabel}>Completion: {(plan.inputs.completion_rate * 100).toFixed(0)}%</Text>
          </View>
        </>
      ) : null}

      {!plan ? (
        <View style={styles.emptyState}>
          <Sun size={48} color="#FDBA74" />
          <Text style={styles.emptyTitle}>Ready to plan your week?</Text>
          <Text style={styles.helper}>Let&apos;s find your focus.</Text>
          <TouchableOpacity
            style={[styles.button, running && styles.buttonDisabled]}
            onPress={handleGenerate}
            disabled={running}
          >
            {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Generate Plan</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

function formatRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const upper = (date: Date) => formatter.format(date).toUpperCase();
  return `${upper(startDate)} – ${upper(endDate)}`;
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#FAFAF8",
    gap: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#FAFAF8",
  },
  title: {
    fontSize: 30,
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    color: "#2D3748",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  linkButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  linkText: {
    color: "#6B8DBF",
    fontWeight: "600",
  },
  focusCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "#F3F4F6",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    marginBottom: 12,
  },
  dateLabel: {
    fontSize: 12,
    textTransform: "uppercase",
    color: "#6B7280",
    letterSpacing: 1,
  },
  focusTitle: {
    fontSize: 28,
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    color: "#1F2933",
    marginTop: 8,
  },
  focusBody: {
    marginTop: 12,
    color: "#6B7280",
    fontStyle: "italic",
    fontSize: 16,
  },
  sectionHeader: {
    marginTop: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1F2933",
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#F3F4F6",
    marginBottom: 8,
    gap: 12,
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontWeight: "600",
    color: "#1F2933",
  },
  taskMeta: {
    color: "#6B7280",
    marginTop: 4,
  },
  button: {
    marginTop: 16,
    backgroundColor: "#6B8DBF",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  buttonDisabled: {
    backgroundColor: "#A5B8D9",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  helper: {
    marginTop: 8,
    color: "#6B7280",
    textAlign: "center",
  },
  emptyState: {
    marginTop: 24,
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FDEAD8",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1F2933",
    marginTop: 12,
  },
  error: {
    color: "#c62828",
  },
  errorBox: {
    backgroundColor: "#fdecea",
    borderRadius: 12,
    padding: 12,
  },
  retryButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c62828",
  },
  retryText: {
    color: "#c62828",
    fontWeight: "600",
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
    textAlign: "center",
  },
});
