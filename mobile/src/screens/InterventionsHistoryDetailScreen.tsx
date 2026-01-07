import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Platform } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { getInterventionHistoryItem, InterventionResponse } from "../api/interventions";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "InterventionsHistoryDetail">;

export default function InterventionsHistoryDetailScreen({ route }: Props) {
  const { logId } = route.params;
  const { userId, loading: userLoading } = useUserId();
  const [snapshot, setSnapshot] = useState<InterventionResponse | null>(null);
  const [meta, setMeta] = useState<{ created_at: string; week_start: string; week_end: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { detail, meta } = await getInterventionHistoryItem(userId, logId);
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
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color="#6B8DBF" />}
      </View>
    );
  }

  const flagged = snapshot.slippage.flagged;
  const completion = Math.round(snapshot.slippage.completion_rate * 100);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={[styles.heroCard, flagged ? styles.heroAmber : styles.heroGreen]}>
        <Text style={styles.subtitle}>Support Report • {new Date(meta.created_at).toLocaleDateString()}</Text>
        <Text style={styles.title}>Completion Rate: {completion}%</Text>
        <Text style={styles.helper}>
          Week {meta.week_start} – {meta.week_end}
        </Text>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionLabel}>Agent Diagnosis</Text>
        <Text style={styles.body}>{snapshot.slippage.reason || "No additional notes."}</Text>
      </View>

      {snapshot.card ? (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>{snapshot.card.title}</Text>
          <Text style={styles.body}>{snapshot.card.message}</Text>
          {snapshot.card.options.map((option) => (
            <View key={option.key} style={styles.optionRow}>
              <Text style={styles.optionLabel}>{option.label}</Text>
              <Text style={styles.optionDetails}>{option.details}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
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
    padding: 16,
    backgroundColor: "#FAFAF8",
  },
  heroCard: {
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
  },
  heroAmber: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FED7AA",
  },
  heroGreen: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
  },
  subtitle: {
    color: "#6B7280",
    textTransform: "uppercase",
    fontSize: 12,
    letterSpacing: 1,
  },
  title: {
    fontSize: 28,
    color: "#2D3748",
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    marginTop: 8,
  },
  helper: {
    color: "#6B7280",
    marginTop: 4,
  },
  sectionCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  sectionLabel: {
    fontWeight: "600",
    color: "#1F2933",
  },
  body: {
    marginTop: 6,
    color: "#475569",
  },
  optionRow: {
    marginTop: 12,
  },
  optionLabel: {
    fontWeight: "600",
    color: "#1F2933",
  },
  optionDetails: {
    color: "#6B7280",
    marginTop: 4,
  },
  error: {
    color: "#c62828",
  },
});
