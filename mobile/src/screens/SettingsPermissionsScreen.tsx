import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Calendar, Shield, Power, PauseCircle, FileText } from "lucide-react-native";
import { getPreferences, updatePreferences, PreferencesResponse } from "../api/preferences";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";

type NavigationProp = NativeStackNavigationProp<RootStackParamList, "SettingsPermissions">;

export default function SettingsPermissionsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { userId, loading: userLoading } = useUserId();
  const [prefs, setPrefs] = useState<PreferencesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const fetchPrefs = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, requestId: reqId } = await getPreferences(userId);
      setPrefs(data);
      setRequestId(reqId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load preferences.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userLoading && userId) {
      fetchPrefs();
    }
  }, [fetchPrefs, userId, userLoading]);

  const handleToggle = async (
    key: keyof Pick<PreferencesResponse, "coaching_paused" | "weekly_plans_enabled" | "interventions_enabled">,
    value: boolean,
  ) => {
    if (!userId) return;
    setSavingKey(key);
    setError(null);
    try {
      const { data, requestId: reqId } = await updatePreferences(userId, { [key]: value });
      setPrefs(data);
      setRequestId(reqId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update preferences.");
    } finally {
      setSavingKey(null);
    }
  };

  if (userLoading || (loading && !prefs)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6B8DBF" />
        <Text style={styles.helper}>Loading your settings…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Agent Controls</Text>
      <Text style={styles.subtitle}>You are in charge. Configure how FlowBuddy helps you.</Text>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchPrefs}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {prefs ? (
        <>
          <View style={[styles.masterCard, prefs.coaching_paused ? styles.masterPaused : styles.masterActive]}>
            <View style={styles.masterHeader}>
              <View style={[styles.statusDot, prefs.coaching_paused ? styles.dotPaused : styles.dotActive]} />
              <Text style={styles.statusText}>{prefs.coaching_paused ? "Paused" : "Active"}</Text>
            </View>
            <Text style={styles.masterCopy}>
              {prefs.coaching_paused
                ? "FlowBuddy is in silent mode. No new plans will be generated."
                : "FlowBuddy is active and monitoring your plan."}
            </Text>
            <TouchableOpacity
              style={prefs.coaching_paused ? styles.resumeButton : styles.pauseButton}
              onPress={() => handleToggle("coaching_paused", !prefs.coaching_paused)}
              disabled={savingKey !== null}
            >
              {prefs.coaching_paused ? (
                <>
                  <Power size={16} color="#fff" />
                  <Text style={styles.resumeText}>Resume Coaching</Text>
                </>
              ) : (
                <>
                  <PauseCircle size={16} color="#1F2933" />
                  <Text style={styles.pauseText}>Pause Coaching (Snooze)</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Agent Permissions</Text>
            <SettingRow
              label="Weekly plans"
              description="Allow FlowBuddy to generate weekly plans."
              value={prefs.weekly_plans_enabled}
              onValueChange={(value) => handleToggle("weekly_plans_enabled", value)}
              disabled={savingKey !== null || prefs.coaching_paused}
              paused={prefs.coaching_paused}
              icon={<Calendar size={20} color="#6B7280" />}
            />
            <SettingRow
              label="Interventions"
              description="Allow proactive check-ins when slippage is detected."
              value={prefs.interventions_enabled}
              onValueChange={(value) => handleToggle("interventions_enabled", value)}
              disabled={savingKey !== null || prefs.coaching_paused}
              paused={prefs.coaching_paused}
              icon={<Shield size={20} color="#6B7280" />}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>System</Text>
            <TouchableOpacity style={styles.systemRow} onPress={() => navigation.navigate("AgentLog")}>
              <View style={styles.systemIcon}>
                <FileText size={18} color="#1F2933" />
              </View>
              <Text style={styles.systemText}>View Agent Log</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.debugLabel}>request_id: {requestId || prefs.request_id || "—"}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

type SettingRowProps = {
  label: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  paused?: boolean;
  onValueChange: (value: boolean) => void;
  icon?: React.ReactNode;
};

function SettingRow({ label, description, value, disabled, paused, onValueChange, icon }: SettingRowProps) {
  return (
    <View style={[styles.row, paused && styles.rowPaused]}>
      <View style={styles.iconCircle}>{icon}</View>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    gap: 16,
    backgroundColor: "#FAFAF8",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FAFAF8",
  },
  helper: {
    marginTop: 8,
    color: "#666",
  },
  title: {
    fontSize: 30,
    color: "#2D3748",
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
  },
  subtitle: {
    color: "#6B7280",
    fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
    marginBottom: 12,
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
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c62828",
  },
  retryText: {
    color: "#c62828",
    fontWeight: "600",
  },
  masterCard: {
    borderRadius: 24,
    padding: 20,
  },
  masterActive: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  masterPaused: {
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  masterHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotActive: {
    backgroundColor: "#16A34A",
  },
  dotPaused: {
    backgroundColor: "#B45309",
  },
  statusText: {
    color: "#374151",
    fontWeight: "600",
  },
  masterCopy: {
    marginTop: 8,
    color: "#1F2933",
  },
  pauseButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1F2933",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  resumeButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#6B8DBF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pauseText: {
    color: "#1F2933",
    fontWeight: "600",
  },
  resumeText: {
    color: "#fff",
    fontWeight: "600",
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontWeight: "600",
    color: "#1F2933",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  rowPaused: {
    opacity: 0.6,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontWeight: "600",
    color: "#111827",
  },
  rowDescription: {
    color: "#6B7280",
    marginTop: 4,
  },
  systemRow: {
    backgroundColor: "#fff",
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  systemIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  systemText: {
    flex: 1,
    fontWeight: "600",
    color: "#1F2933",
  },
  chevron: {
    fontSize: 20,
    color: "#94A3B8",
  },
  debugLabel: {
    marginTop: 24,
    fontSize: 12,
    color: "#6B7280",
    textAlign: "center",
  },
});
