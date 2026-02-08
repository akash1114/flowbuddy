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
  Alert,
} from "react-native";
import { ShieldAlert, CheckCircle, ArrowRight } from "lucide-react-native";
import {
  getInterventionsLatest,
  runInterventions,
  respondToIntervention,
  InterventionSnapshot,
} from "../api/interventions";
import { useUserId } from "../state/user";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../types/navigation";
import { useActiveResolutions } from "../hooks/useActiveResolutions";
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "Interventions">;

export default function InterventionsScreen() {
  const { userId, loading: userLoading } = useUserId();
  const navigation = useNavigation<Nav>();
  const {
    hasActiveResolutions,
    loading: activeResolutionsLoading,
    refresh: refreshActiveResolutions,
  } = useActiveResolutions(userId);
  const [snapshot, setSnapshot] = useState<InterventionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);
  const [respondingKey, setRespondingKey] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [lastAction, setLastAction] = useState<{ message: string; changes: string[] } | null>(null);
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const accentForeground = theme.mode === "dark" ? theme.textPrimary : "#fff";
  const backgroundColor = theme.background;
  const surface = theme.card;
  const borderColor = theme.border;
  const textPrimary = theme.textPrimary;
  const textSecondary = theme.textSecondary;
  const accent = theme.accent;

  const fetchSnapshot = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { intervention, requestId: reqId, notFound: none } = await getInterventionsLatest(userId);
      setSnapshot(intervention);
      setRequestId(reqId);
      setNotFound(none);
      if (__DEV__) {
        console.log("[Interventions] latest snapshot", {
          hasSnapshot: Boolean(intervention),
          flagged: intervention?.slippage?.flagged,
          hasCard: Boolean(intervention?.card),
          optionCount: intervention?.card?.options?.length ?? 0,
          requestId: reqId,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load interventions.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userLoading && userId && hasActiveResolutions !== null) {
      if (hasActiveResolutions) {
        fetchSnapshot();
      } else {
        setSnapshot(null);
        setLoading(false);
        setNotFound(true);
      }
    }
  }, [fetchSnapshot, userId, userLoading, hasActiveResolutions]);

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
      const { intervention, requestId: reqId } = await runInterventions(userId);
      setSnapshot(intervention);
      setRequestId(reqId);
      setNotFound(false);
      if (__DEV__) {
        console.log("[Interventions] run snapshot", {
          hasSnapshot: Boolean(intervention),
          flagged: intervention?.slippage?.flagged,
          hasCard: Boolean(intervention?.card),
          optionCount: intervention?.card?.options?.length ?? 0,
          requestId: reqId,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate check-in.");
    } finally {
      setRunning(false);
    }
  };

  const handleOptionSelect = useCallback(
    async (optionKey: string) => {
      if (!userId || actionLoading) {
        return;
      }
      setActionLoading(true);
      setRespondingKey(optionKey);
      try {
        const { message, changes, snapshot: updatedSnapshot } = await respondToIntervention(userId, optionKey);
        setLastAction({ message, changes });
        if (updatedSnapshot) {
          setSnapshot(updatedSnapshot);
        }
      } catch (err) {
        Alert.alert("Intervention", err instanceof Error ? err.message : "Unable to apply that option right now.");
      } finally {
        setRespondingKey(null);
        setActionLoading(false);
      }
    },
    [userId, actionLoading],
  );

  if (!userLoading && !activeResolutionsLoading && hasActiveResolutions === false) {
    return (
      <View style={[styles.center, { backgroundColor }]}>
        <Text style={[styles.emptyTitle, { color: textPrimary }]}>Add a resolution first</Text>
        <Text style={[styles.helper, { color: textSecondary }]}>Coaching kicks in once you approve your first resolution.</Text>
        <TouchableOpacity style={[styles.button, { backgroundColor: accent }]} onPress={() => navigation.navigate("ResolutionCreate")}>
          <Text style={styles.buttonText}>Create Resolution</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={refreshActiveResolutions}>
          <Text style={[styles.linkText, { color: accent }]}>Check again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if ((userLoading || loading || activeResolutionsLoading) && !refreshing) {
    return (
      <View style={[styles.center, { backgroundColor }]}>
        <ActivityIndicator color={accent} />
        <Text style={[styles.helper, { color: textSecondary }]}>Preparing your check-in…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { backgroundColor }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchSnapshot(); }} tintColor={accent} />
      }
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: textPrimary }]}>Interventions</Text>
        <TouchableOpacity style={styles.linkButton} onPress={() => navigation.navigate("InterventionsHistory")}>
          <Text style={[styles.linkText, { color: accent }]}>History</Text>
        </TouchableOpacity>
      </View>
      {error ? (
        <View style={[styles.errorBox, { backgroundColor: theme.accentSoft }]}>
          <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
          <TouchableOpacity style={[styles.retryButton, { borderColor: theme.danger }]} onPress={fetchSnapshot}>
            <Text style={[styles.retryText, { color: theme.danger }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

          {snapshot ? (
            <>
          <StatusCard snapshot={snapshot} theme={theme} styles={styles} />
              {lastAction ? (
                <View style={styles.actionResult}>
                  <Text style={styles.actionResultTitle}>Action applied</Text>
                  <Text style={styles.actionResultCopy}>{lastAction.message}</Text>
                  {lastAction.changes?.length ? (
                    <View style={styles.actionResultList}>
                      {lastAction.changes.map((change, idx) => (
                        <Text key={`change-${idx}`} style={styles.actionResultItem}>
                          • {change}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  <View style={styles.actionResultButtons}>
                    <TouchableOpacity style={styles.secondaryButton} onPress={() => setLastAction(null)}>
                      <Text style={styles.secondaryButtonText}>Dismiss</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.primaryCTA} onPress={() => navigation.navigate("MyWeek")}>
                      <Text style={styles.primaryCTAText}>Review My Week</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
              {snapshot.slippage.flagged && snapshot.card ? (
            <View style={styles.suggestionCard}>
              <Text style={styles.suggestionTitle}>Agent Suggestion</Text>
              <Text style={styles.suggestionMessage}>{snapshot.card.message}</Text>
              {snapshot.card.options.map((option) => {
                const optionTheme = getOptionTheme(option.key, theme);
                const busy = respondingKey === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.optionButton,
                      { backgroundColor: optionTheme.backgroundColor, borderColor: optionTheme.borderColor },
                      busy && styles.optionButtonBusy,
                    ]}
                    onPress={() => handleOptionSelect(option.key)}
                    disabled={busy || actionLoading}
                    activeOpacity={0.8}
                  >
                    <View style={styles.optionHeader}>
                      <View style={styles.optionLabelWrapper}>
                        <Text style={[styles.optionLabel, { color: optionTheme.labelColor }]}>{option.label}</Text>
                        <Text style={[styles.optionPill, { color: optionTheme.pillColor, backgroundColor: optionTheme.pillBackground }]}>
                          {optionTheme.pillText}
                        </Text>
                      </View>
                      {busy ? <ActivityIndicator size="small" color={theme.textPrimary} /> : null}
                      {!busy ? <ArrowRight size={16} color={optionTheme.iconColor} /> : null}
                    </View>
                    <Text style={[styles.optionDetails, { color: optionTheme.detailColor }]}>{option.details}</Text>
                    <Text style={[styles.optionCTA, { color: optionTheme.ctaColor }]}>Try this</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <View style={styles.debugBox}>
            <Text style={styles.debugLabel}>Req ID: {requestId || snapshot.request_id || "—"}</Text>
          </View>
        </>
      ) : null}

      {!snapshot && hasActiveResolutions ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No check-in needed yet.</Text>
          <Text style={styles.helper}>Check back Thursday!</Text>
          <TouchableOpacity
            style={[styles.button, running && styles.buttonDisabled]}
            onPress={handleGenerate}
            disabled={running}
          >
            {running ? <ActivityIndicator color={accentForeground} /> : <Text style={styles.buttonText}>Generate Check-in</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

type Styles = ReturnType<typeof createStyles>;

function StatusCard({
  snapshot,
  theme,
  styles,
}: {
  snapshot: InterventionSnapshot;
  theme: ThemeTokens;
  styles: Styles;
}) {
  const flagged = snapshot.slippage.flagged;
  const completion = Math.round(snapshot.slippage.completion_rate * 100);
  const cardTheme = flagged
    ? { card: styles.warningCard, icon: <ShieldAlert size={42} color={theme.warning} />, title: "Slippage detected" }
    : { card: styles.safeCard, icon: <CheckCircle size={42} color={theme.success} />, title: "On track" };
  return (
    <View style={[styles.statusCard, cardTheme.card]}>
      {cardTheme.icon}
      <View style={styles.statusContent}>
        <Text style={styles.statusTitle}>{cardTheme.title}</Text>
        <Text style={styles.statusMeta}>Completion Rate: {completion}%</Text>
        <Text style={styles.statusMeta}>Missed scheduled: {snapshot.slippage.missed_scheduled}</Text>
      </View>
    </View>
  );
}

type OptionTheme = {
  backgroundColor: string;
  borderColor: string;
  labelColor: string;
  detailColor: string;
  iconColor: string;
  pillColor: string;
  pillBackground: string;
  pillText: string;
  ctaColor: string;
};

function getOptionTheme(key: string, theme: ThemeTokens): OptionTheme {
  const palette: Record<
    string,
    {
      color: string;
      pillText: string;
    }
  > = {
    reduce_scope: { color: theme.warning, pillText: "Lighten it" },
    reschedule: { color: theme.accent, pillText: "Shift it" },
    reflect: { color: theme.success, pillText: "Reflect" },
    pause: { color: theme.danger, pillText: "Pause" },
    adjust_goal: { color: theme.heroPrimary, pillText: "Adjust" },
    get_back_on_track: { color: theme.success, pillText: "Recommit" },
  };

  const variant = palette[key] ?? { color: theme.accent, pillText: "Action" };
  const surface = theme.mode === "dark" ? theme.surfaceMuted : theme.surface;

  return {
    backgroundColor: surface,
    borderColor: theme.border,
    labelColor: variant.color,
    detailColor: theme.textSecondary,
    iconColor: variant.color,
    pillColor: theme.mode === "dark" ? theme.textPrimary : variant.color,
    pillBackground: theme.accentSoft,
    pillText: variant.pillText,
    ctaColor: variant.color,
  };
}

const createStyles = (theme: ThemeTokens) => {
  const accentForeground = theme.mode === "dark" ? theme.textPrimary : "#fff";
  const heroForeground = theme.mode === "dark" ? theme.textPrimary : "#fff";

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
      fontSize: 28,
      fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
      color: theme.textPrimary,
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
      color: theme.accent,
      fontWeight: "600",
    },
    statusCard: {
      borderRadius: 24,
      padding: 20,
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
    },
    warningCard: {
      backgroundColor: theme.mode === "dark" ? "rgba(250,204,21,0.12)" : "rgba(251,191,36,0.25)",
      borderWidth: 1,
      borderColor: theme.warning,
    },
    safeCard: {
      backgroundColor: theme.mode === "dark" ? "rgba(34,197,94,0.12)" : "rgba(16,185,129,0.25)",
      borderWidth: 1,
      borderColor: theme.success,
    },
    statusContent: {
      flex: 1,
    },
    statusTitle: {
      fontSize: 20,
      fontWeight: "600",
      color: theme.textPrimary,
    },
    statusMeta: {
      color: theme.textSecondary,
      marginTop: 4,
    },
    suggestionCard: {
      marginTop: 12,
      backgroundColor: theme.card,
      borderRadius: 18,
      padding: 20,
      borderWidth: 1,
      borderColor: theme.border,
    },
    suggestionTitle: {
      fontWeight: "600",
      color: theme.textPrimary,
    },
    suggestionMessage: {
      marginTop: 6,
      color: theme.textSecondary,
    },
    optionButton: {
      marginTop: 10,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
    },
    optionButtonBusy: {
      opacity: 0.6,
    },
    optionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    optionLabelWrapper: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flex: 1,
    },
    optionLabel: {
      fontWeight: "600",
      color: theme.textPrimary,
    },
    optionPill: {
      fontSize: 11,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      fontWeight: "600",
    },
    optionDetails: {
      color: theme.textSecondary,
      marginTop: 4,
    },
    optionCTA: {
      marginTop: 10,
      fontWeight: "600",
      textTransform: "uppercase",
      fontSize: 12,
      letterSpacing: 0.6,
    },
    button: {
      marginTop: 16,
      backgroundColor: theme.accent,
      paddingVertical: 14,
      borderRadius: 999,
      alignItems: "center",
      paddingHorizontal: 24,
    },
    buttonDisabled: {
      backgroundColor: theme.accentSoft,
    },
    buttonText: {
      color: accentForeground,
      fontWeight: "600",
    },
    helper: {
      marginTop: 8,
      color: theme.textSecondary,
      textAlign: "center",
    },
    actionResult: {
      marginTop: 16,
      padding: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
    },
    actionResultTitle: {
      fontWeight: "700",
      color: theme.textPrimary,
    },
    actionResultCopy: {
      marginTop: 6,
      color: theme.textSecondary,
    },
    actionResultList: {
      marginTop: 8,
      gap: 4,
    },
    actionResultItem: {
      color: theme.textSecondary,
      fontSize: 13,
    },
    actionResultButtons: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 10,
      marginTop: 12,
      flexWrap: "wrap",
    },
    secondaryButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    secondaryButtonText: {
      color: theme.textSecondary,
      fontWeight: "600",
    },
    primaryCTA: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: theme.heroPrimary,
    },
    primaryCTAText: {
      color: heroForeground,
      fontWeight: "600",
    },
    emptyCard: {
      borderRadius: 24,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 24,
      alignItems: "center",
      backgroundColor: theme.card,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: "600",
      marginTop: 12,
      color: theme.textPrimary,
    },
    error: {
      color: theme.danger,
    },
    errorBox: {
      backgroundColor: theme.accentSoft,
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
      borderColor: theme.danger,
    },
    retryText: {
      color: theme.danger,
      fontWeight: "600",
    },
    debugBox: {
      marginTop: 16,
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.surfaceMuted,
    },
    debugLabel: {
      fontSize: 12,
      color: theme.textSecondary,
      textAlign: "center",
    },
});
};
