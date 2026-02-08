import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, Animated, Vibration } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Settings, Plus, Brain, Target, Calendar, Shield, CheckSquare, Play, Hexagon, Moon, Sun, Zap, Sparkles } from "lucide-react-native";
import * as dashboardApi from "../api/dashboard";
import * as tasksApi from "../api/tasks";
import type { TaskItem } from "../api/tasks";
import * as journeyApi from "../api/journey";
import type { JourneyCategory } from "../api/journey";
import { getPreferences, type AvailabilityProfile } from "../api/preferences";
import { TaskCard } from "../components/TaskCard";
import DailyJourneyWidget from "../components/DailyJourneyWidget";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

const PRAISE_MESSAGES = [
  "Great job!",
  "Keep the flow!",
  "One step closer!",
  "Momentum building!",
  "Small wins matter!",
  "Nice work!",
];

const DEFAULT_MANUAL_OVERRIDE_MS = 30 * 60 * 1000;

type HomeNavigation = NativeStackNavigationProp<RootStackParamList, "Home">;

const CONTEXT_SEGMENTS = [
  { key: "personal", label: "Personal", icon: "🏠" },
  { key: "work", label: "Work", icon: "💼" },
] as const;

interface Task {
  id: string;
  title: string;
  is_completed: boolean;
  scheduled_day: string | null;
  scheduled_time?: string;
  duration_min: number | null;
  source_resolution_title?: string;
  domain: "personal" | "work";
}

export default function HomeScreen() {
  const navigation = useNavigation<HomeNavigation>();
  const { userId, loading: userLoading } = useUserId();

  const [todayFlow, setTodayFlow] = useState<Task[]>([]);
  const [journeyCategories, setJourneyCategories] = useState<JourneyCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [praise, setPraise] = useState<string | null>(null);
  const [taskTab, setTaskTab] = useState<"remaining" | "completed">("remaining");
  const [hasActiveResolutions, setHasActiveResolutions] = useState(false);
  const [activeContext, setActiveContext] = useState<"personal" | "work">("personal");
  const [availabilityProfile, setAvailabilityProfile] = useState<AvailabilityProfile | null>(null);
  const scheduleOverrideUntilRef = useRef<number | null>(null);
  const availabilityProfileRef = useRef<AvailabilityProfile | null>(null);
  const praiseOpacity = useRef(new Animated.Value(0)).current;
  const { theme, isDark, toggleTheme } = useTheme();
  const contextAccent = useMemo(() => {
    return activeContext === "work" ? "#475569" : "#6366F1";
  }, [activeContext, theme.accent]);
  const styles = useMemo(() => createStyles(theme, contextAccent), [theme, contextAccent]);

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
      const journeyPromise = journeyApi.fetchDailyJourney(userId).catch(() => null);
      const [dashboardResult, taskResult, journeyResult] = await Promise.all([
        dashboardApi.fetchDashboard(userId),
        tasksApi.listTasks(userId, { status: "active" }),
        journeyPromise,
      ]);

      const activeResolutions = dashboardResult.dashboard.active_resolutions;
      const resolutionLookup = activeResolutions.reduce<Record<string, string>>((acc, resolution) => {
        acc[resolution.resolution_id] = resolution.title;
        return acc;
      }, {});
      const resolutionDomainLookup = activeResolutions.reduce<Record<string, "personal" | "work">>((acc, resolution) => {
        acc[resolution.resolution_id] = (resolution.domain as "personal" | "work") || "personal";
        return acc;
      }, {});

      const filteredTasks = filterTasksForToday(taskResult.tasks);
      const mappedTasks = filteredTasks.map((task) => {
        const domain =
          (task as TaskItem & { domain?: "personal" | "work" }).domain ??
          (task.resolution_id ? resolutionDomainLookup[task.resolution_id] : "personal");
        return {
          id: task.id,
          title: task.title,
          is_completed: task.completed,
          scheduled_day: task.scheduled_day,
          scheduled_time: task.scheduled_time ?? undefined,
          duration_min: task.duration_min,
          source_resolution_title: task.resolution_id ? resolutionLookup[task.resolution_id] : undefined,
          domain: domain || "personal",
        };
      });
      setTodayFlow(sortFlowTasks(mappedTasks));
      setJourneyCategories(journeyResult?.categories ?? []);
      setHasActiveResolutions(activeResolutions.length > 0);
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

  const loadPreferences = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await getPreferences(userId);
      setAvailabilityProfile(data.availability_profile);
      availabilityProfileRef.current = data.availability_profile;
    } catch {
      setAvailabilityProfile(null);
      availabilityProfileRef.current = null;
    }
  }, [userId]);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  useFocusEffect(
    useCallback(() => {
      if (!userLoading && userId) {
        fetchData({ silent: true });
        loadPreferences();
      }
    }, [fetchData, loadPreferences, userLoading, userId]),
  );

  useEffect(() => {
    if (!availabilityProfile) return;
    const applyScheduleContext = () => {
      const { context } = computeScheduleContext(availabilityProfile, new Date());
      const overrideActive = scheduleOverrideUntilRef.current && Date.now() < scheduleOverrideUntilRef.current;
      if (!overrideActive) {
        setActiveContext(context);
        scheduleOverrideUntilRef.current = null;
      }
    };
    applyScheduleContext();
    const interval = setInterval(applyScheduleContext, 60 * 1000);
    return () => clearInterval(interval);
  }, [availabilityProfile]);

  const filteredFlow = useMemo(
    () => todayFlow.filter((task) => (task.domain || "personal") === activeContext),
    [todayFlow, activeContext],
  );
  const remainingTasks = useMemo(() => sortFlowTasks(filteredFlow.filter((task) => !task.is_completed)), [filteredFlow]);
  const completedTasks = useMemo(() => sortFlowTasks(filteredFlow.filter((task) => task.is_completed)), [filteredFlow]);
  const heroTask = useMemo(() => remainingTasks[0] ?? null, [remainingTasks]);
  const remainingAfterHero = useMemo(
    () => (heroTask ? remainingTasks.filter((task) => task.id !== heroTask.id) : remainingTasks),
    [remainingTasks, heroTask],
  );
  const visibleTasks = useMemo(
    () => (taskTab === "remaining" ? remainingAfterHero : completedTasks),
    [taskTab, remainingAfterHero, completedTasks],
  );
  const allDone = filteredFlow.length > 0 && remainingTasks.length === 0;

  const backgroundColor = theme.background;
  const textPrimary = theme.textPrimary;
  const textSecondary = theme.textSecondary;
  const sectionTitleColor = theme.textPrimary;
  const linkColor = contextAccent;
  const quickActionBg = theme.chipBackground;
  const quickActionText = theme.chipText;
  const quickActionShadow = theme.shadow;
  const brandAccentBg = theme.surfaceMuted;
  const brandAccent = contextAccent;
  const borderColor = theme.border;
  const heroCardColor = theme.heroPrimary;
  const heroRestColor = theme.heroRest;
  const celebrationBackground = theme.mode === "dark" ? "rgba(34,197,94,0.18)" : "rgba(16,185,129,0.18)";
  const celebrationAccent = theme.mode === "dark" ? theme.success : "#166534";
  const errorColor = theme.danger;

  const quickActions = useMemo(
    () => [
      {
        key: "weekly-plan",
        label: "Next week blueprint",
        icon: <Calendar color="#1A73E8" size={16} />,
        onPress: () => navigation.navigate("WeeklyPlan"),
      },
      {
        key: "my-week",
        label: "My week",
        icon: <CheckSquare color="#15803D" size={16} />,
        onPress: () => navigation.navigate("MyWeek"),
      },
      {
        key: "coaching",
        label: "Coaching",
        icon: <Shield color="#B45309" size={16} />,
        onPress: () => navigation.navigate("Interventions"),
      },
    ],
    [navigation],
  );

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
  const handleContextSelection = useCallback((value: "personal" | "work") => {
    setActiveContext(value);
    const profile = availabilityProfileRef.current;
    if (!profile) {
      scheduleOverrideUntilRef.current = Date.now() + DEFAULT_MANUAL_OVERRIDE_MS;
      return;
    }
    const schedule = computeScheduleContext(profile, new Date());
    if (schedule.nextSwitch) {
      scheduleOverrideUntilRef.current = schedule.nextSwitch.getTime();
    } else {
      scheduleOverrideUntilRef.current = Date.now() + DEFAULT_MANUAL_OVERRIDE_MS;
    }
  }, []);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]} edges={["left", "right"]}>
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          showsVerticalScrollIndicator={false}
        >
              <View style={styles.headerRow}>
                <View style={styles.brandRow}>
                  <View style={[styles.brandIcon, { backgroundColor: brandAccentBg }]}>
                    <Hexagon size={22} color={brandAccent} />
                  </View>
                  <Text style={[styles.brandTitle, { color: textPrimary }]}>Sarathi</Text>
                </View>
                <View style={styles.headerControls}>
                  <TouchableOpacity
                    style={[styles.controlButton, { borderColor: theme.border, backgroundColor: theme.surfaceMuted }]}
                    onPress={toggleTheme}
                  >
                    {isDark ? <Sun size={18} color={theme.warning} /> : <Moon size={18} color={theme.textSecondary} />}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.controlButton, { borderColor: theme.border, backgroundColor: theme.surface }]}
                    onPress={() => navigation.navigate("SettingsPermissions")}
                  >
                    <Settings color={theme.textPrimary} size={20} />
                  </TouchableOpacity>
                </View>
              </View>

            <View style={[styles.heroPanel, { backgroundColor: theme.surface }]}>
              <Text style={[styles.greeting, { color: textPrimary }]}>{greeting}, Alex</Text>
              <Text style={[styles.greetingSubtitle, { color: textSecondary }]}>{subtitleDate}</Text>
              <Text style={[styles.greetingHint, { color: textSecondary }]}>We shaped today so you can stay present.</Text>

              <View style={[styles.contextToggleRow, { borderColor: theme.border, backgroundColor: theme.surfaceMuted }]}>
                {CONTEXT_SEGMENTS.map((option) => {
                  const active = activeContext === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.contextToggleButton, active && styles.contextToggleButtonActive]}
                      onPress={() => handleContextSelection(option.key)}
                      activeOpacity={0.9}
                    >
                      <Text style={[styles.contextToggleText, active && styles.contextToggleTextActive]}>
                        {`${option.icon} ${option.label}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.heroStatsRow}>
                <View style={styles.heroStat}>
                  <Text style={[styles.heroStatLabel, { color: textSecondary }]}>Remaining</Text>
                  <Text style={[styles.heroStatValue, { color: textPrimary }]}>{remainingTasks.length}</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroStat}>
                  <Text style={[styles.heroStatLabel, { color: textSecondary }]}>Completed</Text>
                  <Text style={[styles.heroStatValue, { color: textPrimary }]}>{completedTasks.length}</Text>
                </View>
                <View style={styles.heroDivider} />
                <View style={styles.heroStat}>
                  <Text style={[styles.heroStatLabel, { color: textSecondary }]}>Focus</Text>
                  <Text style={[styles.heroStatValue, { color: contextAccent }]}>{activeContext === "work" ? "Work" : "Personal"}</Text>
                </View>
              </View>

              <View style={styles.quickActionsRow}>
                {quickActions.map((action) => (
                  <TouchableOpacity
                    key={action.key}
                    style={[
                      styles.quickAction,
                      {
                        shadowColor: quickActionShadow,
                      },
                    ]}
                    onPress={action.onPress}
                    activeOpacity={0.9}
                  >
                    <View style={[styles.quickActionIcon, { backgroundColor: quickActionBg }]}>{action.icon}</View>
                    <Text style={[styles.quickActionText, { color: quickActionText }]}>{action.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

          {error ? <Text style={[styles.errorText, { color: errorColor }]}>{error}</Text> : null}

          <View style={styles.energySection}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionTitleRow}>
                  <Zap size={16} color={theme.warning} />
                  <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>Daily Momentum</Text>
                </View>
              <TouchableOpacity onPress={() => navigation.navigate("Dashboard")}>
                <Text style={[styles.linkText, { color: linkColor }]}>See all</Text>
              </TouchableOpacity>
            </View>
            <DailyJourneyWidget categories={journeyCategories} />
          </View>

          <View style={styles.heroWrapper}>
            {!hasActiveResolutions ? (
              <View style={[styles.heroCard, styles.heroEmptyCard, { shadowColor: theme.shadow }]}>
                <Text style={styles.heroLabel}>Let&apos;s begin</Text>
                <Text style={[styles.heroTitle, { color: textPrimary }]}>Create your first resolution</Text>
                <Text style={[styles.heroTime, { color: textSecondary }]}>Sarthi needs a mission to coach you.</Text>
                <TouchableOpacity
                  style={[styles.heroCTAButton, { backgroundColor: theme.accent }]}
                  onPress={() => navigation.navigate("ResolutionCreate")}
                >
                  <Sparkles size={16} color={theme.mode === "dark" ? textPrimary : "#fff"} />
                  <Text style={[styles.heroCTAButtonText, { color: theme.mode === "dark" ? textPrimary : "#fff" }]}>
                    Start a resolution
                  </Text>
                </TouchableOpacity>
              </View>
            ) : heroTask ? (
              <View style={[styles.heroCard, { backgroundColor: heroCardColor, shadowColor: theme.shadow }]}>
                <Text style={styles.heroLabel}>UP NEXT</Text>
                <Text style={styles.heroTitle}>{heroTask.title}</Text>
                <Text style={styles.heroTime}>
                  {heroTask.scheduled_time ? formatTime(heroTask.scheduled_time) : "Anytime today"}
                  {heroTask.duration_min ? ` • ${heroTask.duration_min} min` : ""}
                </Text>
                <TouchableOpacity
                  style={[styles.heroButton, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}
                  onPress={() =>
                    navigation.navigate("FocusMode", {
                      taskId: heroTask.id,
                      taskTitle: heroTask.title,
                      durationMinutes: heroTask.duration_min ?? 25,
                    })
                  }
                >
                  <Play size={18} color={theme.accent} />
                  <Text style={[styles.heroButtonText, { color: textPrimary }]}>Enter Focus Mode</Text>
                </TouchableOpacity>
              </View>
            ) : allDone ? (
              <View
                style={[
                  styles.heroCard,
                  styles.celebrationCard,
                  { backgroundColor: celebrationBackground, shadowColor: theme.shadow, borderColor: theme.success },
                ]}
              >
                <Text style={styles.celebrationEmoji}>🎉</Text>
                <Text style={[styles.heroTitle, { color: celebrationAccent }]}>All clear!</Text>
                <Text style={[styles.heroTime, { color: textSecondary }]}>Every task today is wrapped.</Text>
                <Text style={[styles.heroTime, { color: textSecondary }]}>Celebrate the momentum.</Text>
              </View>
            ) : (
              <View
                style={[
                  styles.heroCard,
                  styles.heroRestCard,
                  { backgroundColor: heroRestColor, shadowColor: theme.shadow },
                ]}
              >
                <Text style={styles.heroLabel}>READY</Text>
                <Text style={styles.heroTitle}>Nothing scheduled yet</Text>
                <Text style={styles.heroTime}>Approve a plan or create a task to fill your day.</Text>
                <TouchableOpacity
                  style={[styles.heroButton, styles.heroCTAButton]}
                  onPress={() => navigation.navigate("ResolutionCreate")}
                >
                  <Plus size={18} color={theme.accent} />
                  <Text style={[styles.heroButtonText, { color: textPrimary }]}>Create a Resolution</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {loading && !refreshing ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#6B8DBF" />
            </View>
          ) : (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>Today&apos;s Flow</Text>
              </View>
              <View>
                <View style={styles.taskTabs}>
                  <TouchableOpacity
                    style={[
                      styles.taskTabButton,
                      { borderColor, backgroundColor: theme.surface },
                      taskTab === "remaining" && { backgroundColor: theme.accent, borderColor: theme.accent },
                    ]}
                    onPress={() => setTaskTab("remaining")}
                  >
                    <Text
                      style={[
                        styles.taskTabText,
                        { color: taskTab === "remaining" ? "#fff" : textSecondary },
                      ]}
                    >
                      Remaining ({remainingTasks.length})
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.taskTabButton,
                      { borderColor, backgroundColor: theme.surface },
                      taskTab === "completed" && { backgroundColor: theme.accent, borderColor: theme.accent },
                    ]}
                    onPress={() => setTaskTab("completed")}
                  >
                    <Text
                      style={[
                        styles.taskTabText,
                        { color: taskTab === "completed" ? "#fff" : textSecondary },
                      ]}
                    >
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
                      <View style={[styles.emptyTasksCard, { backgroundColor: theme.card, shadowColor: theme.shadow }]}>
                        {allDone ? (
                          <>
                            <Text style={styles.emojiCelebration}>🎉</Text>
                            <Text style={[styles.emptyTasksTitle, { color: textPrimary }]}>All done for today!</Text>
                            <Text style={[styles.emptyTasksSubtitle, { color: textSecondary }]}>
                              Celebrate the momentum or add a quick extra task.
                            </Text>
                          </>
                        ) : heroTask ? (
                          <>
                            <Text style={[styles.emptyTasksTitle, { color: textPrimary }]}>Everything else is clear</Text>
                            <Text style={[styles.emptyTasksSubtitle, { color: textSecondary }]}>
                              Handle “{heroTask.title}” above and you&apos;re wrapped for today.
                            </Text>
                          </>
                        ) : (
                          <>
                            <Text style={[styles.emptyTasksTitle, { color: textPrimary }]}>Nothing scheduled</Text>
                            <Text style={[styles.emptyTasksSubtitle, { color: textSecondary }]}>
                              Add a goal, brain dump, or create a task to guide today.
                            </Text>
                          </>
                        )}
                      </View>
                    ) : (
                      <View style={[styles.emptyTasksCard, { backgroundColor: theme.card, shadowColor: theme.shadow }]}>
                        <Text style={[styles.emptyTasksTitle, { color: textPrimary }]}>No completed tasks yet</Text>
                        <Text style={[styles.emptyTasksSubtitle, { color: textSecondary }]}>Check items off to see them here.</Text>
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
                style={[styles.fabPill, { backgroundColor: theme.success }]}
                onPress={() => {
                  toggleFab();
                  navigation.navigate("TaskCreate");
                }}
              >
                <CheckSquare color="#fff" size={18} />
                <Text style={styles.fabPillText}>New Task</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.fabPill, { backgroundColor: theme.accent }]}
                onPress={() => {
                  toggleFab();
                  navigation.navigate("ResolutionCreate");
                }}
              >
                <Target color="#fff" size={18} />
                <Text style={styles.fabPillText}>New Goal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.fabPill, { backgroundColor: theme.warning }]}
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
          <TouchableOpacity style={[styles.fabMain, { backgroundColor: theme.accent }]} onPress={toggleFab}>
            <Plus color="#fff" size={24} />
          </TouchableOpacity>
        </View>
        {praise ? (
          <Animated.View style={[styles.praiseToast, { opacity: praiseOpacity, backgroundColor: theme.overlay }]}>
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

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function computeScheduleContext(
  profile: AvailabilityProfile,
  reference: Date,
): { context: "personal" | "work"; nextSwitch: Date | null } {
  const dayKey = WEEKDAY_LABELS[reference.getDay()];
  const isWorkDay = profile.work_days.includes(dayKey);
  const startMinutes = timeStringToMinutes(profile.work_start);
  const endMinutes = timeStringToMinutes(profile.work_end);
  const currentMinutes = reference.getHours() * 60 + reference.getMinutes();

  if (isWorkDay && currentMinutes >= startMinutes && currentMinutes < endMinutes) {
    return {
      context: "work",
      nextSwitch: buildDateWithMinutes(reference, endMinutes),
    };
  }

  if (isWorkDay && currentMinutes < startMinutes) {
    return {
      context: "personal",
      nextSwitch: buildDateWithMinutes(reference, startMinutes),
    };
  }

  const nextWorkStart = findNextWorkStart(profile, reference, startMinutes);
  return {
    context: "personal",
    nextSwitch: nextWorkStart,
  };
}

function timeStringToMinutes(value: string): number {
  const [hourStr, minuteStr] = value.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }
  return hour * 60 + minute;
}

function buildDateWithMinutes(reference: Date, minutes: number): Date {
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  const date = new Date(reference);
  date.setHours(hours, remainderMinutes, 0, 0);
  if (date <= reference) {
    date.setDate(date.getDate() + 1);
    date.setHours(hours, remainderMinutes, 0, 0);
  }
  return date;
}

function findNextWorkStart(profile: AvailabilityProfile, reference: Date, startMinutes: number): Date | null {
  if (!profile.work_days.length) {
    return null;
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(reference);
    candidate.setDate(reference.getDate() + offset);
    const dayKey = WEEKDAY_LABELS[candidate.getDay()];
    if (profile.work_days.includes(dayKey)) {
      return buildDateWithMinutes(candidate, startMinutes);
    }
  }
  return null;
}

const createStyles = (theme: ThemeTokens, accentColor: string) => {
  const accentForeground = theme.mode === "dark" ? theme.textPrimary : "#fff";
  const heroTextColor = theme.mode === "dark" ? theme.textPrimary : "#fff";
  const heroLabelColor = theme.mode === "dark" ? theme.textSecondary : "rgba(255,255,255,0.7)";

  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.background,
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
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    brandIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
    },
    brandTitle: {
      fontSize: 20,
      fontWeight: "700",
      letterSpacing: 0.5,
      color: theme.textPrimary,
    },
    headerControls: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    controlButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    heroPanel: {
      borderRadius: 24,
      padding: 20,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: theme.shadow,
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
    },
    greeting: {
      fontSize: 26,
      color: theme.textPrimary,
      fontWeight: "700",
    },
    greetingSubtitle: {
      fontSize: 14,
      marginTop: 4,
      color: theme.textSecondary,
    },
    greetingHint: {
      color: theme.textSecondary,
      marginTop: 4,
    },
    heroStatsRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 16,
      marginBottom: 12,
    },
    heroStat: {
      flex: 1,
      alignItems: "center",
      gap: 4,
    },
    heroStatLabel: {
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    heroStatValue: {
      fontSize: 18,
      fontWeight: "700",
    },
    heroDivider: {
      width: 1,
      height: 32,
      backgroundColor: theme.border,
    },
    quickActionsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 24,
    },
    quickAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      shadowOpacity: 0.12,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
    quickActionIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    quickActionText: {
      fontWeight: "600",
      color: theme.textPrimary,
    },
    sectionHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
      marginTop: 8,
    },
    sectionTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: theme.textPrimary,
    },
    linkText: {
      fontSize: 14,
      fontWeight: "600",
      color: accentColor,
    },
    contextToggleRow: {
      flexDirection: "row",
      gap: 6,
      marginTop: 12,
      marginBottom: 12,
      borderRadius: 999,
      borderWidth: 1,
      padding: 4,
    },
    contextToggleButton: {
      flex: 1,
      borderRadius: 999,
      paddingVertical: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    contextToggleButtonActive: {
      backgroundColor: accentColor,
    },
    contextToggleText: {
      fontWeight: "600",
      color: theme.textSecondary,
    },
    contextToggleTextActive: {
      color: accentForeground,
    },
    energySection: {
      marginTop: 8,
      marginBottom: 8,
    },
    heroWrapper: {
      marginTop: 8,
      marginBottom: 20,
    },
    heroCard: {
      borderRadius: 28,
      padding: 24,
      backgroundColor: theme.heroPrimary,
      shadowColor: theme.shadow,
      shadowOpacity: 0.25,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 12 },
      elevation: 5,
    },
    heroRestCard: {
      backgroundColor: theme.heroRest,
    },
    heroEmptyCard: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    heroEmptyCard: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    heroLabel: {
      color: heroLabelColor,
      fontSize: 12,
      letterSpacing: 3,
      fontWeight: "700",
    },
    heroTitle: {
      fontSize: 26,
      fontWeight: "700",
      color: heroTextColor,
      marginTop: 12,
    },
    heroTime: {
      marginTop: 6,
      color: heroTextColor,
    },
    heroButton: {
      marginTop: 20,
      paddingVertical: 14,
      borderRadius: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: theme.surface,
    },
    heroCTAButton: {
      marginTop: 20,
      paddingVertical: 14,
      borderRadius: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    heroCTAButtonText: {
      fontWeight: "700",
      fontSize: 16,
    },
    heroButtonText: {
      fontWeight: "700",
      color: theme.textPrimary,
      fontSize: 16,
    },
    celebrationCard: {
      borderRadius: 28,
      borderWidth: 1,
    },
    celebrationEmoji: {
      fontSize: 36,
      marginBottom: 8,
    },
    praiseToast: {
      position: "absolute",
      bottom: 120,
      alignSelf: "center",
      backgroundColor: theme.overlay,
      borderRadius: 999,
      paddingHorizontal: 24,
      paddingVertical: 12,
      shadowColor: theme.shadow,
      shadowOpacity: 0.3,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
    },
    praiseText: {
      color: accentForeground,
      fontWeight: "700",
    },
    emptyTasksCard: {
      padding: 20,
      borderRadius: 18,
      backgroundColor: theme.card,
      shadowColor: theme.shadow,
      shadowOpacity: 0.04,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      borderWidth: 1,
      borderColor: theme.border,
    },
    emptyTasksTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: theme.textPrimary,
    },
    emptyTasksSubtitle: {
      color: theme.textSecondary,
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
      borderColor: theme.border,
      alignItems: "center",
      backgroundColor: theme.surface,
    },
    taskTabActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    taskTabText: {
      fontWeight: "600",
      color: theme.textSecondary,
    },
    taskTabActiveText: {
      color: accentForeground,
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
      backgroundColor: theme.surface,
    },
    fabPillText: {
      color: theme.textPrimary,
      fontWeight: "600",
      marginLeft: 8,
    },
    fabMain: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: "center",
      justifyContent: "center",
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
      backgroundColor: theme.accent,
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
      color: theme.danger,
      marginBottom: 12,
    },
  });
};
