import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, Animated, Vibration } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Settings, Plus, Brain, Target, Calendar, Shield, CheckSquare } from "lucide-react-native";
import * as dashboardApi from "../api/dashboard";
import type { DashboardResponse } from "../api/dashboard";
import * as tasksApi from "../api/tasks";
import type { TaskItem } from "../api/tasks";
import { TaskCard } from "../components/TaskCard";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";

const PRAISE_MESSAGES = [
  "Great job!",
  "Keep the flow!",
  "One step closer!",
  "Momentum building!",
  "Small wins matter!",
  "Nice work!",
];

type HomeNavigation = NativeStackNavigationProp<RootStackParamList, "Home">;

interface DashboardResolution {
  id: string;
  title: string;
  completion_rate: number;
  current_week: number;
  active_week_window: string;
  task_stats: { completed: number; total: number };
}

interface Task {
  id: string;
  title: string;
  is_completed: boolean;
  scheduled_day: string | null;
  scheduled_time?: string;
  duration_min: number | null;
  source_resolution_title?: string;
}

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavigation>();
  const { userId, loading: userLoading } = useUserId();

  const [focusList, setFocusList] = useState<DashboardResolution[]>([]);
  const [todayFlow, setTodayFlow] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [praise, setPraise] = useState<string | null>(null);
  const [taskTab, setTaskTab] = useState<"remaining" | "completed">("remaining");
  const praiseOpacity = useRef(new Animated.Value(0)).current;

  const greeting = useMemo(() => getGreeting(new Date()), []);
  const subtitleDate = useMemo(() => formatSubtitleDate(new Date()), []);

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    if (!userId) return;
    const silent = options?.silent ?? false;
    setError(null);
    if (!silent) {
      setLoading(true);
    }
    try {
      const [dashboardResult, taskResult] = await Promise.all([
        dashboardApi.fetchDashboard(userId),
        tasksApi.listTasks(userId, { status: "active" }),
      ]);

      const mappedFocus = mapDashboard(dashboardResult.dashboard);
      setFocusList(mappedFocus);

      const resolutionLookup = mappedFocus.reduce<Record<string, string>>((acc, item) => {
        acc[item.id] = item.title;
        return acc;
      }, {});

      const filteredTasks = filterTasksForToday(taskResult.tasks);
      const mappedTasks = filteredTasks.map((task) => ({
        id: task.id,
        title: task.title,
        is_completed: task.completed,
        scheduled_day: task.scheduled_day,
        scheduled_time: task.scheduled_time ?? undefined,
        duration_min: task.duration_min,
        source_resolution_title: task.resolution_id ? resolutionLookup[task.resolution_id] : undefined,
      }));
      setTodayFlow(sortFlowTasks(mappedTasks));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh your workspace.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userLoading && userId) {
      fetchData();
    }
  }, [fetchData, userLoading, userId]);

  useFocusEffect(
    useCallback(() => {
      if (!userLoading && userId) {
        fetchData({ silent: true });
      }
    }, [fetchData, userLoading, userId]),
  );

  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    [],
  );

  const remainingTasks = useMemo(() => sortFlowTasks(todayFlow.filter((task) => !task.is_completed)), [todayFlow]);
  const completedTasks = useMemo(() => sortFlowTasks(todayFlow.filter((task) => task.is_completed)), [todayFlow]);
  const visibleTasks = useMemo(
    () => (taskTab === "remaining" ? remainingTasks : completedTasks),
    [taskTab, remainingTasks, completedTasks],
  );
  const allDone = todayFlow.length > 0 && remainingTasks.length === 0;

  const sortedFocus = useMemo(() => {
    return [...focusList].sort((a, b) => {
      const aDone = a.completion_rate >= 1;
      const bDone = b.completion_rate >= 1;
      if (aDone !== bDone) return aDone ? 1 : -1;
      return a.title.localeCompare(b.title);
    });
  }, [focusList]);

  const handleRefresh = () => {
    if (!userId) {
      return;
    }
    setRefreshing(true);
    fetchData({ silent: true });
  };

  const handleToggleTask = async (taskId: string, isCompleted: boolean) => {
    if (!userId) return;
    setUpdatingTaskId(taskId);
    setTodayFlow((prev) => prev.map((task) => (task.id === taskId ? { ...task, is_completed: isCompleted } : task)));
    try {
      await tasksApi.updateTaskCompletion(taskId, userId, isCompleted);
      if (isCompleted) {
        Vibration.vibrate(10);
        const message = PRAISE_MESSAGES[Math.floor(Math.random() * PRAISE_MESSAGES.length)];
        setPraise(message);
        Animated.timing(praiseOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start(() => {
          setTimeout(() => {
            Animated.timing(praiseOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setPraise(null));
          }, 2000);
        });
      }
    } catch (err) {
      setTodayFlow((prev) =>
        prev.map((task) => (task.id === taskId ? { ...task, is_completed: !isCompleted } : task)),
      );
      setError(err instanceof Error ? err.message : "Unable to update task right now.");
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      if (!userId) return;
      setDeletingTaskId(taskId);
      try {
        await tasksApi.deleteTask(taskId, userId);
        setTodayFlow((prev) => prev.filter((task) => task.id !== taskId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to delete that task right now.");
      } finally {
        setDeletingTaskId(null);
      }
    },
    [userId],
  );

  const confirmDeleteTask = useCallback(
    (taskId: string) => {
      if (deletingTaskId) return;
      const target = todayFlow.find((task) => task.id === taskId);
      Alert.alert("Delete task?", `Delete "${target?.title ?? "this task"}" from your flow?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => handleDeleteTask(taskId),
        },
      ]);
    },
    [todayFlow, deletingTaskId, handleDeleteTask],
  );

  const toggleFab = () => setFabOpen((prev) => !prev);

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          showsVerticalScrollIndicator={false}
        >
              <View style={styles.headerRow}>
                <View>
                  <Text style={styles.greeting}>{greeting}, Alex</Text>
                  <Text style={styles.date}>{subtitleDate}</Text>
                  <View style={styles.coachingRow}>
                    <TouchableOpacity style={styles.coachingButton} onPress={() => navigation.navigate("WeeklyPlan")}>
                      <View style={styles.coachingIcon}>
                        <Calendar size={20} color="#9FE4FF" />
                      </View>
                      <Text style={styles.coachingText}>Weekly Plan</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.coachingButton} onPress={() => navigation.navigate("MyWeek")}>
                      <View style={styles.coachingIcon}>
                        <CheckSquare size={20} color="#FFD3A4" />
                      </View>
                      <Text style={styles.coachingText}>My Week</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.coachingButton} onPress={() => navigation.navigate("Interventions")}>
                      <View style={styles.coachingIcon}>
                        <Shield size={20} color="#C2F8C2" />
                      </View>
                      <Text style={styles.coachingText}>Coaching</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <TouchableOpacity style={styles.settingsButton} onPress={() => navigation.navigate("SettingsPermissions")}>
                  <Settings color="#2D3748" size={24} />
                </TouchableOpacity>
              </View>

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          {loading && !refreshing ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#6B8DBF" />
            </View>
          ) : (
            <>
              <View style={[styles.sectionHeaderRow, styles.focusHeader]}>
                <Text style={styles.sectionTitle}>This Week&apos;s Focus</Text>
                <TouchableOpacity onPress={() => navigation.navigate("Dashboard")}>
                  <Text style={styles.linkText}>View Dashboard</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.focusCarousel}
              >
                {sortedFocus.length ? (
                  sortedFocus.map((focus) => (
                    <TouchableOpacity
                      key={focus.id}
                      activeOpacity={0.7}
                      style={[styles.focusCard, focus.completion_rate >= 1 && styles.focusCardComplete]}
                      onPress={() => navigation.navigate("ResolutionDashboardDetail", { resolutionId: focus.id })}
                    >
                      <Text style={styles.focusTitle} numberOfLines={1} ellipsizeMode="tail">
                        {focus.title}
                      </Text>
                      <Text style={styles.focusWindow}>{focus.active_week_window}</Text>
                      <Text style={styles.focusStats}>
                        {focus.task_stats.completed}/{focus.task_stats.total} done
                      </Text>
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${Math.min(100, Math.round(focus.completion_rate * 100))}%` },
                          ]}
                        />
                      </View>
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={[styles.focusCard, styles.emptyFocusCard]}>
                    <Text style={styles.focusTitle}>No active goals yet</Text>
                    <Text style={styles.focusWindow}>Create a goal and Sarthi AI will highlight it here.</Text>
                  </View>
                )}
              </ScrollView>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Today&apos;s Flow</Text>
              </View>
              <View>
                <View style={styles.taskTabs}>
                  <TouchableOpacity
                    style={[styles.taskTabButton, taskTab === "remaining" && styles.taskTabActive]}
                    onPress={() => setTaskTab("remaining")}
                  >
                    <Text style={[styles.taskTabText, taskTab === "remaining" && styles.taskTabActiveText]}>
                      Remaining ({remainingTasks.length})
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.taskTabButton, taskTab === "completed" && styles.taskTabActive]}
                    onPress={() => setTaskTab("completed")}
                  >
                    <Text style={[styles.taskTabText, taskTab === "completed" && styles.taskTabActiveText]}>
                      Completed ({completedTasks.length})
                    </Text>
                  </TouchableOpacity>
                </View>

                {visibleTasks.length ? (
                  visibleTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={{
                        id: task.id,
                        title: task.title,
                        completed: task.is_completed,
                        scheduled_day: task.scheduled_day,
                        scheduled_time: task.scheduled_time ?? null,
                        duration_min: task.duration_min,
                      }}
                      onPress={() => navigation.navigate("TaskEdit", { taskId: task.id })}
                      onToggle={
                        updatingTaskId ? undefined : (id, completed) => handleToggleTask(id, completed)
                      }
                      onDelete={confirmDeleteTask}
                      deleteDisabled={deletingTaskId === task.id}
                      badgeLabel={task.source_resolution_title}
                    />
                  ))
                ) : (
                  <>
                    {taskTab === "remaining" ? (
                      <View style={styles.emptyTasksCard}>
                        {allDone ? (
                          <>
                            <Text style={styles.emojiCelebration}>🎉</Text>
                            <Text style={styles.emptyTasksTitle}>All done for today!</Text>
                            <Text style={styles.emptyTasksSubtitle}>
                              Celebrate the momentum or add a quick extra task.
                            </Text>
                          </>
                        ) : (
                          <>
                            <Text style={styles.emptyTasksTitle}>Nothing scheduled</Text>
                            <Text style={styles.emptyTasksSubtitle}>
                              Add a goal, brain dump, or create a task to guide today.
                            </Text>
                          </>
                        )}
                      </View>
                    ) : (
                      <View style={styles.emptyTasksCard}>
                        <Text style={styles.emptyTasksTitle}>No completed tasks yet</Text>
                        <Text style={styles.emptyTasksSubtitle}>Check items off to see them here.</Text>
                      </View>
                    )}
                  </>
                )}
              </View>
            </>
          )}
        </ScrollView>

        {fabOpen ? <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={toggleFab} /> : null}
        <View style={styles.fabContainer}>
          {fabOpen ? (
            <View style={styles.fabOptions}>
              <TouchableOpacity
                style={[styles.fabPill, styles.taskPill]}
                onPress={() => {
                  toggleFab();
                  navigation.navigate("TaskCreate");
                }}
              >
                <CheckSquare color="#fff" size={18} />
                <Text style={styles.fabPillText}>New Task</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.fabPill, styles.goalPill]}
                onPress={() => {
                  toggleFab();
                  navigation.navigate("ResolutionCreate");
                }}
              >
                <Target color="#fff" size={18} />
                <Text style={styles.fabPillText}>New Goal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.fabPill, styles.brainPill]}
                onPress={() => {
                  toggleFab();
                  navigation.navigate("BrainDump");
                }}
              >
                <Brain color="#fff" size={18} />
                <Text style={styles.fabPillText}>Brain Dump</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <TouchableOpacity style={styles.fabMain} onPress={toggleFab}>
            <Plus color="#fff" size={24} />
          </TouchableOpacity>
        </View>
        {praise ? (
          <Animated.View style={[styles.praiseToast, { opacity: praiseOpacity }]}>
            <Text style={styles.praiseText}>{praise}</Text>
          </Animated.View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function getGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatSubtitleDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatWeekWindow(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

function mapDashboard(dashboard: DashboardResponse): DashboardResolution[] {
  return dashboard.active_resolutions.map((resolution) => ({
    id: resolution.resolution_id,
    title: resolution.title,
    completion_rate: resolution.completion_rate,
    current_week: resolution.current_week,
    active_week_window: formatWeekWindow(resolution.week.start, resolution.week.end),
    task_stats: {
      completed: resolution.tasks.completed,
      total: resolution.tasks.total,
    },
  }));
}

function filterTasksForToday(tasks: TaskItem[]): TaskItem[] {
  const todayKey = getLocalDateKey(new Date());
  return tasks.filter((task) => !task.scheduled_day || task.scheduled_day === todayKey);
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sortFlowTasks(tasks: Task[]): Task[] {
  const getDateValue = (value?: string) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
    const [hourStr, minuteStr] = value.split(":");
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      const fallback = new Date();
      fallback.setHours(hour, minute, 0, 0);
      return fallback.getTime();
    }
    return null;
  };

  return [...tasks].sort((a, b) => {
    const aValue = getDateValue(a.scheduled_time);
    const bValue = getDateValue(b.scheduled_time);
    const aHasTime = aValue != null;
    const bHasTime = bValue != null;
    if (aHasTime && bHasTime) {
      return aValue! - bValue!;
    }
    if (aHasTime && !bHasTime) return -1;
    if (!aHasTime && bHasTime) return 1;
    return a.title.localeCompare(b.title);
  });
}

function formatTime(value: string): string {
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return formatter.format(date);
  }
  // fallback for HH:MM strings
  const [hourStr, minuteStr] = value.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (Number.isFinite(hour) && Number.isFinite(minute)) {
    const fallbackDate = new Date();
    fallbackDate.setHours(hour);
    fallbackDate.setMinutes(minute);
    return formatter.format(fallbackDate);
  }
  return value;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FAFAF8",
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 120,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  greeting: {
    fontSize: 28,
    color: "#2D3748",
    fontFamily: "Georgia",
  },
  date: {
    color: "#94A3B8",
    fontSize: 16,
    marginTop: 4,
  },
  coachingRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    marginBottom: 8,
  },
  coachingButton: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 18,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: "#1D2435",
    borderWidth: 1,
    borderColor: "#2F3A54",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  coachingIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  coachingText: {
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
    color: "#fff",
  },
  settingsButton: {
    padding: 8,
    borderRadius: 999,
    backgroundColor: "#fff",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    marginTop: 8,
  },
  focusHeader: {
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#2D3748",
  },
  linkText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6B8DBF",
  },
  focusCarousel: {
    paddingBottom: 8,
    paddingRight: 20,
  },
  focusCard: {
    width: 280,
    padding: 16,
    marginRight: 16,
    flexShrink: 0,
    borderRadius: 24,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  emptyFocusCard: {
    marginRight: 0,
  },
  focusCardComplete: {
    opacity: 0.6,
  },
  praiseToast: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    backgroundColor: "rgba(45, 55, 72, 0.95)",
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  praiseText: {
    color: "#fff",
    fontWeight: "700",
  },
  focusTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A202C",
  },
  focusWindow: {
    marginTop: 6,
    color: "#718096",
    fontSize: 13,
  },
  focusStats: {
    marginTop: 12,
    color: "#4A5568",
    fontWeight: "500",
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "#EDF2F7",
    marginTop: 12,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#6B8DBF",
  },
  checkbox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#CBD5E0",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  checkboxChecked: {
    backgroundColor: "#6B8DBF",
    borderColor: "#6B8DBF",
  },
  emptyTasksCard: {
    padding: 20,
    borderRadius: 18,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  emptyTasksTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1A202C",
  },
  emptyTasksSubtitle: {
    color: "#718096",
    marginTop: 6,
  },
  emojiCelebration: {
    fontSize: 40,
    textAlign: "center",
    marginBottom: 8,
  },
  taskTabs: {
    flexDirection: "row",
    marginBottom: 12,
    gap: 8,
  },
  taskTabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  taskTabActive: {
    backgroundColor: "#1a73e8",
    borderColor: "#1a73e8",
  },
  taskTabText: {
    fontWeight: "600",
    color: "#475467",
  },
  taskTabActiveText: {
    color: "#fff",
  },
  fabContainer: {
    position: "absolute",
    bottom: 24,
    right: 24,
    alignItems: "flex-end",
  },
  fabOptions: {
    marginBottom: 12,
    gap: 10,
  },
  fabPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  goalPill: {
    backgroundColor: "#38A169",
  },
  brainPill: {
    backgroundColor: "#3B82F6",
  },
  taskPill: {
    backgroundColor: "#EC7B3A",
  },
  fabPillText: {
    color: "#fff",
    fontWeight: "600",
    marginLeft: 8,
  },
  fabMain: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#6B8DBF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  loadingState: {
    paddingVertical: 40,
    alignItems: "center",
  },
  errorText: {
    color: "#C53030",
    marginBottom: 12,
  },
});
