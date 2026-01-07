import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { listAgentLog, AgentLogListItem } from "../api/agentLog";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";
import { Brain, Target, ShieldAlert, FileText } from "lucide-react-native";

type Nav = NativeStackNavigationProp<RootStackParamList, "AgentLog">;

export default function AgentLogScreen() {
  const navigation = useNavigation<Nav>();
  const { userId, loading: userLoading } = useUserId();
  const [entries, setEntries] = useState<AgentLogListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchLogs = useCallback(
    async ({ reset, cursor }: { reset?: boolean; cursor?: string | null } = {}) => {
      if (!userId) return;
      if (reset) {
        setRefreshing(true);
        setError(null);
      }
      try {
        const { items, nextCursor: cursorValue } = await listAgentLog(userId, {
          limit: 50,
          cursor: cursor ?? (reset ? null : undefined),
        });
        setEntries((prev) => (reset ? items : [...prev, ...items]));
        setNextCursor(cursorValue);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load agent log.");
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!userLoading && userId) {
      fetchLogs({ reset: true });
    }
  }, [fetchLogs, userId, userLoading]);

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchLogs({ cursor: nextCursor });
  }, [fetchLogs, loadingMore, nextCursor]);

  if (userLoading || (loading && !entries.length)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6B8DBF" />
        <Text style={styles.helper}>Loading agent log…</Text>
      </View>
    );
  }

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
              <Text style={[styles.badge, getBadgeStyle(item.action_type)]}>{item.action_type}</Text>
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

function renderIcon(actionType: string) {
  const lower = actionType.toLowerCase();
  if (lower.includes("brain_dump")) {
    return (
      <View style={[styles.iconCircle, styles.iconPurple]}>
        <Brain size={18} color="#7C3AED" />
      </View>
    );
  }
  if (lower.includes("resolution")) {
    return (
      <View style={[styles.iconCircle, styles.iconBlue]}>
        <Target size={18} color="#2563EB" />
      </View>
    );
  }
  if (lower.includes("intervention")) {
    return (
      <View style={[styles.iconCircle, styles.iconAmber]}>
        <ShieldAlert size={18} color="#B45309" />
      </View>
    );
  }
  return (
    <View style={[styles.iconCircle, styles.iconGray]}>
      <FileText size={18} color="#475569" />
    </View>
  );
}

function getBadgeStyle(actionType: string) {
  const lower = actionType.toLowerCase();
  if (lower.includes("brain_dump")) return styles.badgePurple;
  if (lower.includes("resolution")) return styles.badgeBlue;
  if (lower.includes("intervention")) return styles.badgeAmber;
  return styles.badgeGray;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FAFAF8",
  },
  helper: {
    marginTop: 12,
    color: "#666",
    textAlign: "center",
  },
  listContent: {
    padding: 16,
    gap: 12,
    backgroundColor: "#FAFAF8",
  },
  header: {
    marginBottom: 12,
    gap: 8,
  },
  title: {
    fontSize: 30,
    color: "#2D3748",
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
  },
  subtitle: {
    color: "#555",
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
  iconPurple: {
    backgroundColor: "#F3EEFF",
  },
  iconBlue: {
    backgroundColor: "#E0ECFF",
  },
  iconAmber: {
    backgroundColor: "#FEF3C7",
  },
  iconGray: {
    backgroundColor: "#E2E8F0",
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e5f2",
    padding: 14,
    backgroundColor: "#fff",
    gap: 6,
    flex: 1,
    marginLeft: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  brainCard: {
    backgroundColor: "#F8F7FC",
    borderColor: "#E9E5FF",
  },
  summary: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111",
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
  badgePurple: {
    backgroundColor: "#EEE5FF",
    color: "#6D28D9",
  },
  badgeBlue: {
    backgroundColor: "#DBEAFE",
    color: "#1D4ED8",
  },
  badgeAmber: {
    backgroundColor: "#FEF3C7",
    color: "#B45309",
  },
  badgeGray: {
    backgroundColor: "#E5E7EB",
    color: "#4B5563",
  },
  timestamp: {
    fontSize: 12,
    color: "#666",
  },
  requestId: {
    fontSize: 12,
    color: "#555",
  },
  undo: {
    fontSize: 12,
    color: "#0b9444",
    fontWeight: "600",
  },
  loadMoreButton: {
    marginTop: 12,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#6B8DBF",
  },
  loadMoreText: {
    color: "#6B8DBF",
    fontWeight: "600",
  },
  footerGap: {
    height: 40,
  },
});
