import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Platform } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { getWeeklyPlanHistoryItem, WeeklyPlanResponse } from "../api/weeklyPlan";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "WeeklyPlanHistoryDetail">;

export default function WeeklyPlanHistoryDetailScreen({ route }: Props) {
  const { logId } = route.params;
  const { userId, loading: userLoading } = useUserId();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [snapshot, setSnapshot] = useState<WeeklyPlanResponse | null>(null);
  const [meta, setMeta] = useState<{ created_at: string; week_start: string; week_end: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { detail, meta } = await getWeeklyPlanHistoryItem(userId, logId);
      setSnapshot(detail);
      setMeta(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load snapshot.");
    } finally {
      setLoading(false);
    }
  }, [logId, userId]);

  useEffect(() => {
    if (!userLoading && userId) {
      loadDetail();
    }
  }, [loadDetail, userId, userLoading]);

  if (userLoading || loading || !snapshot || !meta) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={theme.accent} />}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.heroCard}>
        <Text style={styles.subtitle}>Archived Snapshot • {new Date(meta.created_at).toLocaleDateString()}</Text>
        <Text style={styles.title}>{snapshot.micro_resolution.title}</Text>
        <Text style={styles.helper}>{snapshot.week.start} – {snapshot.week.end}</Text>
      </View>

      <View style={styles.focusCard}>
        <Text style={styles.sectionLabel}>Focus</Text>
        <Text style={styles.body}>{snapshot.micro_resolution.why_this}</Text>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Suggested Actions</Text>
      </View>
      {snapshot.micro_resolution.suggested_week_1_tasks.map((task) => (
        <View key={task.title} style={styles.taskRow}>
          <Text style={styles.taskTitle}>{task.title}</Text>
          <Text style={styles.taskMeta}>
            {task.duration_min ? `${task.duration_min} min` : "Flexible"}
            {task.suggested_time ? ` · ${task.suggested_time}` : ""}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const createStyles = (theme: ThemeTokens) =>
  StyleSheet.create({
    container: {
      padding: 20,
      gap: 16,
      backgroundColor: theme.background,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.background,
    },
    heroCard: {
      backgroundColor: theme.card,
      borderRadius: 24,
      padding: 24,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 8,
    },
    subtitle: {
      color: theme.textMuted,
      textTransform: "uppercase",
      fontSize: 12,
      letterSpacing: 1,
    },
    title: {
      fontSize: 28,
      color: theme.textPrimary,
      fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    },
    helper: {
      color: theme.textSecondary,
      fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
    },
    focusCard: {
      backgroundColor: theme.card,
      borderRadius: 20,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
    },
    sectionLabel: {
      fontWeight: "600",
      color: theme.textPrimary,
    },
    body: {
      marginTop: 6,
      color: theme.textSecondary,
      fontStyle: "italic",
    },
    sectionHeader: {
      marginTop: 16,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: theme.textPrimary,
    },
    taskRow: {
      backgroundColor: theme.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 8,
    },
    taskTitle: {
      fontWeight: "600",
      color: theme.textPrimary,
    },
    taskMeta: {
      color: theme.textSecondary,
      marginTop: 4,
    },
    error: {
      color: theme.danger,
    },
  });
