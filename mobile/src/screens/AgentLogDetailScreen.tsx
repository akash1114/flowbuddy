import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Brain, CheckCircle, Tag, Quote, User } from "lucide-react-native";
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

import { getAgentLogItem, AgentLogDetail } from "../api/agentLog";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";

type Route = RouteProp<RootStackParamList, "AgentLogDetail">;

export default function AgentLogDetailScreen() {
  const route = useRoute<Route>();
  const { logId } = route.params;
  const { userId, loading: userLoading } = useUserId();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [entry, setEntry] = useState<AgentLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { item, requestId: reqId } = await getAgentLogItem(userId, logId);
      setEntry(item);
      setRequestId(reqId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load log entry.");
    } finally {
      setLoading(false);
    }
  }, [logId, userId]);

  useEffect(() => {
    if (!userLoading && userId) {
      fetchDetail();
    }
  }, [fetchDetail, userId, userLoading]);

  if (userLoading || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
        <Text style={styles.helper}>Loading log entry…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchDetail}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!entry) {
    return (
      <View style={styles.center}>
        <Text style={styles.helper}>Log entry not found.</Text>
      </View>
    );
  }

  const payloadText = JSON.stringify(entry.payload ?? {}, null, 2);
  const createdAt = new Date(entry.created_at).toLocaleString();
  const isBrainDump = entry?.action_type === "brain_dump_analyzed";

  if (isBrainDump) {
    const payload = entry.payload ?? {};
    const signals = payload.signals ?? payload;
    const acknowledgement = signals.acknowledgement ?? "We'll take it one step at a time.";
    const emotions: string[] = Array.isArray(signals.emotions) ? signals.emotions : [];
    const actionableItems: string[] = Array.isArray(signals.actionable_items) ? signals.actionable_items : [];
    const sentiment = typeof signals.sentiment_score === "number" ? signals.sentiment_score : 0;
    const userText = typeof payload.text === "string" ? payload.text : payload.user_input;

    return (
      <ScrollView contentContainerStyle={styles.brainContainer} stickyHeaderIndices={[]}>
        <View style={styles.brainHeader}>
          <View style={styles.brainIconWrapper}>
            <Brain size={42} color={theme.accent} />
          </View>
          <View>
            <Text style={styles.brainLabel}>Mental Clear</Text>
            <Text style={styles.brainTimestamp}>{createdAt}</Text>
          </View>
        </View>

        {userText ? (
          <View style={styles.userCard}>
            <View style={styles.userHeader}>
              <User size={18} color={theme.textSecondary} />
              <Text style={styles.userLabel}>You wrote</Text>
            </View>
            <Text style={styles.userText}>{userText}</Text>
          </View>
        ) : null}

        <View style={styles.brainHero}>
          <Quote size={26} color={theme.heroPrimary} />
          <Text style={styles.brainQuote}>"{acknowledgement}"</Text>
          <Text style={styles.brainSentiment}>Sentiment score: {sentiment.toFixed(2)}</Text>
        </View>

        {emotions.length ? (
          <View style={styles.brainSection}>
            <Text style={styles.sectionLabel}>Detected Signals</Text>
            <View style={styles.pillRow}>
              {emotions.map((emotion) => (
                <View key={emotion} style={styles.pill}>
                  <Tag size={14} color={theme.accent} />
                  <Text style={styles.pillText}>{emotion}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {actionableItems.length ? (
          <View style={styles.brainSection}>
            <Text style={styles.sectionLabel}>Suggested Actions</Text>
            {actionableItems.map((item) => (
              <View key={item} style={styles.actionRow}>
                <CheckCircle size={18} color={theme.success} />
                <Text style={styles.actionText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.payloadBox}>
          <Text style={styles.payloadLabel}>System Payload</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <Text style={styles.payloadText}>{payloadText}</Text>
          </ScrollView>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} stickyHeaderIndices={[]}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Action Detail</Text>
        <Text style={styles.timestamp}>{createdAt}</Text>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summary}>{entry.summary}</Text>
        <Text style={[styles.badge, styles.badgePrimary]}>{entry.action_type}</Text>
      </View>

      <View style={styles.metaCard}>
        <InfoRow label="Action type" value={entry.action_type} />
        <InfoRow label="Undo available" value={entry.undo_available ? "Yes" : "No"} />
        {entry.request_id ? <InfoRow label="request_id" value={entry.request_id} /> : null}
        {requestId ? <InfoRow label="request_id header" value={requestId} /> : null}
      </View>

      <View style={styles.payloadBox}>
        <Text style={styles.payloadLabel}>System Payload</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <Text style={styles.payloadText}>{payloadText}</Text>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
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
      padding: 16,
      backgroundColor: theme.background,
    },
    helper: {
      marginTop: 8,
      color: theme.textSecondary,
      textAlign: "center",
    },
    error: {
      color: theme.danger,
      textAlign: "center",
      marginBottom: 12,
    },
    retryButton: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.danger,
    },
    retryText: {
      color: theme.danger,
      fontWeight: "600",
    },
    header: {
      gap: 4,
    },
    headerLabel: {
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
      color: theme.textMuted,
    },
    timestamp: {
      fontSize: 22,
      color: theme.textPrimary,
      fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    },
    summaryCard: {
      backgroundColor: theme.card,
      borderRadius: 24,
      padding: 20,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 10,
    },
    summary: {
      fontSize: 20,
      color: theme.textPrimary,
      fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    },
    badge: {
      alignSelf: "flex-start",
      fontSize: 12,
      textTransform: "uppercase",
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      fontWeight: "600",
    },
    badgePrimary: {
      backgroundColor: theme.accentSoft,
      color: theme.accent,
    },
    metaCard: {
      borderRadius: 16,
      backgroundColor: theme.card,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 8,
    },
    infoRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 12,
    },
    infoLabel: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    infoValue: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.textPrimary,
      flex: 1,
      textAlign: "right",
    },
    payloadBox: {
      borderRadius: 16,
      backgroundColor: theme.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 16,
    },
    payloadLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.textSecondary,
      marginBottom: 8,
    },
    payloadText: {
      fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
      fontSize: 12,
      color: theme.textPrimary,
      minWidth: 250,
    },
    brainContainer: {
      padding: 24,
      gap: 24,
      backgroundColor: theme.surfaceMuted,
    },
    brainHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
    },
    brainIconWrapper: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: theme.surface,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    brainLabel: {
      fontSize: 18,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    brainTimestamp: {
      color: theme.accent,
    },
    brainHero: {
      backgroundColor: theme.card,
      borderRadius: 24,
      padding: 24,
      gap: 12,
      borderWidth: 1,
      borderColor: theme.border,
    },
    brainQuote: {
      fontSize: 22,
      fontStyle: "italic",
      color: theme.heroPrimary,
      fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    },
    brainSentiment: {
      color: theme.accent,
      fontWeight: "600",
    },
    brainSection: {
      gap: 12,
    },
    sectionLabel: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    pillRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.chipBackground,
    },
    pillText: {
      color: theme.chipText,
      fontWeight: "600",
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 4,
    },
    actionText: {
      color: theme.success,
      fontWeight: "600",
    },
    userCard: {
      backgroundColor: theme.card,
      borderRadius: 20,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 8,
    },
    userHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    userLabel: {
      fontSize: 14,
      fontWeight: "700",
      color: theme.textSecondary,
      textTransform: "uppercase",
    },
    userText: {
      fontSize: 16,
      color: theme.textPrimary,
      lineHeight: 24,
    },
  });
