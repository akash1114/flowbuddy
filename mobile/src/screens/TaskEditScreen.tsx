import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RootStackParamList } from "../../types/navigation";
import { getTask, updateTask } from "../api/tasks";
import { useUserId } from "../state/user";

type Props = NativeStackScreenProps<RootStackParamList, "TaskEdit">;

export default function TaskEditScreen() {
  const navigation = useNavigation<Props["navigation"]>();
  const route = useRoute<Props["route"]>();
  const { taskId } = route.params;
  const { userId } = useUserId();

  const [title, setTitle] = useState("");
  const [completed, setCompleted] = useState(false);
  const [scheduledDay, setScheduledDay] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
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
      />

      <View style={styles.row}>
        <Text style={styles.label}>Completed</Text>
        <Switch value={completed} onValueChange={setCompleted} />
      </View>

      <Text style={styles.label}>Scheduled Day (YYYY-MM-DD)</Text>
      <TextInput
        value={scheduledDay}
        onChangeText={setScheduledDay}
        style={styles.input}
        placeholder="2024-01-05"
      />

      <Text style={styles.label}>Scheduled Time (HH:MM)</Text>
      <TextInput
        value={scheduledTime}
        onChangeText={setScheduledTime}
        style={styles.input}
        placeholder="08:30"
      />

      <Text style={styles.label}>Notes</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        style={[styles.input, styles.noteInput]}
        placeholder="Add a note..."
        multiline
      />

      <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Changes</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
  label: {
    fontWeight: "600",
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d0d5dd",
    borderRadius: 12,
    padding: 12,
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
    backgroundColor: "#1a73e8",
    borderRadius: 12,
    paddingVertical: 14,
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
  },
  error: {
    color: "#c62828",
  },
});
