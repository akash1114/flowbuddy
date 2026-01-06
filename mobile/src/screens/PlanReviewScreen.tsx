import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.helper}>Generating a friendly outline…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {plan ? (
        <>
          <Text style={styles.title}>{plan.title}</Text>
          <Text style={styles.subtitle}>
            {plan.type} · {plan.plan.weeks} weeks
          </Text>
        </>
      ) : null}

      {combinedError ? <Text style={styles.error}>{combinedError}</Text> : null}

      {plan ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Milestones</Text>
          {plan.plan.milestones.map((milestone) => (
            <View key={milestone.week} style={styles.milestone}>
              <Text style={styles.weekHeading}>Week {milestone.week}</Text>
              <Text style={styles.focus}>{milestone.focus}</Text>
              {milestone.success_criteria.map((criteria) => (
                <Text key={criteria} style={styles.criteria}>
                  • {criteria}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {tasks.length ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Week 1 Tasks</Text>
          {tasks.map((task) => (
            <View key={task.id} style={styles.taskBlock}>
              <TextInput
                style={styles.taskTitle}
                value={task.title}
                onChangeText={(value) => updateTaskField(task.id, "title", value)}
                placeholder="Task title"
                editable={!pending && !success}
              />
              <View style={styles.inlineInputs}>
                <TouchableOpacity
                  style={[styles.inlineInput, styles.flex, styles.pickerInput]}
                  onPress={() => openPicker(task, "date")}
                  disabled={pending || !!success}
                >
                  <Text style={styles.pickerValue}>{task.scheduled_day || "Select date"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.inlineInput, styles.flex, styles.pickerInput]}
                  onPress={() => openPicker(task, "time")}
                  disabled={pending || !!success}
                >
                  <Text style={styles.pickerValue}>{task.scheduled_time || "Select time"}</Text>
                </TouchableOpacity>
                <TextInput
                  style={[styles.inlineInput, styles.flex]}
                  placeholder="Minutes"
                  keyboardType="number-pad"
                  value={task.duration_min}
                  onChangeText={(value) => updateTaskField(task.id, "duration_min", value.replace(/[^0-9]/g, ""))}
                  editable={!pending && !success}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {success ? (
        <View style={styles.successCard}>
          <Text style={styles.sectionTitle}>Activated Tasks</Text>
          {success.tasks_activated?.map((task) => (
            <View key={task.id} style={styles.taskSummary}>
              <Text style={styles.summaryTitle}>{task.title}</Text>
              <Text style={styles.summaryMeta}>
                {task.scheduled_day || "Flexible"} · {task.scheduled_time || "Anytime"} · {task.duration_min ?? "—"} min
              </Text>
            </View>
          ))}
          <TouchableOpacity style={[styles.button, styles.primary]} onPress={() => navigation.navigate("Home")}>
            <Text style={styles.buttonText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actionsRow}>
          <TouchableOpacity style={[styles.button, styles.primary, acceptDisabled && styles.buttonDisabled]} onPress={handleAccept} disabled={acceptDisabled}>
            {pending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Accept Plan</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.secondary]} onPress={handleRegenerate} disabled={pending}>
            <Text style={[styles.buttonText, styles.secondaryText]}>Regenerate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.ghost]} onPress={handleReject} disabled={pending}>
            <Text style={styles.ghostText}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}
      {pickerState ? (
        <Modal transparent animationType="fade">
          <View style={styles.pickerBackdrop}>
            <View style={styles.pickerCard}>
              <Text style={styles.sectionTitle}>{pickerState.mode === "date" ? "Pick a date" : "Pick a time"}</Text>
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
                <TouchableOpacity style={[styles.modalButton, styles.primary]} onPress={confirmPicker}>
                  <Text style={styles.buttonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    flexGrow: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: "600",
    color: "#111",
  },
  subtitle: {
    color: "#555",
    marginTop: 4,
    marginBottom: 16,
  },
  error: {
    color: "#c62828",
    marginBottom: 12,
  },
  card: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e1e3e8",
    padding: 16,
    backgroundColor: "#fff",
  },
  sectionTitle: {
    fontWeight: "600",
    marginBottom: 8,
    fontSize: 16,
  },
  milestone: {
    marginBottom: 12,
  },
  weekHeading: {
    fontWeight: "600",
    color: "#1a73e8",
  },
  focus: {
    marginTop: 4,
    color: "#222",
  },
  criteria: {
    color: "#444",
    marginLeft: 8,
    marginTop: 2,
  },
  taskBlock: {
    marginBottom: 16,
  },
  taskTitle: {
    borderWidth: 1,
    borderColor: "#d7dae0",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  inlineInputs: {
    flexDirection: "row",
    columnGap: 8,
  },
  inlineInput: {
    borderWidth: 1,
    borderColor: "#d7dae0",
    borderRadius: 10,
    padding: 10,
  },
  pickerInput: {
    justifyContent: "center",
  },
  pickerValue: {
    color: "#111",
  },
  flex: {
    flex: 1,
  },
  actionsRow: {
    marginTop: 16,
    gap: 12,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primary: {
    backgroundColor: "#1a73e8",
  },
  buttonDisabled: {
    backgroundColor: "#8fb5f8",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  secondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d0d5dd",
  },
  secondaryText: {
    color: "#1a73e8",
  },
  ghost: {
    backgroundColor: "transparent",
  },
  ghostText: {
    color: "#c62828",
    fontWeight: "600",
  },
  successCard: {
    marginTop: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#c8e6c9",
    padding: 16,
    backgroundColor: "#f1f8e9",
  },
  taskSummary: {
    marginBottom: 12,
  },
  summaryTitle: {
    fontWeight: "600",
  },
  summaryMeta: {
    color: "#555",
    marginTop: 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  helper: {
    marginTop: 8,
    color: "#555",
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  pickerCard: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
  },
  pickerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 12,
  },
  modalButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d0d5dd",
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
