import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
  ScrollView,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { listAgentLog, AgentLogListItem } from "../api/agentLog";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";
import { Brain, Target, ShieldAlert, FileText } from "lucide-react-native";
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

type Nav = NativeStackNavigationProp<RootStackParamList, "AgentLog">;

const FILTER_CHIPS = [
  { label: "All", type: null },
  { label: "Brain Dumps", type: "brain_dump_analyzed" },
  { label: "Resolutions", type: "resolution_created" },
  { label: "Interventions", type: "intervention_generated" },
];

export default function AgentLogScreen() {
  const navigation = useNavigation<Nav>();
  const { userId, loading: userLoading } = useUserId();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [entries, setEntries] = useState<AgentLogListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [isFiltering, setIsFiltering] = useState(false);

  const fetchLogs = useCallback(
    async ({
      reset,
      cursor,
      actionType,
    }: {
      reset?: boolean;
      cursor?: string | null;
      actionType?: string | null;
    } = {}) => {
      if (!userId) return;
      if (reset) {
        setRefreshing(true);
        setError(null);
      }
      try {
        const { items, nextCursor: cursorValue } = await listAgentLog(userId, {
          limit: 50,
          cursor: cursor ?? (reset ? null : undefined),
          action_type: actionType ?? filterType ?? undefined,
        });
        const activeType = actionType ?? filterType;
        const filteredItems =
          activeType && activeType.length ? items.filter((item) => item.action_type === activeType) : items;
        setEntries((prev) => (reset ? filteredItems : [...prev, ...filteredItems]));
        setNextCursor(cursorValue);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load agent log.");
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [userId, filterType],
  );

  useEffect(() => {
    if (!userLoading && userId) {
      fetchLogs({ reset: true });
    }
  }, [fetchLogs, userId, userLoading]);

  const handleFilterChange = (type: string | null) => {
    if (filterType === type) return;
    setFilterType(type);
    setIsFiltering(true);
    fetchLogs({ reset: true, actionType: type }).finally(() => setIsFiltering(false));
  };

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchLogs({ cursor: nextCursor });
  }, [fetchLogs, loadingMore, nextCursor]);

  if (userLoading || ((loading || isFiltering) && !entries.length)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
        <Text style={styles.helper}>Loading agent log…</Text>
      </View>
    );
  }

  const renderIcon = (actionType: string) => {
    const lower = actionType.toLowerCase();
    if (lower.includes("brain_dump")) {
      return (
        <View style={[styles.iconCircle, styles.iconAccent]}>
          <Brain size={18} color={theme.accent} />
        </View>
      );
    }
    if (lower.includes("resolution")) {
      return (
        <View style={[styles.iconCircle, styles.iconInfo]}>
          <Target size={18} color={theme.accent} />
        </View>
      );
    }
    if (lower.includes("intervention")) {
      return (
        <View style={[styles.iconCircle, styles.iconWarning]}>
          <ShieldAlert size={18} color={theme.warning} />
        </View>
      );
    }
    return (
      <View style={[styles.iconCircle, styles.iconNeutral]}>
        <FileText size={18} color={theme.textSecondary} />
      </View>
    );
  };

  const getBadgeTheme = (actionType: string) => {
    const lower = actionType.toLowerCase();
    if (lower.includes("brain_dump")) {
      return { backgroundColor: theme.accentSoft, color: theme.accent };
    }
    if (lower.includes("resolution")) {
      return { backgroundColor: theme.surfaceMuted, color: theme.textPrimary };
    }
    if (lower.includes("intervention")) {
      return { backgroundColor: "rgba(250,204,21,0.2)", color: theme.warning };
    }
    return { backgroundColor: theme.surface, color: theme.textSecondary };
  };

  return (
    <FlatList
      data={entries}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchLogs({ reset: true })} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>System Log</Text>
          <Text style={styles.subtitle}>A transparent record of all interactions and automated decisions.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {FILTER_CHIPS.map((chip) => {
              const active = filterType === chip.type;
              return (
                <TouchableOpacity
                  key={chip.label}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => handleFilterChange(chip.type)}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>{chip.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.error}>{error}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => fetchLogs({ reset: true })}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={!loading ? <Text style={styles.helper}>No activity logged yet.</Text> : null}
      ListFooterComponent={
        nextCursor ? (
          <TouchableOpacity style={styles.loadMoreButton} onPress={handleLoadMore} disabled={loadingMore}>
            <Text style={styles.loadMoreText}>{loadingMore ? "Loading…" : "Load more"}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.footerGap} />
        )
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.timelineRow}
          onPress={() => navigation.navigate("AgentLogDetail", { logId: item.id })}
        >
          <View style={styles.iconColumn}>{renderIcon(item.action_type)}</View>
          <View style={[styles.card, isBrainDump(item.action_type) && styles.brainCard]}>
            <Text style={styles.summary}>{item.summary}</Text>
            <View style={styles.metaRow}>
              <Text style={[styles.badge, getBadgeTheme(item.action_type)]}>{item.action_type}</Text>
              <Text style={styles.timestamp}>{new Date(item.created_at).toLocaleString()}</Text>
            </View>
            {item.request_id ? <Text style={styles.requestId}>request_id: {item.request_id}</Text> : null}
            {item.undo_available ? <Text style={styles.undo}>Undo available</Text> : null}
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

function isBrainDump(actionType: string) {
  return actionType.toLowerCase().includes("brain_dump");
}

const createStyles = (theme: ThemeTokens) => {
  const accentForeground = theme.mode === "dark" ? theme.textPrimary : "#fff";

  return StyleSheet.create({
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.background,
      padding: 24,
    },
    helper: {
      marginTop: 12,
      color: theme.textSecondary,
      textAlign: "center",
    },
    listContent: {
      padding: 16,
      gap: 12,
      backgroundColor: theme.background,
    },
    header: {
      marginBottom: 12,
      gap: 8,
    },
    title: {
      fontSize: 30,
      color: theme.textPrimary,
      fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    },
    subtitle: {
      color: theme.textSecondary,
    },
    filterRow: {
      gap: 8,
      paddingVertical: 8,
      paddingRight: 12,
    },
    filterChip: {
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    filterChipActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    filterText: {
      color: theme.textSecondary,
      fontWeight: "600",
    },
    filterTextActive: {
      color: accentForeground,
    },
    errorBox: {
      backgroundColor: theme.accentSoft,
      borderRadius: 12,
      padding: 12,
      gap: 8,
    },
    error: {
      color: theme.danger,
    },
    retryButton: {
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
    timelineRow: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    iconColumn: {
      width: 40,
      alignItems: "center",
    },
    iconCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    iconAccent: {
      backgroundColor: theme.accentSoft,
    },
    iconInfo: {
      backgroundColor: theme.surfaceMuted,
    },
    iconWarning: {
      backgroundColor: "rgba(250,204,21,0.18)",
    },
    iconNeutral: {
      backgroundColor: theme.surface,
    },
    card: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 14,
      backgroundColor: theme.card,
      gap: 6,
      flex: 1,
      marginLeft: 12,
      shadowColor: theme.shadow,
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
    },
    brainCard: {
      backgroundColor: theme.surfaceMuted,
    },
    summary: {
      fontSize: 16,
      fontWeight: "600",
      color: theme.textPrimary,
    },
    metaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    badge: {
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      fontWeight: "600",
    },
    timestamp: {
      fontSize: 12,
      color: theme.textSecondary,
    },
    requestId: {
      fontSize: 12,
      color: theme.textSecondary,
    },
    undo: {
      fontSize: 12,
      color: theme.success,
      fontWeight: "600",
    },
    loadMoreButton: {
      marginTop: 12,
      alignSelf: "center",
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.accent,
    },
    loadMoreText: {
      color: theme.accent,
      fontWeight: "600",
    },
    footerGap: {
      height: 40,
    },
  });
};
