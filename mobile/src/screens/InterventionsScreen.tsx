import { useCallback, useEffect, useState } from "react";
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
import { ShieldAlert, CheckCircle } from "lucide-react-native";
import { getInterventionsLatest, runInterventions, InterventionResponse } from "../api/interventions";
import { useUserId } from "../state/user";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../types/navigation";

type Nav = NativeStackNavigationProp<RootStackParamList, "Interventions">;

export default function InterventionsScreen() {
  const { userId, loading: userLoading } = useUserId();
  const navigation = useNavigation<Nav>();
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

  if ((userLoading || loading) && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6B8DBF" />
        <Text style={styles.helper}>Preparing your check-in…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchSnapshot(); }} />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Interventions</Text>
        <TouchableOpacity style={styles.linkButton} onPress={() => navigation.navigate("InterventionsHistory")}>
          <Text style={styles.linkText}>History</Text>
        </TouchableOpacity>
      </View>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchSnapshot}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {snapshot ? (
        <>
          <StatusCard snapshot={snapshot} />
          {snapshot.slippage.flagged && snapshot.card ? (
            <View style={styles.suggestionCard}>
              <Text style={styles.suggestionTitle}>Agent Suggestion</Text>
              <Text style={styles.suggestionMessage}>{snapshot.card.message}</Text>
              {snapshot.card.options.map((option) => (
                <TouchableOpacity key={option.key} style={styles.optionButton}>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  <Text style={styles.optionDetails}>{option.details}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <View style={styles.debugBox}>
            <Text style={styles.debugLabel}>Req ID: {requestId || snapshot.request_id || "—"}</Text>
          </View>
        </>
      ) : null}

      {!snapshot ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No check-in needed yet.</Text>
          <Text style={styles.helper}>Check back Thursday!</Text>
          <TouchableOpacity
            style={[styles.button, running && styles.buttonDisabled]}
            onPress={handleGenerate}
            disabled={running}
          >
            {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Generate Check-in</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}

function StatusCard({ snapshot }: { snapshot: InterventionResponse }) {
  const flagged = snapshot.slippage.flagged;
  const completion = Math.round(snapshot.slippage.completion_rate * 100);
  const theme = flagged
    ? { card: styles.warningCard, icon: <ShieldAlert size={42} color="#B45309" />, title: "Slippage detected" }
    : { card: styles.safeCard, icon: <CheckCircle size={42} color="#15803D" />, title: "On track" };
  return (
    <View style={[styles.statusCard, theme.card]}>
      {theme.icon}
      <View style={styles.statusContent}>
        <Text style={styles.statusTitle}>{theme.title}</Text>
        <Text style={styles.statusMeta}>Completion Rate: {completion}%</Text>
        <Text style={styles.statusMeta}>Missed scheduled: {snapshot.slippage.missed_scheduled}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16,
    backgroundColor: "#FAFAF8",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#FAFAF8",
  },
  title: {
    fontSize: 28,
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    color: "#2D3748",
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
    color: "#6B8DBF",
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
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
  },
  safeCard: {
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  statusContent: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1F2933",
  },
  statusMeta: {
    color: "#475467",
    marginTop: 4,
  },
  suggestionCard: {
    marginTop: 12,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  suggestionTitle: {
    fontWeight: "600",
    color: "#1F2933",
  },
  suggestionMessage: {
    marginTop: 6,
    color: "#4B5563",
  },
  optionButton: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  optionLabel: {
    fontWeight: "600",
    color: "#1F2933",
  },
  optionDetails: {
    color: "#6B7280",
    marginTop: 4,
  },
  button: {
    marginTop: 16,
    backgroundColor: "#6B8DBF",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  buttonDisabled: {
    backgroundColor: "#A5B8D9",
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
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 24,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 12,
    color: "#1F2933",
  },
  error: {
    color: "#c62828",
  },
  errorBox: {
    backgroundColor: "#fdecea",
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
    borderColor: "#c62828",
  },
  retryText: {
    color: "#c62828",
    fontWeight: "600",
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
    textAlign: "center",
  },
});
