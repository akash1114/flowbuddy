import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "WeeklyPlanHistory">;

export default function WeeklyPlanHistoryScreen() {
  const { userId, loading: userLoading } = useUserId();
  const navigation = useNavigation<Nav>();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
        <ActivityIndicator color={theme.accent} />
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

const createStyles = (theme: ThemeTokens) =>
  StyleSheet.create({
    container: {
      padding: 16,
      gap: 12,
      backgroundColor: theme.background,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.background,
    },
    title: {
      fontSize: 30,
      fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
      color: theme.textPrimary,
    },
    card: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 16,
      backgroundColor: theme.card,
      shadowColor: theme.shadow,
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
      color: theme.textMuted,
    },
    cardTitle: {
      marginTop: 4,
      fontSize: 18,
      fontWeight: "600",
      color: theme.textPrimary,
    },
    cardMeta: {
      marginTop: 4,
      color: theme.textSecondary,
    },
    badge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.surfaceMuted,
    },
    badgeText: {
      fontWeight: "600",
      color: theme.textPrimary,
    },
    badgeGreen: {
      backgroundColor: "rgba(34,197,94,0.25)",
    },
    badgeGray: {
      backgroundColor: theme.surface,
    },
    helper: {
      marginTop: 12,
      color: theme.textSecondary,
    },
    errorBox: {
      backgroundColor: theme.accentSoft,
      borderRadius: 12,
      padding: 12,
    },
    error: {
      color: theme.danger,
    },
    retryButton: {
      marginTop: 8,
      alignSelf: "flex-start",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: theme.danger,
      borderRadius: 8,
    },
    retryText: {
      color: theme.danger,
      fontWeight: "600",
    },
  });
