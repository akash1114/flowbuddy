import { useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { fetchDashboard, DashboardResolution } from "../api/dashboard";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";

type DashboardNavProp = NativeStackNavigationProp<RootStackParamList, "Dashboard">;

export default function ResolutionDashboardScreen() {
  const navigation = useNavigation<DashboardNavProp>();
  const { userId, loading: userLoading } = useUserId();
  const [dashboard, setDashboard] = useState<DashboardResolution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboard = async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { dashboard: data, requestId: reqId } = await fetchDashboard(userId);
      setDashboard(data.active_resolutions);
      setRequestId(reqId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!userLoading && userId) {
      loadDashboard();
    }
  }, [userLoading, userId]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  if (userLoading || (loading && !dashboard.length)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.helper}>Gathering your focus areas…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.retry} onPress={loadDashboard}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!dashboard.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No active resolutions</Text>
        <Text style={styles.helper}>Approve a plan to activate this dashboard.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {dashboard.map((resolution) => (
        <TouchableOpacity
          key={resolution.resolution_id}
          style={styles.card}
          onPress={() => navigation.navigate("ResolutionDashboardDetail", { resolutionId: resolution.resolution_id })}
        >
          <Text style={styles.title}>{resolution.title}</Text>
          <Text style={styles.meta}>
            {resolution.type} · {resolution.duration_weeks ?? "Flexible"} weeks
          </Text>
          <Text style={styles.week}>
            Week: {resolution.week.start} – {resolution.week.end}
          </Text>
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>
              {resolution.tasks.completed}/{resolution.tasks.total} tasks completed ({Math.round(resolution.completion_rate * 100)}%)
            </Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${resolution.completion_rate * 100}%` }]} />
            </View>
          </View>
          <Text style={styles.breakdown}>
            Scheduled: {resolution.tasks.scheduled} · Unscheduled: {resolution.tasks.unscheduled}
          </Text>
          <Text style={styles.sectionTitle}>Recent activity</Text>
          {resolution.recent_activity.length ? (
            resolution.recent_activity.slice(0, 5).map((activity) => (
              <View key={activity.task_id} style={styles.activityRow}>
                <Text style={[styles.activityTitle, activity.completed && styles.completed]}>
                  {activity.title}
                </Text>
                {activity.note_present ? <Text style={styles.noteBadge}>Note</Text> : null}
                {activity.completed_at ? <Text style={styles.activityMeta}>{new Date(activity.completed_at).toLocaleString()}</Text> : null}
              </View>
            ))
          ) : (
            <Text style={styles.helper}>No recent updates yet.</Text>
          )}
        </TouchableOpacity>
      ))}
      {requestId ? (
        <View style={styles.debugCard}>
          <Text style={styles.debugLabel}>request_id: {requestId}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e7f0",
    backgroundColor: "#fff",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  meta: {
    color: "#666",
    marginTop: 4,
  },
  week: {
    marginTop: 4,
    color: "#444",
  },
  progressRow: {
    marginTop: 12,
  },
  progressText: {
    fontWeight: "600",
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#e6ecf5",
    marginTop: 6,
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#1a73e8",
  },
  breakdown: {
    marginTop: 8,
    color: "#555",
  },
  sectionTitle: {
    marginTop: 12,
    fontWeight: "600",
  },
  activityRow: {
    marginTop: 6,
  },
  activityTitle: {
    fontWeight: "500",
  },
  completed: {
    textDecorationLine: "line-through",
    color: "#555",
  },
  noteBadge: {
    marginTop: 2,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "#fff3cd",
    color: "#8a6d3b",
    fontSize: 12,
  },
  activityMeta: {
    color: "#888",
    fontSize: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  helper: {
    marginTop: 8,
    color: "#555",
    textAlign: "center",
  },
  error: {
    color: "#c62828",
    fontSize: 16,
    textAlign: "center",
  },
  retry: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1a73e8",
  },
  retryText: {
    color: "#1a73e8",
    fontWeight: "600",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111",
  },
  debugCard: {
    padding: 12,
    borderTopWidth: 1,
    borderColor: "#e6e9f2",
  },
  debugLabel: {
    color: "#111",
  },
});
