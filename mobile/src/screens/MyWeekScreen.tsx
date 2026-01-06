import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import type { RootStackParamList } from "../../types/navigation";
import { TaskItem, updateTaskCompletion, updateTaskNote } from "../api/tasks";
import { useUserId } from "../state/user";
import { useTasks } from "../hooks/useTasks";

type NavigationProp = NativeStackNavigationProp<RootStackParamList, "MyWeek">;

type TaskSection = {
  title: string;
  data: TaskItem[];
};

export default function MyWeekScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { userId, loading: userLoading } = useUserId();
  const {
    tasks,
    loading,
    error: tasksError,
    requestId: listRequestId,
    refetch,
    setTasks,
  } = useTasks(userId, { status: "active" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [noteRequestId, setNoteRequestId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [noteTask, setNoteTask] = useState<TaskItem | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const grouped = useMemo<TaskSection[]>(() => {
    const scheduled = tasks.filter((task) => !!task.scheduled_day);
    const unscheduled = tasks.filter((task) => !task.scheduled_day);
    const sections: TaskSection[] = [];
    if (scheduled.length) {
      sections.push({ title: "Scheduled", data: scheduled });
    }
    if (unscheduled.length) {
      sections.push({ title: "Unscheduled", data: unscheduled });
    }
    return sections;
  }, [tasks]);

  const renderItem = ({ item }: { item: TaskItem }) => (
    <View style={[styles.card, item.completed && styles.cardCompleted]}>
      <TouchableOpacity style={styles.row} onPress={() => handleToggle(item)} disabled={!!updatingId}>
        <View style={[styles.checkbox, item.completed && styles.checkboxChecked]}>
          {item.completed ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </View>
        <View style={styles.taskContent}>
          <Text style={[styles.title, item.completed && styles.completedText]}>{item.title}</Text>
          <Text style={styles.meta}>
            {item.scheduled_day ? item.scheduled_day : "Flexible"}
            {item.scheduled_time ? ` · ${item.scheduled_time}` : ""}
          </Text>
          {item.duration_min ? <Text style={styles.meta}>{item.duration_min} min</Text> : null}
        </View>
      </TouchableOpacity>
      {item.note ? <Text style={styles.noteText}>{item.note}</Text> : null}
      <TouchableOpacity style={styles.noteButton} onPress={() => openNoteModal(item)} disabled={noteSaving}>
        <Text style={styles.noteButtonText}>{item.note ? "Edit note" : "Add note"}</Text>
      </TouchableOpacity>
    </View>
  );

  const handleToggle = async (task: TaskItem) => {
    if (!userId || updatingId) return;
    setUpdatingId(task.id);
    setActionError(null);
    try {
      const { result } = await updateTaskCompletion(task.id, userId, !task.completed);
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, completed: result.completed } : t)),
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to update that task right now.");
    } finally {
      setUpdatingId(null);
    }
  };

  const openNoteModal = (task: TaskItem) => {
    setNoteTask(task);
    setNoteText(task.note ?? "");
    setNoteError(null);
  };

  const closeNoteModal = () => {
    setNoteTask(null);
    setNoteText("");
    setNoteError(null);
  };

  const trimmedNote = noteText.trim();
  const noteTooLong = trimmedNote.length > 500;
  const saveDisabled = noteSaving || noteTooLong || (!trimmedNote && !noteTask?.note);

  const handleSaveNote = async () => {
    if (!userId || !noteTask) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      const payload = trimmedNote ? trimmedNote : null;
      const { requestId } = await updateTaskNote(noteTask.id, userId, payload);
      setNoteRequestId(requestId);
      await refetch();
      closeNoteModal();
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Unable to save that note right now.");
    } finally {
      setNoteSaving(false);
    }
  };

  const handleClearNote = async () => {
    if (!noteTask) {
      closeNoteModal();
      return;
    }
    if (!noteTask.note) {
      closeNoteModal();
      return;
    }
    if (!userId) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      const { requestId } = await updateTaskNote(noteTask.id, userId, null);
      setNoteRequestId(requestId);
      await refetch();
      closeNoteModal();
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Unable to clear that note right now.");
    } finally {
      setNoteSaving(false);
    }
  };

  if (userLoading || (loading && !refreshing && !tasks.length)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.helper}>Gathering your week…</Text>
      </View>
    );
  }

  const combinedError = actionError || tasksError;

  if (combinedError) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{combinedError}</Text>
        <TouchableOpacity
          style={styles.retry}
          onPress={() => {
            setRefreshing(true);
            refetch().finally(() => setRefreshing(false));
          }}
        >
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!tasks.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No active tasks yet</Text>
        <Text style={styles.helper}>Approve a plan to fill your week with gentle supports.</Text>
        <TouchableOpacity style={styles.retry} onPress={() => navigation.navigate("ResolutionCreate")}>
          <Text style={styles.retryText}>Create a resolution</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SectionList
        sections={grouped}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          refetch().finally(() => setRefreshing(false));
        }}
        contentContainerStyle={styles.listContent}
      />

      {(listRequestId || noteRequestId) ? (
        <View style={styles.debugCard}>
          {listRequestId ? <Text style={styles.debugValue}>list_request_id: {listRequestId}</Text> : null}
          {noteRequestId ? <Text style={styles.debugValue}>note_request_id: {noteRequestId}</Text> : null}
        </View>
      ) : null}

      <Modal visible={!!noteTask} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{noteTask?.note ? "Edit note" : "Add note"}</Text>
            <TextInput
              style={styles.noteInput}
              multiline
              placeholder="Add a gentle reflection"
              value={noteText}
              onChangeText={setNoteText}
              editable={!noteSaving}
              maxLength={500}
            />
            <Text style={styles.noteCounter}>{trimmedNote.length}/500</Text>
            {noteError ? <Text style={styles.error}>{noteError}</Text> : null}
            <View style={styles.modalActions}>
              {noteTask?.note ? (
                <TouchableOpacity onPress={handleClearNote} disabled={noteSaving}>
                  <Text style={styles.clearText}>Clear note</Text>
                </TouchableOpacity>
              ) : (
                <View />
              )}
              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.modalButton} onPress={closeNoteModal} disabled={noteSaving}>
                  <Text style={styles.secondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.primary, saveDisabled && styles.buttonDisabled]}
                  onPress={handleSaveNote}
                  disabled={saveDisabled}
                >
                  {noteSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  sectionHeader: {
    fontWeight: "600",
    fontSize: 16,
    marginTop: 12,
    marginBottom: 6,
    color: "#111",
  },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e4ef",
    backgroundColor: "#fff",
    marginBottom: 10,
  },
  cardCompleted: {
    opacity: 0.6,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
  },
  completedText: {
    textDecorationLine: "line-through",
  },
  meta: {
    color: "#555",
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#d0d4e2",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: "#1a73e8",
    borderColor: "#1a73e8",
  },
  checkboxMark: {
    color: "#fff",
    fontWeight: "700",
  },
  taskContent: {
    flex: 1,
  },
  noteText: {
    marginTop: 8,
    color: "#333",
  },
  noteButton: {
    marginTop: 8,
  },
  noteButtonText: {
    color: "#1a73e8",
    fontWeight: "600",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  helper: {
    marginTop: 8,
    color: "#666",
    textAlign: "center",
  },
  error: {
    color: "#c62828",
    fontSize: 16,
    textAlign: "center",
  },
  retry: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1a73e8",
  },
  retryText: {
    color: "#1a73e8",
    fontWeight: "600",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#111",
  },
  debugCard: {
    padding: 12,
    borderTopWidth: 1,
    borderColor: "#e6e9f2",
  },
  debugValue: {
    color: "#111",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: "#d5d9e6",
    borderRadius: 12,
    minHeight: 100,
    padding: 12,
    textAlignVertical: "top",
  },
  noteCounter: {
    alignSelf: "flex-end",
    color: "#777",
    marginTop: 4,
    fontSize: 12,
  },
  modalActions: {
    marginTop: 16,
  },
  clearText: {
    color: "#c62828",
    fontWeight: "600",
  },
  modalButtons: {
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
  secondaryText: {
    color: "#1a73e8",
    fontWeight: "600",
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
  },
});
