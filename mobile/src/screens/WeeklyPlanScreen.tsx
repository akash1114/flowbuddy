import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Sun, Circle, TrendingUp, Target } from "lucide-react-native";
import { getWeeklyPlanLatest, runWeeklyPlan, WeeklyPlanResponse } from "../api/weeklyPlan";
import { useUserId } from "../state/user";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../types/navigation";
import { useActiveResolutions } from "../hooks/useActiveResolutions";
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

type WeeklyPlanNav = NativeStackNavigationProp<RootStackParamList, "WeeklyPlan">;

export default function WeeklyPlanScreen() {
  const { userId, loading: userLoading } = useUserId();
  const navigation = useNavigation<WeeklyPlanNav>();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const accentForeground = theme.mode === "dark" ? theme.textPrimary : "#fff";
  const {
    hasActiveResolutions,
    loading: activeResolutionsLoading,
    refresh: refreshActiveResolutions,
  } = useActiveResolutions(userId);
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
    if (!userLoading && userId && hasActiveResolutions !== null) {
      if (hasActiveResolutions) {
        fetchPlan();
      } else {
        setPlan(null);
        setLoading(false);
        setNotFound(true);
      }
    }
  }, [fetchPlan, userId, userLoading, hasActiveResolutions]);

  const hasRunInitialFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasRunInitialFocus.current) {
        hasRunInitialFocus.current = true;
        return;
      }
      refreshActiveResolutions();
    }, [refreshActiveResolutions]),
  );

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

  if (!userLoading && !activeResolutionsLoading && hasActiveResolutions === false) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Start with a resolution</Text>
        <Text style={styles.helper}>Create a resolution to unlock weekly planning.</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate("ResolutionCreate")}>
          <Text style={styles.buttonText}>Create Resolution</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={refreshActiveResolutions}>
          <Text style={styles.linkText}>Check again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if ((userLoading || loading || activeResolutionsLoading) && !refreshing) {
    return (
      <View style={styles.center}>
        <View style={styles.loadingCard}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.loadingTitle}>Assembling your weekly focus…</Text>
          <Text style={styles.loadingSubtitle}>Checking progress, notes, and rolling up next steps.</Text>
        </View>
      </View>
    );
  }

  const dateLabel = plan ? formatRange(plan.week.start, plan.week.end) : "";
  const resolutionStats = plan?.inputs.resolution_stats ?? [];
  const focusResolutionId = plan?.inputs.primary_focus_resolution_id ?? null;
  const focusResolution = focusResolutionId
    ? resolutionStats.find((stat) => stat.resolution_id === focusResolutionId)
    : null;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPlan(); }} tintColor={theme.accent} />
      }
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Weekly Plan</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.linkButton} onPress={() => navigation.navigate("WeeklyPlanHistory")}>
            <Text style={styles.linkText}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.updateButton, running && styles.buttonDisabled]}
            onPress={handleGenerate}
            disabled={running}
          >
            {running ? <ActivityIndicator color={accentForeground} /> : <Text style={styles.updateText}>Update Plan</Text>}
          </TouchableOpacity>
        </View>
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

          {resolutionStats.length ? (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Where Your Plans Stand</Text>
            </View>
          ) : null}
          {resolutionStats.length ? (
            <View style={styles.statCard}>
              {resolutionStats.map((stat, index) => {
                const completionPct = Math.round(stat.completion_rate * 100);
                const focus = stat.resolution_id === focusResolutionId;
                return (
                  <View
                    key={stat.resolution_id}
                    style={[styles.statRow, index > 0 && styles.statRowDivider]}
                  >
                    <View style={styles.statLabelBlock}>
                      {focus ? <Target size={16} color={theme.accent} /> : <TrendingUp size={16} color={theme.textSecondary} />}
                      <Text style={[styles.statTitle, focus && styles.statTitleFocus]}>{stat.title}</Text>
                      <Text style={styles.statDomain}>{stat.domain === "work" ? "Work" : "Personal"}</Text>
                    </View>
                    <View style={styles.statValues}>
                      <Text style={[styles.statCompletion, focus && styles.statTitleFocus]}>{completionPct}%</Text>
                      <Text style={styles.statMeta}>{stat.tasks_completed}/{stat.tasks_total || 0} done</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {focusResolution ? (
            <View style={styles.focusReasonCard}>
              <Text style={styles.focusReasonTitle}>This week focuses on {focusResolution.title}</Text>
              <Text style={styles.focusReasonBody}>
                Completion dipped to {Math.round(focusResolution.completion_rate * 100)}%, so Sarathi lightened the plan and
                scheduled tasks in your {focusResolution.domain === "work" ? "work" : "recharge"} windows.
              </Text>
            </View>
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Suggested Actions</Text>
          </View>
          {plan.micro_resolution.suggested_week_1_tasks.map((task) => (
            <View key={task.title} style={styles.taskRow}>
              <Circle size={10} color={theme.accent} />
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
            <Text style={styles.debugLabel}>
              Completion: {(plan.inputs.completion_rate * 100).toFixed(0)}%
            </Text>
          </View>
        </>
      ) : null}

      {!plan && hasActiveResolutions ? (
        <View style={styles.emptyState}>
          <Sun size={48} color={theme.warning} />
          <Text style={styles.emptyTitle}>Ready to plan your week?</Text>
          <Text style={styles.helper}>Let&apos;s find your focus.</Text>
          <TouchableOpacity style={[styles.button, running && styles.buttonDisabled]} onPress={handleGenerate} disabled={running}>
            {running ? <ActivityIndicator color={accentForeground} /> : <Text style={styles.buttonText}>Generate Plan</Text>}
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

const createStyles = (theme: ThemeTokens) => {
  const accentForeground = theme.mode === "dark" ? theme.textPrimary : "#fff";

  return StyleSheet.create({
    container: {
      padding: 20,
      gap: 16,
      backgroundColor: theme.background,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      backgroundColor: theme.background,
    },
    title: {
      fontSize: 30,
      fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
      color: theme.textPrimary,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    linkButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    linkText: {
      fontWeight: "600",
      color: theme.accent,
    },
    updateButton: {
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      alignItems: "center",
      justifyContent: "center",
    backgroundColor: theme.accent,
    },
    updateText: {
      color: accentForeground,
      fontWeight: "600",
    },
    focusCard: {
      borderRadius: 24,
      padding: 24,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
      shadowOpacity: 0.05,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      shadowColor: theme.shadow,
      marginBottom: 12,
    },
    dateLabel: {
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1,
      color: theme.textSecondary,
    },
    focusTitle: {
      fontSize: 28,
      fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
      marginTop: 8,
      color: theme.textPrimary,
    },
    focusBody: {
      marginTop: 12,
      fontStyle: "italic",
      fontSize: 16,
      color: theme.textSecondary,
    },
    sectionHeader: {
      marginTop: 8,
      marginBottom: 4,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: theme.textPrimary,
    },
    statCard: {
      backgroundColor: theme.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 16,
      gap: 12,
      shadowColor: theme.shadow,
      shadowOpacity: 0.05,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
    },
    statRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    statRowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      paddingTop: 12,
      marginTop: 12,
    },
    statLabelBlock: {
      flex: 1,
      gap: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    },
    statTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: theme.textPrimary,
    },
    statTitleFocus: {
      color: theme.accent,
    },
    statDomain: {
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1,
      color: theme.textSecondary,
    },
    statValues: {
      alignItems: "flex-end",
    },
    statCompletion: {
      fontSize: 18,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    statMeta: {
      color: theme.textSecondary,
      fontSize: 12,
    },
    focusReasonCard: {
      marginTop: 12,
      borderRadius: 16,
      padding: 16,
      backgroundColor: theme.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.border,
    },
    focusReasonTitle: {
      fontWeight: "700",
      color: theme.textPrimary,
      marginBottom: 6,
    },
    focusReasonBody: {
      color: theme.textSecondary,
      lineHeight: 18,
    },
    taskRow: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
      marginBottom: 8,
      gap: 12,
    },
    taskContent: {
      flex: 1,
    },
    taskTitle: {
      fontWeight: "600",
      color: theme.textPrimary,
    },
    taskMeta: {
      marginTop: 4,
      color: theme.textSecondary,
    },
    button: {
      marginTop: 16,
      paddingVertical: 14,
      borderRadius: 999,
      alignItems: "center",
      paddingHorizontal: 24,
      backgroundColor: theme.accent,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: accentForeground,
      fontWeight: "600",
    },
    helper: {
      marginTop: 8,
      textAlign: "center",
      color: theme.textSecondary,
    },
    loadingCard: {
      padding: 20,
      borderRadius: 20,
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: "center",
      gap: 12,
      shadowColor: theme.shadow,
      shadowOpacity: 0.08,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
    },
    loadingTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: theme.textPrimary,
      textAlign: "center",
    },
    loadingSubtitle: {
      fontSize: 14,
      color: theme.textSecondary,
      textAlign: "center",
    },
    emptyState: {
      marginTop: 24,
      borderRadius: 24,
      padding: 24,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: "600",
      marginTop: 12,
      color: theme.textPrimary,
    },
    error: {
      fontWeight: "600",
      color: theme.danger,
    },
    errorBox: {
      borderRadius: 12,
      padding: 12,
      backgroundColor: theme.accentSoft,
    },
    retryButton: {
      marginTop: 8,
      alignSelf: "flex-start",
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.danger,
    },
    retryText: {
      fontWeight: "600",
      color: theme.danger,
    },
    debugBox: {
      marginTop: 16,
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.surfaceMuted,
    },
    debugLabel: {
      fontSize: 12,
      textAlign: "center",
      color: theme.textSecondary,
    },
});
};
