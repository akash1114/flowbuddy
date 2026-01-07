import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, Animated, Vibration } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Settings, Plus, Brain, Target, Check, Calendar, Shield } from "lucide-react-native";
import * as dashboardApi from "../api/dashboard";
import type { DashboardResponse } from "../api/dashboard";
import * as tasksApi from "../api/tasks";
import type { TaskItem } from "../api/tasks";
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
  active_week_window: string;
  task_stats: { completed: number; total: number };
}

interface Task {
  id: string;
  title: string;
  is_completed: boolean;
  scheduled_time?: string;
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
  const [error, setError] = useState<string | null>(null);
  const [praise, setPraise] = useState<string | null>(null);
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
        scheduled_time: task.scheduled_time ?? undefined,
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

  const sortedTasks = useMemo(() => {
    return [...todayFlow].sort((a, b) => {
      if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
      if (!a.is_completed && !b.is_completed) {
        if (a.scheduled_time && b.scheduled_time) return a.scheduled_time.localeCompare(b.scheduled_time);
        if (a.scheduled_time) return -1;
        if (b.scheduled_time) return 1;
        return a.title.localeCompare(b.title);
      }
      return a.title.localeCompare(b.title);
    });
  }, [todayFlow]);

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
                  <Calendar size={20} color="#4A5568" />
                  <Text style={styles.coachingText}>Weekly Plan</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.coachingButton} onPress={() => navigation.navigate("Interventions")}>
                  <Shield size={20} color="#4A5568" />
                  <Text style={styles.coachingText}>Interventions</Text>
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
                    <Text style={styles.focusWindow}>Create a goal and FlowBuddy will highlight it here.</Text>
                  </View>
                )}
              </ScrollView>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Today&apos;s Flow</Text>
              </View>
              <View>
                {sortedTasks.length ? (
                  sortedTasks.map((task) => (
                    <View key={task.id} style={[styles.taskCard, task.is_completed && styles.taskCardCompleted]}>
                      <TouchableOpacity
                        style={styles.taskBody}
                        onPress={() => navigation.navigate("TaskEdit", { taskId: task.id })}
                        activeOpacity={0.8}
                      >
                        <View style={styles.taskTimeBox}>
                          {task.scheduled_time ? (
                            <Text style={styles.taskTime}>{formatTime(task.scheduled_time)}</Text>
                          ) : (
                            <Calendar color="#94A3B8" size={18} style={styles.unscheduledIcon} />
                          )}
                        </View>
                        <View style={styles.taskTextContainer}>
                          <Text style={[styles.taskTitle, task.is_completed && styles.taskTitleCompleted]}>
                            {task.title}
                          </Text>
                          {task.source_resolution_title ? (
                            <View style={styles.badge}>
                              <Text style={styles.badgeText}>{task.source_resolution_title}</Text>
                            </View>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.checkbox, task.is_completed && styles.checkboxChecked]}
                        onPress={() => handleToggleTask(task.id, !task.is_completed)}
                        disabled={updatingTaskId === task.id}
                      >
                        {task.is_completed ? <Check size={16} color="#fff" strokeWidth={3} /> : null}
                      </TouchableOpacity>
                    </View>
                  ))
                ) : (
                  <View style={styles.emptyTasksCard}>
                    <Text style={styles.emptyTasksTitle}>Nothing scheduled</Text>
                    <Text style={styles.emptyTasksSubtitle}>Add a goal or capture a brain dump to plan your day.</Text>
                  </View>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#EDF2F7",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  coachingText: {
    fontWeight: "600",
    color: "#425466",
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
  taskCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  taskCardCompleted: {
    opacity: 0.6,
    backgroundColor: "#F7FAFC",
  },
  taskBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  taskTimeBox: {
    width: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  unscheduledIcon: {
    marginTop: 2,
  },
  taskTime: {
    fontWeight: "600",
    color: "#2D3748",
  },
  taskTextContainer: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1F2933",
  },
  taskTitleCompleted: {
    textDecorationLine: "line-through",
    color: "#94A3B8",
  },
  badge: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
  },
  badgeText: {
    color: "#6B8DBF",
    fontSize: 12,
    fontWeight: "600",
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
