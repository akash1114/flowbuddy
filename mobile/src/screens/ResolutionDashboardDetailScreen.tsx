import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../types/navigation";
import { fetchDashboard, DashboardResolution } from "../api/dashboard";
import { listTasks, TaskItem } from "../api/tasks";
import { useUserId } from "../state/user";

type Props = NativeStackScreenProps<RootStackParamList, "ResolutionDashboardDetail">;

export default function ResolutionDashboardDetailScreen({ route }: Props) {
  const { resolutionId } = route.params;
  const { userId, loading: userLoading } = useUserId();
  const [resolution, setResolution] = useState<DashboardResolution | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filterWeekTasks = useMemo(() => {
    if (!resolution) return { scheduled: [], unscheduled: [] as TaskItem[] };
    const start = new Date(resolution.week.start);
    const end = new Date(resolution.week.end);
    const weekTasks = tasks.filter((task) => task.resolution_id === resolutionId);
    const scheduled = weekTasks.filter((task) => {
      if (!task.scheduled_day) return false;
      const day = new Date(task.scheduled_day);
      return day >= start && day <= end;
    });
    const unscheduled = weekTasks.filter((task) => !task.scheduled_day);
    return { scheduled, unscheduled };
  }, [tasks, resolution, resolutionId]);

  const loadData = async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { dashboard } = await fetchDashboard(userId);
      const entry = dashboard.active_resolutions.find((item) => item.resolution_id === resolutionId) || null;
      setResolution(entry);
      const { tasks: list } = await listTasks(userId, { status: "active" });
      setTasks(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load this resolution.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userLoading && userId) {
      loadData();
    }
  }, [userLoading, userId]);

  if (userLoading || loading || !resolution) {
    return (
      <View style={styles.center}>
        {error ? (
          <>
            <Text style={styles.error}>{error}</Text>
            <Text style={styles.helper}>Pull down to retry.</Text>
          </>
        ) : (
          <>
            <ActivityIndicator />
            <Text style={styles.helper}>Loading resolution summary…</Text>
          </>
        )}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{resolution.title}</Text>
      <Text style={styles.meta}>
        {resolution.type} · {resolution.duration_weeks ?? "Flexible"} weeks
      </Text>
      <Text style={styles.helper}>
        Current week: {resolution.week.start} – {resolution.week.end}
      </Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Progress</Text>
        <Text style={styles.body}>
          {resolution.tasks.completed}/{resolution.tasks.total} tasks completed (
          {Math.round(resolution.completion_rate * 100)}%)
        </Text>
        <Text style={styles.body}>
          Scheduled this week: {resolution.tasks.scheduled} · Unscheduled: {resolution.tasks.unscheduled}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Scheduled this week</Text>
        {filterWeekTasks.scheduled.length ? (
          filterWeekTasks.scheduled.map((task) => (
            <View key={task.id} style={styles.taskRow}>
              <Text style={[styles.taskTitle, task.completed && styles.completed]}>{task.title}</Text>
              <Text style={styles.taskMeta}>
                {task.scheduled_day} {task.scheduled_time ? `· ${task.scheduled_time}` : ""}
              </Text>
              {task.note ? <Text style={styles.noteText}>Note: {task.note}</Text> : null}
            </View>
          ))
        ) : (
          <Text style={styles.helper}>No scheduled tasks this week.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Unscheduled</Text>
        {filterWeekTasks.unscheduled.length ? (
          filterWeekTasks.unscheduled.map((task) => (
            <View key={task.id} style={styles.taskRow}>
              <Text style={[styles.taskTitle, task.completed && styles.completed]}>{task.title}</Text>
              {task.note ? <Text style={styles.noteText}>Note: {task.note}</Text> : null}
            </View>
          ))
        ) : (
          <Text style={styles.helper}>Nothing unscheduled at the moment.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Recent activity</Text>
        {resolution.recent_activity.length ? (
          resolution.recent_activity.map((activity) => (
            <View key={activity.task_id} style={styles.activityRow}>
              <Text style={[styles.taskTitle, activity.completed && styles.completed]}>{activity.title}</Text>
              {activity.completed_at ? (
                <Text style={styles.taskMeta}>{new Date(activity.completed_at).toLocaleString()}</Text>
              ) : null}
              {activity.note_present ? <Text style={styles.noteText}>Note captured</Text> : null}
            </View>
          ))
        ) : (
          <Text style={styles.helper}>No recent updates.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
  },
  meta: {
    color: "#666",
  },
  body: {
    marginTop: 4,
    color: "#333",
  },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e7f0",
    backgroundColor: "#fff",
  },
  sectionTitle: {
    fontWeight: "600",
    marginBottom: 8,
  },
  taskRow: {
    marginBottom: 8,
  },
  taskTitle: {
    fontWeight: "600",
  },
  taskMeta: {
    color: "#666",
    fontSize: 12,
  },
  noteText: {
    color: "#1a73e8",
    fontSize: 12,
  },
  completed: {
    textDecorationLine: "line-through",
    color: "#777",
  },
  activityRow: {
    marginBottom: 8,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  helper: {
    marginTop: 8,
    color: "#666",
    textAlign: "center",
  },
  error: {
    color: "#c62828",
    fontSize: 16,
    textAlign: "center",
  },
});
