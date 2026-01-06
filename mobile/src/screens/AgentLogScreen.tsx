import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { listAgentLog, AgentLogListItem } from "../api/agentLog";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";

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
        <ActivityIndicator />
        <Text style={styles.helper}>Loading agent log…</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={entries}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => fetchLogs({ reset: true })}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Agent Log</Text>
          <Text style={styles.subtitle}>
            A chronological record of FlowBuddy actions such as plan approvals, check-ins, and task updates.
          </Text>
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
          style={styles.card}
          onPress={() => navigation.navigate("AgentLogDetail", { logId: item.id })}
        >
          <Text style={styles.summary}>{item.summary}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.actionType}>{item.action_type}</Text>
            <Text style={styles.timestamp}>{new Date(item.created_at).toLocaleString()}</Text>
          </View>
          {item.request_id ? <Text style={styles.requestId}>request_id: {item.request_id}</Text> : null}
          {item.undo_available ? <Text style={styles.undo}>Undo available</Text> : null}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  helper: {
    marginTop: 12,
    color: "#666",
    textAlign: "center",
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  header: {
    marginBottom: 12,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
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
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e5f2",
    padding: 14,
    backgroundColor: "#fff",
    gap: 6,
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
  actionType: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#1a73e8",
    fontWeight: "600",
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
    borderColor: "#1a73e8",
  },
  loadMoreText: {
    color: "#1a73e8",
    fontWeight: "600",
  },
  footerGap: {
    height: 40,
  },
});
