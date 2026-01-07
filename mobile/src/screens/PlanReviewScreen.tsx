import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import DateTimePicker from "@react-native-community/datetimepicker";
import { approveResolution, TaskEditPayload, ApprovalResponse } from "../api/resolutions";
import { useUserId } from "../state/user";
import { EditableTask, useResolutionPlan } from "../hooks/useResolutionPlan";
import type { RootStackParamList } from "../../types/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "PlanReview">;

export default function PlanReviewScreen({ route, navigation }: Props) {
  const { resolutionId, initialResolution } = route.params;
  const { userId, loading: userLoading } = useUserId();
  const {
    plan,
    tasks,
    loading: planLoading,
    error: planError,
    setTasks,
    regenerate,
  } = useResolutionPlan({ resolutionId, userId, initialResolution });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState<ApprovalResponse | null>(null);
  const [pickerState, setPickerState] = useState<{
    taskId: string;
    mode: "date" | "time";
    value: Date;
  } | null>(null);

  const milestones = useMemo(() => plan?.plan.milestones ?? [], [plan]);

  const updateTaskField = (taskId: string, field: keyof EditableTask, value: string) => {
    setTasks((prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, [field]: value } : task)),
    );
  };

  const validateTasks = (): string | null => {
    for (const task of tasks) {
      if (task.scheduled_day && !/^\d{4}-\d{2}-\d{2}$/.test(task.scheduled_day)) {
        return `Use YYYY-MM-DD for ${task.title}.`;
      }
      if (task.scheduled_time && !/^\d{2}:\d{2}$/.test(task.scheduled_time)) {
        return `Use HH:MM for ${task.title}.`;
      }
      if (task.duration_min && (!/^\d+$/.test(task.duration_min) || Number(task.duration_min) <= 0)) {
        return `Duration for ${task.title} should be a positive number of minutes.`;
      }
    }
    return null;
  };

  const buildTaskEdits = (): TaskEditPayload[] => {
    const edits: TaskEditPayload[] = [];
    for (const task of tasks) {
      const payload: TaskEditPayload = { task_id: task.id };
      let changed = false;
      const trimmedTitle = task.title.trim();
      if (trimmedTitle && trimmedTitle !== task.original.title) {
        payload.title = trimmedTitle;
        changed = true;
      }
      if (task.scheduled_day && task.scheduled_day !== (task.original.scheduled_day ?? "")) {
        payload.scheduled_day = task.scheduled_day;
        changed = true;
      }
      if (task.scheduled_time && task.scheduled_time !== (task.original.scheduled_time ?? "")) {
        payload.scheduled_time = task.scheduled_time;
        changed = true;
      }
      if (task.duration_min) {
        const durationValue = Number(task.duration_min);
        if (task.original.duration_min !== durationValue) {
          payload.duration_min = durationValue;
          changed = true;
        }
      }
      if (changed) {
        edits.push(payload);
      }
    }
    return edits;
  };

  const openPicker = (task: EditableTask, mode: "date" | "time") => {
    const value =
      mode === "date" ? parseDate(task.scheduled_day) ?? new Date() : parseTime(task.scheduled_time) ?? new Date();
    setPickerState({
      taskId: task.id,
      mode,
      value,
    });
  };

  const closePicker = () => setPickerState(null);

  const confirmPicker = () => {
    if (!pickerState) return;
    const formatted = pickerState.mode === "date" ? formatDate(pickerState.value) : formatTime(pickerState.value);
    if (pickerState.mode === "date") {
      updateTaskField(pickerState.taskId, "scheduled_day", formatted);
    } else {
      updateTaskField(pickerState.taskId, "scheduled_time", formatted);
    }
    closePicker();
  };

  const handleAccept = async () => {
    if (!userId || userLoading) return;
    const validationError = validateTasks();
    if (validationError) {
      setError(validationError);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const task_edits = buildTaskEdits();
      const { result } = await approveResolution(resolutionId, {
        user_id: userId,
        decision: "accept",
        task_edits,
      });

      setSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to approve this plan right now.");
    } finally {
      setPending(false);
    }
  };

  const handleReject = async () => {
    if (!userId) return;
    try {
      await approveResolution(resolutionId, { user_id: userId, decision: "reject" });
      Alert.alert("Captured", "Plan kept in draft. Feel free to revisit anytime.");
      navigation.navigate("Home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update the plan right now.");
    }
  };

  const handleRegenerate = () => {
    if (!userId) return;
    setError(null);
    setSuccess(null);
    regenerate();
  };

  const acceptDisabled = pending || userLoading || planLoading || !userId || !plan || !tasks.length || !!success;
  const combinedError = error || planError;

  if ((planLoading || userLoading) && !plan) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator color="#6B8DBF" />
        <Text style={styles.helper}>Generating a friendly outline…</Text>
      </View>
    );
  }

  const focusForWeekOne = milestones.find((milestone) => milestone.week === 1)?.focus ?? milestones[0]?.focus ?? "";

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {plan ? (
            <View style={styles.header}>
              <Text style={styles.heroTitle}>Proposed Plan</Text>
              <Text style={styles.heroSubtitle}>Goal: {plan.title}</Text>
            </View>
          ) : null}

          {combinedError ? <Text style={styles.error}>{combinedError}</Text> : null}

          {plan ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitleSerif}>Vision</Text>
                <Text style={styles.sectionHelper}>{plan.plan.weeks} weeks</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeline}>
                {milestones.map((milestone) => {
                  const active = milestone.week === 1;
                  return (
                    <View key={milestone.week} style={[styles.weekPill, active && styles.weekPillActive]}>
                      <Text style={[styles.weekLabel, active && styles.weekLabelActive]}>W{milestone.week}</Text>
                    </View>
                  );
                })}
              </ScrollView>
              <Text style={styles.focusLabel}>Focus: {focusForWeekOne || "Reinforce your routine"}</Text>
            </View>
          ) : null}

          {tasks.length ? (
            <View style={styles.taskSection}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitleSerif}>Week 1 Tasks</Text>
                <Text style={styles.sectionHelper}>Editable</Text>
              </View>
              {tasks.map((task) => (
                <View key={task.id} style={styles.taskCard}>
                  <TextInput
                    style={styles.taskInput}
                    value={task.title}
                    onChangeText={(value) => updateTaskField(task.id, "title", value)}
                    placeholder="Describe the task..."
                    editable={!pending && !success}
                  />
                  <View style={styles.taskControls}>
                    <TouchableOpacity
                      style={styles.pillButton}
                      onPress={() => openPicker(task, "date")}
                      disabled={pending || !!success}
                    >
                      <Text style={styles.pillText}>{task.scheduled_day || "Pick date"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.pillButton}
                      onPress={() => openPicker(task, "time")}
                      disabled={pending || !!success}
                    >
                      <Text style={styles.pillText}>{task.scheduled_time || "Pick time"}</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={styles.durationInput}
                      placeholder="Minutes"
                      keyboardType="number-pad"
                      value={task.duration_min}
                      onChangeText={(value) => updateTaskField(task.id, "duration_min", value.replace(/[^0-9]/g, ""))}
                      editable={!pending && !success}
                    />
                  </View>
                </View>
              ))}
              <TouchableOpacity style={styles.addButton} onPress={() => Alert.alert("Coming soon", "Task creation is in beta.")}>
                <Text style={styles.addButtonText}>+ Add another task</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {success ? (
            <View style={styles.successCard}>
              <Text style={styles.successTitle}>Plan Activated</Text>
              <Text style={styles.successSubtitle}>Week 1 tasks are now live in My Week.</Text>
              <TouchableOpacity style={styles.successButton} onPress={() => navigation.navigate("Home")}>
                <Text style={styles.successButtonText}>Back to Home</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>

        {!success ? (
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.primaryButton, acceptDisabled && styles.primaryButtonDisabled]}
              onPress={handleAccept}
              disabled={acceptDisabled}
            >
              {pending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Start Resolution</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleRegenerate} disabled={pending} style={styles.secondaryLink}>
              <Text style={styles.secondaryButtonText}>Regenerate</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleReject} disabled={pending}>
              <Text style={styles.rejectText}>Reject Plan</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {pickerState ? (
        <Modal transparent animationType="fade">
          <View style={styles.pickerBackdrop}>
            <View style={styles.pickerCard}>
              <Text style={styles.sectionTitleSerif}>{pickerState.mode === "date" ? "Pick a date" : "Pick a time"}</Text>
              <DateTimePicker
                value={pickerState.value}
                mode={pickerState.mode}
                display="spinner"
                onChange={(_, date) => {
                  if (date) {
                    setPickerState((prev) => (prev ? { ...prev, value: date } : prev));
                  }
                }}
              />
              <View style={styles.pickerActions}>
                <TouchableOpacity style={styles.modalButton} onPress={closePicker}>
                  <Text style={styles.secondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalButton, styles.modalPrimary]} onPress={confirmPicker}>
                  <Text style={styles.buttonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FAFAF8",
  },
  container: {
    padding: 20,
    paddingBottom: 140,
    gap: 20,
  },
  header: {
    gap: 6,
  },
  heroTitle: {
    fontSize: 30,
    color: "#2D3748",
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
  },
  heroSubtitle: {
    color: "#6B7280",
    fontSize: 16,
    fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
  },
  error: {
    color: "#C53030",
  },
  section: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
  },
  sectionTitleSerif: {
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    fontSize: 18,
    color: "#1F2933",
  },
  sectionHelper: {
    color: "#94A3B8",
    fontSize: 13,
    fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
  },
  timeline: {
    paddingVertical: 4,
    gap: 8,
  },
  weekPill: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#E2E8F0",
  },
  weekPillActive: {
    backgroundColor: "#6B8DBF",
  },
  weekLabel: {
    fontWeight: "600",
    color: "#475569",
  },
  weekLabelActive: {
    color: "#fff",
  },
  focusLabel: {
    marginTop: 14,
    color: "#334155",
    fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
  },
  taskSection: {
    gap: 12,
  },
  taskCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    gap: 12,
  },
  taskInput: {
    fontSize: 16,
    fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
    borderBottomWidth: 1,
    borderColor: "#E2E8F0",
    paddingBottom: 6,
  },
  taskControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pillButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
  },
  pillText: {
    color: "#475569",
    fontSize: 13,
  },
  durationInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  addButton: {
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#CBD5F5",
    alignItems: "center",
  },
  addButtonText: {
    color: "#6B8DBF",
    fontWeight: "600",
  },
  successCard: {
    backgroundColor: "#9DB8A0",
    borderRadius: 20,
    padding: 20,
    gap: 8,
  },
  successTitle: {
    fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    fontSize: 20,
    color: "#0F172A",
  },
  successSubtitle: {
    color: "#0F172A",
    fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
  },
  successButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#1F2933",
    alignItems: "center",
  },
  successButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 32 : 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FAFAF8",
    gap: 8,
  },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
    backgroundColor: "#6B8DBF",
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  secondaryLink: {
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#6B8DBF",
    fontWeight: "600",
  },
  rejectText: {
    color: "#94A3B8",
    textAlign: "center",
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  pickerCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 20,
  },
  pickerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
  },
  modalButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalPrimary: {
    backgroundColor: "#6B8DBF",
    borderRadius: 10,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  secondaryText: {
    color: "#6B8DBF",
    fontWeight: "600",
  },
  helper: {
    marginTop: 8,
    color: "#666",
  },
  loadingState: {
    flex: 1,
    backgroundColor: "#FAFAF8",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
});

function parseDate(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function parseTime(value: string): Date | null {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours == null || minutes == null) return null;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

const pad = (num: number) => num.toString().padStart(2, "0");

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}-${month}-${day}`;
}

function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
