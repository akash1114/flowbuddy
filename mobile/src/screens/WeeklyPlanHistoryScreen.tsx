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
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { listWeeklyPlanHistory, WeeklyPlanHistoryItem } from "../api/weeklyPlan";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";

type Nav = NativeStackNavigationProp<RootStackParamList, "WeeklyPlanHistory">;

export default function WeeklyPlanHistoryScreen() {
  const { userId, loading: userLoading } = useUserId();
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<WeeklyPlanHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { items: list } = await listWeeklyPlanHistory(userId);
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load history.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userLoading && userId) {
      fetchHistory();
    }
  }, [fetchHistory, userId, userLoading]);

  if (userLoading || (loading && !refreshing)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.helper}>Loading history…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchHistory(); }} />}
    >
      <Text style={styles.title}>Plan Archive</Text>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchHistory}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {items.map((item) => (
        <TouchableOpacity
          key={item.id}
          style={styles.card}
          onPress={() => navigation.navigate("WeeklyPlanHistoryDetail", { logId: item.id })}
        >
          <View style={styles.cardRow}>
            <View style={styles.cardText}>
              <Text style={styles.cardWeek}>Week of {item.week_start}</Text>
              <Text style={styles.cardTitle}>{item.title || "Weekly snapshot"}</Text>
              <Text style={styles.cardMeta}>Created {new Date(item.created_at).toLocaleDateString()}</Text>
            </View>
            <View style={[styles.badge, item.completion_rate && item.completion_rate >= 0.7 ? styles.badgeGreen : styles.badgeGray]}>
              <Text style={styles.badgeText}>
                {item.completion_rate != null ? `${(item.completion_rate * 100).toFixed(0)}%` : "—"}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}
      {!items.length && !error ? <Text style={styles.helper}>No snapshots yet.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
    backgroundColor: "#FAFAF8",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 30,
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    color: "#2D3748",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#F3F4F6",
    padding: 16,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardText: {
    flex: 1,
  },
  cardWeek: {
    textTransform: "uppercase",
    fontSize: 12,
    color: "#94A3B8",
  },
  cardTitle: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: "600",
    color: "#1F2933",
  },
  cardMeta: {
    marginTop: 4,
    color: "#6B7280",
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeText: {
    fontWeight: "600",
  },
  badgeGreen: {
    backgroundColor: "#DCFCE7",
  },
  badgeGray: {
    backgroundColor: "#E5E7EB",
  },
  helper: {
    marginTop: 12,
    color: "#666",
  },
  errorBox: {
    backgroundColor: "#fdecea",
    borderRadius: 12,
    padding: 12,
  },
  error: {
    color: "#c62828",
  },
  retryButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#c62828",
    borderRadius: 8,
  },
  retryText: {
    color: "#c62828",
    fontWeight: "600",
  },
});
