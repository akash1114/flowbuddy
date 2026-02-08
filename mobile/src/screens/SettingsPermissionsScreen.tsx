import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Calendar, Shield, Power, PauseCircle, FileText, Bell, Sparkles } from "lucide-react-native";
import { getPreferences, updatePreferences, PreferencesResponse } from "../api/preferences";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";
import { useNotifications } from "../hooks/useNotifications";
import { useTheme } from "../theme";

type NavigationProp = NativeStackNavigationProp<RootStackParamList, "SettingsPermissions">;

type SettingRowProps = {
  label: string;
  description: string;
  value: boolean;
  disabled?: boolean;
  paused?: boolean;
  onValueChange: (value: boolean) => void;
  icon?: React.ReactNode;
};

export default function SettingsPermissionsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { userId, loading: userLoading } = useUserId();
  const { registerForPushNotificationsAsync } = useNotifications();
  const { theme } = useTheme();
  const [prefs, setPrefs] = useState<PreferencesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<"unknown" | "granted" | "denied">("unknown");

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
      <View style={[styles.center, { backgroundColor: theme.background }]}> 
        <ActivityIndicator color={theme.accent} />
        <Text style={[styles.helper, { color: theme.textSecondary }]}>Loading your settings…</Text>
      </View>
    );
  }

  const handleNotificationEnable = async () => {
    if (!userId) {
      Alert.alert("Notifications", "User not ready yet. Try again shortly.");
      return;
    }
    try {
      const granted = await registerForPushNotificationsAsync(userId);
      setNotificationStatus(granted ? "granted" : "denied");
      Alert.alert(
        granted ? "Notifications enabled" : "Permission denied",
        granted
          ? "Great! We'll nudge you when tasks are due."
          : "We can't send reminders without permission. You can try again anytime.",
      );
    } catch (err) {
      Alert.alert("Notifications", err instanceof Error ? err.message : "Unable to update permission.");
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}> 
      <Text style={[styles.title, { color: theme.textPrimary }]}>Agent Controls</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>You are in charge. Configure how Sarthi AI helps you.</Text>

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: theme.accentSoft }]}> 
          <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
          <TouchableOpacity style={[styles.retryButton, { borderColor: theme.danger }]} onPress={fetchPrefs}>
            <Text style={[styles.retryText, { color: theme.danger }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {prefs ? (
        <>
          <View
            style={[styles.masterCard, { backgroundColor: theme.card, borderColor: theme.border, shadowColor: theme.shadow }]}
          >
            <View style={styles.masterHeader}>
              <View
                style={[styles.statusDot, { backgroundColor: prefs.coaching_paused ? theme.danger : theme.success }]}
              />
              <Text style={[styles.statusText, { color: theme.textPrimary }]}>
                {prefs.coaching_paused ? "Paused" : "Active"}
              </Text>
            </View>
            <Text style={[styles.masterCopy, { color: theme.textSecondary }]}>
              {prefs.coaching_paused
                ? "Sarthi AI is in silent mode. No new plans will be generated."
                : "Sarthi AI is active and monitoring your plan."}
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: prefs.coaching_paused ? theme.accent : theme.surface }]}
              onPress={() => handleToggle("coaching_paused", !prefs.coaching_paused)}
              disabled={savingKey !== null}
            >
              {prefs.coaching_paused ? (
                <>
                  <Power size={16} color="#fff" />
                  <Text style={styles.primaryButtonText}>Resume Coaching</Text>
                </>
              ) : (
                <>
                  <PauseCircle size={16} color={theme.textPrimary} />
                  <Text style={[styles.secondaryButtonText, { color: theme.textPrimary }]}>Pause Coaching (Snooze)</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Agent Permissions</Text>
            <SettingRow
              label="Next week blueprint"
              description="Allow Sarthi AI to generate the upcoming week's blueprint."
              value={prefs.weekly_plans_enabled}
              onValueChange={(value) => handleToggle("weekly_plans_enabled", value)}
              disabled={savingKey !== null || prefs.coaching_paused}
              paused={prefs.coaching_paused}
              icon={<Calendar size={20} color={theme.textSecondary} />}
            />
            <SettingRow
              label="Interventions"
              description="Allow proactive check-ins when slippage is detected."
              value={prefs.interventions_enabled}
              onValueChange={(value) => handleToggle("interventions_enabled", value)}
              disabled={savingKey !== null || prefs.coaching_paused}
              paused={prefs.coaching_paused}
              icon={<Shield size={20} color={theme.textSecondary} />}
            />
          </View>

          <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>System</Text>
            <TouchableOpacity
              style={[styles.systemRow, { borderColor: theme.border }]}
              onPress={handleNotificationEnable}
            >
              <View style={[styles.systemIcon, { backgroundColor: theme.surfaceMuted }]}>
                <Bell size={18} color={theme.textPrimary} />
              </View>
              <View style={styles.notificationText}>
                <Text style={[styles.systemText, { color: theme.textPrimary }]}>Push reminders</Text>
                <Text style={[styles.notificationHelper, { color: theme.textSecondary }]}>
                  {notificationStatus === "granted"
                    ? "Enabled"
                    : notificationStatus === "denied"
                      ? "Permission denied"
                      : "Tap to enable task reminders"}
                </Text>
              </View>
              <Text style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.systemRow, { borderColor: theme.border }]}
              onPress={() => navigation.navigate("AgentLog")}
            >
              <View style={[styles.systemIcon, { backgroundColor: theme.surfaceMuted }]}>
                <FileText size={18} color={theme.textPrimary} />
              </View>
              <View style={styles.notificationText}>
                <Text style={[styles.systemText, { color: theme.textPrimary }]}>Agent Log</Text>
                <Text style={[styles.notificationHelper, { color: theme.textSecondary }]}>
                  See every autonomous action.
                </Text>
              </View>
              <Text style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.systemRow, { borderColor: theme.border }]}
              onPress={() => navigation.navigate("Personalization")}
            >
              <View style={[styles.systemIcon, { backgroundColor: theme.surfaceMuted }]}>
                <Sparkles size={18} color={theme.textPrimary} />
              </View>
              <View style={styles.notificationText}>
                <Text style={[styles.systemText, { color: theme.textPrimary }]}>Personalize your flow</Text>
                <Text style={[styles.notificationHelper, { color: theme.textSecondary }]}>
                  Tell Sarathi your schedule & energy peaks.
                </Text>
              </View>
              <Text style={[styles.chevron, { color: theme.textSecondary }]}>›</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.debugLabel, { color: theme.textMuted }]}>request_id: {requestId || prefs.request_id || "—"}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

function SettingRow({ label, description, value, disabled, paused, onValueChange, icon }: SettingRowProps) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.card,
          borderColor: theme.border,
          shadowColor: theme.shadow,
          opacity: paused ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.iconCircle, { backgroundColor: theme.surfaceMuted }]}>{icon}</View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>{label}</Text>
        <Text style={[styles.rowDescription, { color: theme.textSecondary }]}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    gap: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  helper: {
    marginTop: 8,
    textAlign: "center",
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
  },
  subtitle: {
    marginBottom: 12,
  },
  errorBox: {
    borderRadius: 12,
    padding: 12,
  },
  error: {
    fontWeight: "600",
  },
  retryButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  retryText: {
    fontWeight: "600",
  },
  masterCard: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
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
  statusText: {
    fontWeight: "600",
  },
  masterCopy: {
    marginTop: 8,
    fontSize: 14,
  },
  primaryButton: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  secondaryButtonText: {
    fontWeight: "600",
  },
  section: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  sectionTitle: {
    fontWeight: "600",
    fontSize: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: 1,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontWeight: "600",
  },
  rowDescription: {
    marginTop: 4,
    fontSize: 13,
  },
  systemRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  systemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  systemText: {
    flex: 1,
    fontWeight: "600",
  },
  notificationText: {
    flex: 1,
  },
  notificationHelper: {
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    fontSize: 20,
  },
  debugLabel: {
    marginTop: 24,
    fontSize: 12,
    textAlign: "center",
  },
});
