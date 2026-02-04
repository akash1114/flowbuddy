import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pause, Play, Wind, X, CheckCircle2, BellOff } from "lucide-react-native";
import type { RootStackParamList } from "../../types/navigation";
import { useTheme } from "../theme";
import * as Notifications from "expo-notifications";
import { updateTaskCompletion } from "../api/tasks";
import { useUserId } from "../state/user";
import BrainDumpModal from "./components/BrainDumpModal";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const QUIET_HANDLER = {
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
};

const DEFAULT_HANDLER = {
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
};

export default function FocusModeScreen() {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<RouteProp<RootStackParamList, "FocusMode">>();
  const { taskTitle, durationMinutes, taskId } = route.params;
  const { theme } = useTheme();
  const { userId } = useUserId();
  const initialSeconds = useMemo(() => Math.max(60, Math.round(durationMinutes * 60)), [durationMinutes]);
  const [timeLeft, setTimeLeft] = useState(initialSeconds);
  const [isActive, setIsActive] = useState(true);
  const [isDistracted, setIsDistracted] = useState(false);
  const [capturedThoughts, setCapturedThoughts] = useState<string[]>([]);
  const [brainDumpVisible, setBrainDumpVisible] = useState(false);
  const [dndActive, setDndActive] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive || isDistracted) {
      return;
    }
    if (timeLeft <= 0) {
      setIsActive(false);
      return;
    }
    const interval = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [isActive, isDistracted, timeLeft]);

  const formattedTime = useMemo(() => {
    const minutes = Math.floor(timeLeft / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (timeLeft % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [timeLeft]);

  const minutesElapsed = Math.max(0, Math.floor((initialSeconds - timeLeft) / 60));
  const minutesRemaining = Math.max(0, Math.ceil(timeLeft / 60));
  const progressPercent = initialSeconds ? Math.min(100, Math.round(((initialSeconds - timeLeft) / initialSeconds) * 100)) : 0;

  const handleToggleTimer = () => {
    if (timeLeft === 0) return;
    setIsActive((prev) => !prev);
  };

  useEffect(() => {
    let mounted = true;
    const enableDnd = async () => {
      try {
        await Notifications.setNotificationHandler(QUIET_HANDLER);
        if (mounted) setDndActive(true);
      } catch {
        // ignore
      }
    };
    enableDnd();
    return () => {
      mounted = false;
      (async () => {
        try {
          await Notifications.setNotificationHandler(DEFAULT_HANDLER);
        } catch {
          // ignore
        }
      })();
    };
  }, []);

  const handleDistracted = () => {
    setIsActive(false);
    setBrainDumpVisible(true);
  };

  const finishSession = async () => {
    if (completing) return;
    if (taskId && !userId) {
      setCompleteError("Still loading your account. Try again in a moment.");
      return;
    }
    setCompleting(true);
    setCompleteError(null);
    try {
      if (taskId && userId) {
        await updateTaskCompletion(taskId, userId, true);
      }
      navigation.goBack();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to mark that task complete right now.";
      setCompleteError(message);
      Alert.alert("Task completion", message);
    } finally {
      setCompleting(false);
    }
  };

  const handleCompleteTask = () => {
    if (completing) return;
    Alert.alert("Complete focus?", "Wrap up this session and mark it complete?", [
      { text: "Keep Going", style: "cancel" },
      {
        text: "Complete",
        style: "destructive",
        onPress: finishSession,
      },
    ]);
  };

  const handleBrainDumpSaved = (entry: { acknowledgement: string; actionable: boolean; actionableItems: string[]; topics: string[]; sentiment: number; text: string }) => {
    setCapturedThoughts((prev) => [...prev, entry.text]);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={[styles.fullContainer, { backgroundColor: theme.background }]}>
        <View style={styles.headerRow}>
          <View style={styles.sessionHeaderLeft}>
            <Text style={[styles.headerLabel, { color: theme.textMuted }]}>Focus companion</Text>
            <Text style={[styles.headerTitle, { color: theme.textPrimary }]} numberOfLines={2}>
              {taskTitle}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.closeButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Exit focus mode"
          >
            <X color={theme.textPrimary} size={20} />
          </TouchableOpacity>
        </View>

        <View style={styles.dndRow}>
          <BellOff size={14} color={theme.textSecondary} />
          <Text style={[styles.dndText, { color: theme.textSecondary }]}>
            Quiet mode {dndActive ? "enabled" : "starting…"}
          </Text>
        </View>

        <View
          style={[
            styles.timerCard,
            { backgroundColor: theme.heroPrimary, borderColor: theme.border, shadowColor: theme.shadow },
          ]}
        >
          <Text style={[styles.timerText, { color: "#fff" }]}>{formattedTime}</Text>
          <View style={[styles.progressTrack, { backgroundColor: theme.surface }]}>
            <View style={[styles.progressFill, { width: `${progressPercent}%`, backgroundColor: theme.accent }]} />
          </View>
          <View style={styles.metricsRow}>
            <Text style={[styles.metricText, { color: theme.textSecondary }]}>{minutesElapsed}m in</Text>
            <Text style={[styles.metricText, { color: theme.textSecondary }]}>{minutesRemaining}m left</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: isActive ? theme.danger : theme.success }]}
            onPress={handleToggleTimer}
          >
            {isActive ? <Pause size={18} color="#fff" /> : <Play size={18} color="#fff" />}
            <Text style={styles.primaryButtonText}>{isActive ? "Pause" : "Resume"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
            onPress={handleDistracted}
          >
            <Wind size={18} color={theme.textPrimary} />
            <Text style={[styles.secondaryButtonText, { color: theme.textPrimary }]}>Save a thought</Text>
          </TouchableOpacity>

        <TouchableOpacity
          style={[styles.completeButton, { backgroundColor: theme.accent }]}
          onPress={handleCompleteTask}
          disabled={completing}
        >
          <CheckCircle2 size={18} color="#fff" />
          <Text style={styles.completeButtonText}>{completing ? "Ending…" : "End session"}</Text>
        </TouchableOpacity>
        {completeError ? <Text style={[styles.errorText, { color: theme.danger }]}>{completeError}</Text> : null}
      </View>

        <View style={[styles.thoughtsCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.thoughtHeader}>
            <Wind size={16} color={theme.textSecondary} />
            <Text style={[styles.sectionHeading, { color: theme.textPrimary }]}>Captured thoughts</Text>
          </View>
          {capturedThoughts.length ? (
            capturedThoughts.slice(-3).map((thought, index) => (
              <Text key={`${thought}-${index}`} style={[styles.thoughtText, { color: theme.textSecondary }]}>
                • {thought}
              </Text>
            ))
          ) : (
            <Text style={[styles.emptyThoughtText, { color: theme.textSecondary }]}>All clear for now.</Text>
          )}
        </View>
      </View>

      <BrainDumpModal
        visible={brainDumpVisible}
        onClose={() => {
          setBrainDumpVisible(false);
          if (timeLeft > 0) {
            setIsActive(true);
          }
        }}
        onSaved={handleBrainDumpSaved}
        title="Capture your thought"
        subtitle="Park it here and we’ll keep it safe outside the session."
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  fullContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
    paddingTop: 16,
    gap: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  headerLabel: {
    fontSize: 12,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "700",
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  sessionHeaderLeft: {
    flex: 1,
    paddingRight: 12,
  },
  dndRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dndText: {
    fontSize: 13,
  },
  timerCard: {
    borderRadius: 28,
    paddingVertical: 36,
    paddingHorizontal: 24,
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    borderWidth: 1,
  },
  timerText: {
    fontSize: 80,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: 2,
    textAlign: "center",
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    marginTop: 16,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  metricsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
  },
  metricText: {
    fontSize: 14,
    fontWeight: "600",
  },
  actions: {
    gap: 12,
    marginTop: 12,
  },
  primaryButton: {
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  secondaryButton: {
    borderRadius: 18,
    paddingVertical: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  secondaryButtonText: {
    fontWeight: "700",
    fontSize: 16,
  },
  completeButton: {
    borderRadius: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  completeButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  overlay: {
    position: "absolute",
    inset: 0,
    justifyContent: "flex-end",
  },
  overlayCard: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderWidth: 1,
  },
  overlayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  overlayTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  overlaySubtitle: {
    marginTop: 4,
    fontSize: 14,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: "top",
    borderRadius: 18,
    marginTop: 16,
    padding: 16,
    borderWidth: 1,
  },
  overlayButton: {
    marginTop: 16,
    borderRadius: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  overlayButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  thoughtsCard: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    marginBottom: 24,
  },
  thoughtHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: "600",
  },
  thoughtText: {
    marginTop: 8,
    lineHeight: 20,
  },
  emptyThoughtText: {
    marginTop: 8,
    fontStyle: "italic",
  },
  errorText: {
    marginTop: 4,
    fontSize: 13,
    textAlign: "center",
  },
});
