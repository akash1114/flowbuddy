import { useCallback, useMemo, useState, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { ArrowLeft, Calendar, Target } from "lucide-react-native";
import type { RootStackParamList } from "../../types/navigation";
import { TaskItem, updateTaskCompletion, updateTaskNote, deleteTask } from "../api/tasks";
import { TaskCard } from "../components/TaskCard";
import { useUserId } from "../state/user";
import { useTasks } from "../hooks/useTasks";
import { sortTasksBySchedule, getLocalDateKey } from "../utils/datetime";
import * as dashboardApi from "../api/dashboard";
import type { DashboardResolution } from "../api/dashboard";
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

type NavigationProp = NativeStackNavigationProp<RootStackParamList, "MyWeek">;

type TaskSection = {
  title: string;
  data: TaskItem[];
  key: string;
  isToday?: boolean;
  dateKey?: string;
};

type WeeklyFocusItem = {
  id: string;
  title: string;
  completedTasks: number;
  totalTasks: number;
  progressPercentage: number;
  weekRange: string;
};

export default function MyWeekScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { userId, loading: userLoading } = useUserId();
  const { theme, isDark } = useTheme();
  const accentForeground = theme.mode === "dark" ? theme.textPrimary : "#fff";
  const accentSoftForeground = theme.mode === "dark" ? theme.textPrimary : theme.accent;
  const styles = useMemo(() => createStyles(theme), [theme]);
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [weeklyFocus, setWeeklyFocus] = useState<WeeklyFocusItem[]>([]);
  const [focusLoading, setFocusLoading] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);
  const backgroundColor = theme.background;
  const surface = theme.card;
  const surfaceMuted = theme.surfaceMuted;
  const textPrimary = theme.textPrimary;
  const textSecondary = theme.textSecondary;
  const borderColor = theme.border;
  const accentColor = theme.accent;
  const dangerColor = theme.danger;

  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
    [],
  );

  const focusFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }),
    [],
  );

  const fetchWeeklyFocus = useCallback(async () => {
    if (!userId) return;
    setFocusLoading(true);
    setFocusError(null);
    try {
      const { dashboard } = await dashboardApi.fetchDashboard(userId);
      const mapped = dashboard.active_resolutions.map((resolution: DashboardResolution) => ({
        id: resolution.resolution_id,
        title: resolution.title,
        completedTasks: resolution.tasks.completed,
        totalTasks: resolution.tasks.total,
        progressPercentage: Math.round((resolution.completion_rate || 0) * 100),
        weekRange: formatWeekRange(resolution.week.start, resolution.week.end, focusFormatter),
      }));
      setWeeklyFocus(mapped);
    } catch (err) {
      setFocusError(err instanceof Error ? err.message : "Unable to load weekly focus.");
    } finally {
      setFocusLoading(false);
    }
  }, [userId, focusFormatter]);

  useEffect(() => {
    if (!userId || userLoading) return;
    fetchWeeklyFocus();
  }, [fetchWeeklyFocus, userId, userLoading]);

  const grouped = useMemo<TaskSection[]>(() => {
    const buckets = new Map<string, { title: string; data: TaskItem[]; dateValue: number; dateKey: string }>();
    const unscheduled: TaskItem[] = [];
    const todayKey = getLocalDateKey(new Date());

    tasks.forEach((task) => {
      if (task.scheduled_day) {
        const dateObj = new Date(task.scheduled_day);
        if (!Number.isNaN(dateObj.getTime())) {
          const normalized = getLocalDateKey(dateObj);
          if (!buckets.has(normalized)) {
            buckets.set(normalized, {
              title: dayFormatter.format(dateObj),
              data: [],
              dateValue: dateObj.getTime(),
              dateKey: normalized,
            });
          }
          buckets.get(normalized)!.data.push(task);
          return;
        }
      }
      unscheduled.push(task);
    });

    const sections: TaskSection[] = Array.from(buckets.values())
      .sort((a, b) => a.dateValue - b.dateValue)
      .map((section) => ({
        title: section.title,
        data: sortTasksBySchedule(section.data),
        key: section.dateKey,
        dateKey: section.dateKey,
        isToday: section.dateKey === todayKey,
      }));

    if (unscheduled.length) {
      sections.push({ title: "Unscheduled", data: unscheduled, key: "unscheduled" });
    }
    return sections;
  }, [tasks, dayFormatter]);

  const hasTasks = grouped.some((section) => section.data.length > 0);
  const renderTask = (item: TaskItem) => (
    <TaskCard
      key={item.id}
      task={{
        id: item.id,
        title: item.title,
        completed: item.completed,
        scheduled_day: item.scheduled_day,
        scheduled_time: item.scheduled_time,
        duration_min: item.duration_min,
      }}
      onToggle={updatingId ? undefined : () => handleToggle(item)}
      badgeLabel={null}
      onDelete={handleDeletePrompt}
      deleteDisabled={deletingId === item.id}
      footer={
        <View>
          {item.note ? <Text style={[styles.noteText, { color: textSecondary }]}>{item.note}</Text> : null}
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={[styles.editChip, { backgroundColor: theme.accentSoft }]}
              onPress={() => navigation.navigate("TaskEdit", { taskId: item.id })}
            >
              <Text style={[styles.editChipText, { color: accentSoftForeground }]}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.noteButton} onPress={() => openNoteModal(item)} disabled={noteSaving}>
              <Text style={[styles.noteButtonText, { color: accentColor }]}>{item.note ? "Edit note" : "Add note"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      }
    />
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

  const handleDeletePrompt = (taskId: string) => {
    if (deletingId) return;
    const target = tasks.find((task) => task.id === taskId);
    Alert.alert("Delete task?", `Remove "${target?.title ?? "this task"}" from your week?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => performDeleteTask(taskId),
      },
    ]);
  };

  const performDeleteTask = async (taskId: string) => {
    if (!userId) return;
    setDeletingId(taskId);
    setActionError(null);
    try {
      await deleteTask(taskId, userId);
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to delete that task right now.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    try {
      await Promise.all([refetch(), fetchWeeklyFocus()]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchWeeklyFocus, refetch, userId]);

  if (userLoading || (loading && !refreshing && !tasks.length)) {
    return (
      <View style={[styles.center, { backgroundColor }]}>
        <ActivityIndicator color={accentColor} />
        <Text style={[styles.helper, { color: textSecondary }]}>Gathering your week…</Text>
      </View>
    );
  }

  const renderNoteModal = () => (
    <Modal visible={!!noteTask} animationType="slide" transparent>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: surface }]}>
          <Text style={[styles.modalTitle, { color: textPrimary }]}>
            {noteTask?.note ? "Edit note" : "Add note"}
          </Text>
          <TextInput
            style={[
              styles.noteInput,
              {
                borderColor,
                color: textPrimary,
              },
            ]}
            placeholder="Add a gentle reflection"
            placeholderTextColor={textSecondary}
            multiline
            value={noteText}
            onChangeText={setNoteText}
            editable={!noteSaving}
            maxLength={500}
          />
          <Text style={[styles.noteCounter, { color: textSecondary }]}>{trimmedNote.length}/500</Text>
          {noteError ? <Text style={[styles.errorText, { color: dangerColor }]}>{noteError}</Text> : null}
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
                {noteSaving ? (
                  <ActivityIndicator color={accentForeground} />
                ) : (
                  <Text style={styles.buttonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );

  const combinedError = actionError || tasksError;

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.textSecondary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            style={[styles.backButton, { borderColor, backgroundColor: surface }]}
            onPress={() => navigation.goBack()}
          >
            <ArrowLeft size={18} color={textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.screenTitle, { color: textPrimary }]}>My Week</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.sectionHeading}>
          <Text style={[styles.sectionTitle, { color: textPrimary }]}>This Week&apos;s Focus</Text>
          <Text style={[styles.sectionSubtitle, { color: textSecondary }]}>
            Step back and review your active resolutions.
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.focusScroll}>
          {focusLoading ? (
            <View style={[styles.focusLoading, { backgroundColor: theme.accentSoft }]}>
              <ActivityIndicator color={accentColor} />
              <Text style={[styles.focusLoadingText, { color: textSecondary }]}>Loading progress…</Text>
            </View>
          ) : weeklyFocus.length ? (
            weeklyFocus.map((focus) => (
              <View
                key={focus.id}
                style={[
                  styles.focusCard,
                  {
                    backgroundColor: surface,
                    borderColor,
                    shadowColor: theme.shadow,
                  },
                ]}
              >
               <View style={styles.focusTitleRow}>
                 <Target size={18} color={theme.accent} />
                  <Text style={[styles.focusCardTitle, { color: textPrimary }]} numberOfLines={1}>
                    {focus.title}
                 </Text>
               </View>
               <Text style={[styles.focusFraction, { color: textSecondary }]}>
                 {focus.completedTasks}/{focus.totalTasks || 0} done
                </Text>
                <View style={[styles.progressTrack, { backgroundColor: borderColor }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(100, focus.progressPercentage)}%`,
                        backgroundColor: theme.accent,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.focusRange, { color: textSecondary }]}>{focus.weekRange}</Text>
              </View>
            ))
          ) : (
            <View
              style={[
                styles.focusCard,
                {
                  backgroundColor: surface,
                  borderColor,
                  shadowColor: theme.shadow,
                },
              ]}
            >
              <Text style={[styles.focusCardTitle, { color: textPrimary }]}>No active resolutions</Text>
              <Text style={[styles.focusFraction, { color: textSecondary }]}>
                Create a resolution to see insights here.
              </Text>
            </View>
          )}
        </ScrollView>
        {focusError ? <Text style={[styles.errorText, { color: theme.danger }]}>{focusError}</Text> : null}

        <View style={styles.timelineHeader}>
          <View style={styles.timelineTitleRow}>
            <Calendar size={18} color={accentColor} />
            <Text style={[styles.sectionTitle, { color: textPrimary }]}>Your Schedule</Text>
          </View>
          <Text style={[styles.sectionSubtitle, { color: textSecondary }]}>
            Daily view of all upcoming tasks.
          </Text>
        </View>

        {loading && !refreshing ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={accentColor} />
          </View>
        ) : hasTasks ? (
          grouped.map((section) => (
            <View key={section.key} style={styles.daySection}>
              <View style={styles.dayHeaderRow}>
                <Text
                  style={[
                    styles.dayTitle,
                    { color: section.isToday ? accentColor : textPrimary },
                  ]}
                >
                  {section.title}
                </Text>
                {section.isToday ? (
                  <Text style={[styles.todayBadge, { backgroundColor: theme.accentSoft, color: accentSoftForeground }]}>
                    Today
                  </Text>
                ) : null}
              </View>
              {section.data.map((task) => renderTask(task))}
            </View>
          ))
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: surface }]}>
            <Text style={[styles.emptyTitle, { color: textPrimary }]}>No scheduled tasks yet</Text>
            <Text style={[styles.emptySubtitle, { color: textSecondary }]}>
              Approve a plan or create a task to fill this view.
            </Text>
            <TouchableOpacity
              style={[styles.createButton, { backgroundColor: accentColor }]}
              onPress={() => navigation.navigate("ResolutionCreate")}
            >
              <Text style={styles.createButtonText}>Create a resolution</Text>
            </TouchableOpacity>
          </View>
        )}

        {combinedError ? <Text style={[styles.errorText, { color: dangerColor }]}>{combinedError}</Text> : null}

        <View style={[styles.metaCard, { backgroundColor: theme.accentSoft }]}>
          <Text style={[styles.metaText, { color: textSecondary }]}>task_request_id: {listRequestId ?? "—"}</Text>
          {noteRequestId ? <Text style={[styles.metaText, { color: textSecondary }]}>note_request_id: {noteRequestId}</Text> : null}
        </View>
      </ScrollView>
      {renderNoteModal()}
    </View>
  );
}

function formatWeekRange(start: string, end: string, formatter: Intl.DateTimeFormat): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return "This week";
  }
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

const createStyles = (theme: ThemeTokens) => {
  const accentForeground = theme.mode === "dark" ? theme.textPrimary : "#fff";
  const accentSoftForeground = theme.mode === "dark" ? theme.textPrimary : theme.accent;

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
      backgroundColor: theme.background,
    },
    helper: {
      marginTop: 8,
      textAlign: "center",
      color: theme.textSecondary,
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 40,
    },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 24,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    screenTitle: {
      fontSize: 22,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    sectionHeading: {
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    sectionSubtitle: {
      marginTop: 4,
      fontSize: 14,
      color: theme.textSecondary,
    },
    focusScroll: {
      paddingVertical: 4,
      paddingRight: 20,
    },
    focusCard: {
      width: 260,
      padding: 20,
      marginRight: 16,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
      shadowColor: theme.shadow,
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    focusTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    focusCardTitle: {
      fontSize: 16,
      fontWeight: "600",
      flex: 1,
      color: theme.textPrimary,
    },
    focusFraction: {
      marginTop: 12,
      fontWeight: "600",
      color: theme.textSecondary,
    },
    progressTrack: {
      height: 6,
      borderRadius: 999,
      marginTop: 8,
      overflow: "hidden",
      backgroundColor: theme.surfaceMuted,
    },
    progressFill: {
      height: "100%",
      borderRadius: 999,
      backgroundColor: theme.accent,
    },
    focusRange: {
      marginTop: 10,
      fontSize: 12,
      color: theme.textSecondary,
    },
    focusLoading: {
      width: 220,
      height: 140,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
    },
    focusLoadingText: {
      marginTop: 8,
      fontWeight: "500",
      color: theme.textSecondary,
    },
    timelineHeader: {
      marginTop: 28,
      marginBottom: 12,
    },
    timelineTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 4,
    },
    loadingBlock: {
      paddingVertical: 32,
      alignItems: "center",
    },
    daySection: {
      marginBottom: 24,
    },
    dayHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    dayTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    todayBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      fontWeight: "600",
      fontSize: 12,
      backgroundColor: theme.accentSoft,
      color: accentSoftForeground,
    },
    noteText: {
      marginTop: 8,
      color: theme.textSecondary,
    },
    noteButton: {
      marginLeft: 12,
      paddingVertical: 6,
    },
    noteButtonText: {
      fontWeight: "600",
      color: theme.accent,
    },
    editChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.accentSoft,
    },
    editChipText: {
      fontWeight: "600",
      fontSize: 12,
      color: accentSoftForeground,
    },
    footerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 8,
    },
    emptyCard: {
      borderRadius: 24,
      padding: 24,
      shadowColor: theme.shadow,
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    emptySubtitle: {
      marginTop: 6,
      fontSize: 14,
      color: theme.textSecondary,
    },
    createButton: {
      marginTop: 16,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 16,
      backgroundColor: theme.accent,
    },
    createButtonText: {
      color: accentForeground,
      fontWeight: "700",
    },
    errorText: {
      marginTop: 12,
      fontWeight: "600",
      color: theme.danger,
    },
    metaCard: {
      marginTop: 24,
      padding: 16,
      borderRadius: 16,
      backgroundColor: theme.surfaceMuted,
    },
    metaText: {
      fontSize: 12,
      marginBottom: 4,
      color: theme.textSecondary,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: "center",
      padding: 16,
    },
    modalCard: {
      borderRadius: 20,
      padding: 20,
      backgroundColor: theme.card,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "700",
      marginBottom: 12,
      color: theme.textPrimary,
    },
    noteInput: {
      borderWidth: 1,
      borderRadius: 16,
      minHeight: 110,
      padding: 12,
      textAlignVertical: "top",
      borderColor: theme.border,
      color: theme.textPrimary,
      backgroundColor: theme.surface,
    },
    noteCounter: {
      alignSelf: "flex-end",
      marginTop: 6,
      fontSize: 12,
      color: theme.textSecondary,
    },
    modalActions: {
      marginTop: 16,
    },
    clearText: {
      color: theme.danger,
      fontWeight: "600",
    },
    modalButtons: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 12,
      marginTop: 16,
    },
    modalButton: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: theme.surface,
    },
    primary: {
      backgroundColor: theme.accent,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: accentForeground,
      fontWeight: "600",
    },
    secondaryText: {
      color: theme.textSecondary,
      fontWeight: "600",
    },
  });
};
