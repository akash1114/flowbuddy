import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";

import { getAgentLogItem, AgentLogDetail } from "../api/agentLog";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";

type Route = RouteProp<RootStackParamList, "AgentLogDetail">;

export default function AgentLogDetailScreen() {
  const route = useRoute<Route>();
  const { logId } = route.params;
  const { userId, loading: userLoading } = useUserId();

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
        <ActivityIndicator />
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.summary}>{entry.summary}</Text>
      <View style={styles.metaCard}>
        <InfoRow label="Action type" value={entry.action_type} />
        <InfoRow label="Created at" value={createdAt} />
        <InfoRow label="Undo available" value={entry.undo_available ? "Yes" : "No"} />
        {entry.request_id ? <InfoRow label="request_id" value={entry.request_id} /> : null}
        {requestId ? <InfoRow label="request_id header" value={requestId} /> : null}
      </View>

      <View style={styles.payloadBox}>
        <Text style={styles.payloadLabel}>Payload</Text>
        <ScrollView horizontal>
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

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
    backgroundColor: "#f6f7fb",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  helper: {
    marginTop: 8,
    color: "#666",
    textAlign: "center",
  },
  error: {
    color: "#c62828",
    textAlign: "center",
    marginBottom: 12,
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c62828",
  },
  retryText: {
    color: "#c62828",
    fontWeight: "600",
  },
  summary: {
    fontSize: 22,
    fontWeight: "600",
    color: "#111",
  },
  metaCard: {
    borderRadius: 12,
    backgroundColor: "#fff",
    padding: 12,
    borderWidth: 1,
    borderColor: "#e0e5f2",
    gap: 8,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: "#555",
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111",
    flex: 1,
    textAlign: "right",
  },
  payloadBox: {
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e5f2",
    padding: 12,
  },
  payloadLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  payloadText: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 12,
    color: "#222",
    minWidth: 250,
  },
});
