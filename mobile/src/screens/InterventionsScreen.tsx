import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getInterventionsLatest, runInterventions, InterventionResponse } from "../api/interventions";
import { useUserId } from "../state/user";

export default function InterventionsScreen() {
  const { userId, loading: userLoading } = useUserId();
  const [snapshot, setSnapshot] = useState<InterventionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);

  const fetchSnapshot = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { intervention, requestId: reqId, notFound: none } = await getInterventionsLatest(userId);
      setSnapshot(intervention);
      setRequestId(reqId);
      setNotFound(none);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load interventions.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userLoading && userId) {
      fetchSnapshot();
    }
  }, [fetchSnapshot, userId, userLoading]);

  const handleGenerate = async () => {
    if (!userId) return;
    setRunning(true);
    setError(null);
    try {
      const { intervention, requestId: reqId } = await runInterventions(userId);
      setSnapshot(intervention);
      setRequestId(reqId);
      setNotFound(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate check-in.");
    } finally {
      setRunning(false);
    }
  };

  if (userLoading || (loading && !refreshing)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.helper}>Preparing your check-in…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchSnapshot(); }} />}
    >
      <Text style={styles.title}>Interventions</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {snapshot ? (
        <View style={styles.card}>
          <Text style={styles.week}>{snapshot.week.start} → {snapshot.week.end}</Text>
          <Text style={styles.sectionLabel}>Slippage</Text>
          <Text style={styles.body}>Flagged: {snapshot.slippage.flagged ? "Yes" : "No"}</Text>
          <Text style={styles.body}>Reason: {snapshot.slippage.reason || "—"}</Text>
          <Text style={styles.body}>Completion: {(snapshot.slippage.completion_rate * 100).toFixed(0)}%</Text>
          <Text style={styles.body}>Missed scheduled: {snapshot.slippage.missed_scheduled}</Text>

          {snapshot.card ? (
            <View style={styles.cardSection}>
              <Text style={[styles.sectionLabel, styles.mt16]}>{snapshot.card.title}</Text>
              <Text style={styles.body}>{snapshot.card.message}</Text>
              {snapshot.card.options.map((option) => (
                <View key={option.key} style={styles.optionRow}>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  <Text style={styles.optionDetails}>{option.details}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Looks on track</Text>
              <Text style={styles.helper}>No intervention needed right now.</Text>
            </View>
          )}

          <View style={styles.debugBox}>
            <Text style={styles.debugLabel}>Req ID: {requestId || snapshot.request_id || "—"}</Text>
          </View>
        </View>
      ) : null}

      {!snapshot && notFound ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No check-in yet</Text>
          <Text style={styles.helper}>You can generate a gentle check-in based on your recent week.</Text>
          <TouchableOpacity style={[styles.button, running && styles.buttonDisabled]} onPress={handleGenerate} disabled={running}>
            {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Generate Interventions</Text>}
          </TouchableOpacity>
        </View>
      ) : null}

      {snapshot ? (
        <TouchableOpacity style={[styles.button, running && styles.buttonDisabled]} onPress={handleGenerate} disabled={running}>
          {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Refresh Check-In</Text>}
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: "#111",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e7f0",
    padding: 16,
    backgroundColor: "#fff",
  },
  week: {
    fontWeight: "600",
    color: "#1a73e8",
    marginBottom: 8,
  },
  sectionLabel: {
    fontWeight: "600",
    marginTop: 8,
  },
  body: {
    color: "#444",
    marginTop: 4,
  },
  cardSection: {
    marginTop: 12,
  },
  mt16: {
    marginTop: 16,
  },
  optionRow: {
    marginTop: 8,
  },
  optionLabel: {
    fontWeight: "600",
    color: "#222",
  },
  optionDetails: {
    color: "#555",
  },
  button: {
    marginTop: 12,
    backgroundColor: "#1a73e8",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonDisabled: {
    backgroundColor: "#8fb5f8",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  helper: {
    marginTop: 8,
    color: "#666",
    textAlign: "center",
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#dfe3ec",
    padding: 16,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  error: {
    color: "#c62828",
  },
  debugBox: {
    marginTop: 16,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#f3f4f8",
  },
  debugLabel: {
    fontSize: 12,
    color: "#555",
  },
});
