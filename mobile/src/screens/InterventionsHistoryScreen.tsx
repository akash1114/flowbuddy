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
import { CheckCircle, ShieldAlert } from "lucide-react-native";

import { listInterventionsHistory, InterventionHistoryItem } from "../api/interventions";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";

type Nav = NativeStackNavigationProp<RootStackParamList, "InterventionsHistory">;

export default function InterventionsHistoryScreen() {
  const { userId, loading: userLoading } = useUserId();
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<InterventionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { items: list } = await listInterventionsHistory(userId);
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

  if ((userLoading || loading) && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6B8DBF" />
        <Text style={styles.helper}>Loading intervention history…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchHistory(); }} />}
    >
      <Text style={styles.title}>Intervention Log</Text>
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
          onPress={() => navigation.navigate("InterventionsHistoryDetail", { logId: item.id })}
        >
          <View style={styles.iconColumn}>
            {item.flagged ? <ShieldAlert size={28} color="#B45309" /> : <CheckCircle size={28} color="#15803D" />}
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{item.flagged ? "Slippage Detected" : "On Track"}</Text>
            <Text style={styles.cardMeta}>Week of {item.week_start}</Text>
            <Text style={styles.cardMeta}>Reason: {item.reason || "—"}</Text>
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
    backgroundColor: "#FAFAF8",
  },
  title: {
    fontSize: 28,
    color: "#2D3748",
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#F3F4F6",
    padding: 16,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  iconColumn: {
    width: 40,
    alignItems: "center",
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    fontWeight: "600",
    color: "#1F2933",
  },
  cardMeta: {
    marginTop: 4,
    color: "#6B7280",
  },
  helper: {
    marginTop: 12,
    color: "#666",
    textAlign: "center",
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
