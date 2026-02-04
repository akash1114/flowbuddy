import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RootStackParamList } from "../../types/navigation";
import { getTask, updateTask } from "../api/tasks";
import { useUserId } from "../state/user";
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useTaskSchedule } from "../hooks/useTaskSchedule";
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "TaskEdit">;

export default function TaskEditScreen() {
  const navigation = useNavigation<Props["navigation"]>();
  const route = useRoute<Props["route"]>();
  const { taskId } = route.params;
  const { userId } = useUserId();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [title, setTitle] = useState("");
  const [completed, setCompleted] = useState(false);
  const [scheduledDay, setScheduledDay] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerState, setPickerState] = useState<{ mode: "date" | "time"; value: Date } | null>(null);
  const { isSlotTaken } = useTaskSchedule(userId);

  useEffect(() => {
    const loadTask = async () => {
      if (!userId) return;
      setLoading(true);
      setError(null);
      try {
        const task = await getTask(taskId, userId);
        setTitle(task.title);
        setCompleted(task.completed);
        setScheduledDay(task.scheduled_day || "");
        setScheduledTime(task.scheduled_time || "");
        setNote(task.note || "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load task.");
      } finally {
        setLoading(false);
      }
    };
    loadTask();
  }, [taskId, userId]);

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    setError(null);
    try {
      await updateTask(taskId, userId, {
        title,
        completed,
        scheduled_day: scheduledDay || null,
        scheduled_time: scheduledTime || null,
        note,
      });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update task.");
    } finally {
      setSaving(false);
    }
  };

  const applySelection = (mode: "date" | "time", selectedDate: Date) => {
    if (mode === "date") {
      const formatted = formatDate(selectedDate);
      if (scheduledTime && isSlotTaken(formatted, scheduledTime, { ignoreTimes: [scheduledTime] })) {
        Alert.alert("Slot taken", "Another task already uses that day/time.");
        return false;
      }
      setScheduledDay(formatted);
    } else {
      if (!scheduledDay) {
        Alert.alert("Pick a date", "Choose a day before selecting a time.");
        return false;
      }
      const formatted = formatTime(selectedDate);
      if (isSlotTaken(scheduledDay, formatted, { ignoreTimes: [scheduledTime] })) {
        Alert.alert("Slot taken", "Another task already uses that time.");
        return false;
      }
      setScheduledTime(formatted);
    }
    return true;
  };

  const openPicker = (mode: "date" | "time") => {
    const value =
      mode === "date" ? parseDate(scheduledDay) ?? new Date() : parseTime(scheduledTime) ?? new Date();

    if (Platform.OS === "android") {
      if (mode === "time" && !scheduledDay) {
        Alert.alert("Pick a date", "Choose a day before selecting a time.");
        return;
      }
      DateTimePickerAndroid.open({
        mode,
        value,
        is24Hour: true,
        onChange: (_event, selectedDate) => {
          if (selectedDate) {
            applySelection(mode, selectedDate);
          }
        },
      });
      return;
    }

    setPickerState({ mode, value });
  };

  const handlePickerChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (!selectedDate) return;
    setPickerState((prev) => (prev ? { ...prev, value: selectedDate } : prev));
  };

  const confirmPicker = () => {
    if (!pickerState) return;
    const success = applySelection(pickerState.mode, pickerState.value);
    if (success) {
      setPickerState(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
        <Text style={styles.helper}>Loading task…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Edit Task</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.label}>Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        style={styles.input}
        placeholder="Task title"
        placeholderTextColor={theme.textMuted}
      />

      <View style={styles.row}>
        <Text style={styles.label}>Completed</Text>
        <Switch value={completed} onValueChange={setCompleted} />
      </View>

      <Text style={styles.label}>Scheduled Day</Text>
      <TouchableOpacity style={styles.input} onPress={() => openPicker("date")}>
        <Text style={scheduledDay ? styles.valueText : styles.placeholderText}>
          {scheduledDay || "Pick a date"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.label}>Scheduled Time</Text>
      <TouchableOpacity style={styles.input} onPress={() => openPicker("time")}>
        <Text style={scheduledTime ? styles.valueText : styles.placeholderText}>
          {scheduledTime || "Pick a time"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.label}>Notes</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        style={[styles.input, styles.noteInput]}
        placeholder="Add a note..."
        placeholderTextColor={theme.textMuted}
        multiline
      />

      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
        {saving ? (
          <ActivityIndicator color={theme.mode === "dark" ? theme.textPrimary : "#fff"} />
        ) : (
          <Text style={styles.buttonText}>Save Changes</Text>
        )}
      </TouchableOpacity>
      {pickerState ? (
        <Modal transparent animationType="fade" visible={true}>
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerCard}>
              <DateTimePicker
                value={pickerState.value}
                mode={pickerState.mode}
                display="spinner"
                onChange={handlePickerChange}
              />
              <View style={styles.pickerActions}>
                <TouchableOpacity style={styles.pickerButton} onPress={() => setPickerState(null)}>
                  <Text style={styles.pickerButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pickerButton, styles.pickerConfirm]} onPress={confirmPicker}>
                  <Text style={[styles.pickerButtonText, styles.pickerConfirmText]}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </ScrollView>
  );
}

const createStyles = (theme: ThemeTokens) => {
  const accentForeground = theme.mode === "dark" ? theme.textPrimary : "#fff";

  return StyleSheet.create({
    container: {
      padding: 20,
      gap: 12,
      backgroundColor: theme.background,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.background,
    },
    title: {
      fontSize: 24,
      fontWeight: "600",
      color: theme.textPrimary,
    },
    label: {
      fontWeight: "600",
      marginBottom: 4,
      color: theme.textSecondary,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      padding: 12,
      backgroundColor: theme.card,
      color: theme.textPrimary,
    },
    placeholderText: {
      color: theme.textMuted,
    },
    valueText: {
      color: theme.textPrimary,
    },
    noteInput: {
      minHeight: 120,
      textAlignVertical: "top",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    button: {
      marginTop: 16,
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonDisabled: {
      backgroundColor: theme.accentSoft,
    },
    buttonText: {
      color: accentForeground,
      fontWeight: "600",
    },
    helper: {
      marginTop: 8,
      color: theme.textSecondary,
    },
    error: {
      color: theme.danger,
    },
    pickerOverlay: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: "center",
      alignItems: "center",
      padding: 16,
    },
    pickerCard: {
      width: "100%",
      backgroundColor: theme.card,
      borderRadius: 16,
      padding: 12,
      borderWidth: 1,
      borderColor: theme.border,
    },
    pickerActions: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 8,
    },
    pickerButton: {
      flex: 1,
      paddingVertical: 12,
      alignItems: "center",
    },
    pickerButtonText: {
      fontWeight: "600",
      color: theme.textPrimary,
    },
    pickerConfirm: {
      backgroundColor: theme.accentSoft,
      borderRadius: 10,
      marginLeft: 8,
    },
    pickerConfirmText: {
      color: theme.accent,
      fontWeight: "600",
    },
  });
};

function parseDate(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function parseTime(value: string): Date | null {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours == null || minutes == null || Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

const pad = (num: number) => num.toString().padStart(2, "0");

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
