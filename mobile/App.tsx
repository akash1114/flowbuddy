import "react-native-get-random-values";
import "react-native-gesture-handler";
import { AppRegistry } from "react-native";
import { useMemo } from "react";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import HomeScreen from "./src/screens/HomeScreen";
import BrainDumpScreen from "./src/screens/BrainDumpScreen";
import ResolutionCreateScreen from "./src/screens/ResolutionCreateScreen";
import PlanReviewScreen from "./src/screens/PlanReviewScreen";
import ResolutionsListScreen from "./src/screens/ResolutionsListScreen";
import MyWeekScreen from "./src/screens/MyWeekScreen";
import ResolutionDashboardScreen from "./src/screens/ResolutionDashboardScreen";
import ResolutionDashboardDetailScreen from "./src/screens/ResolutionDashboardDetailScreen";
import SettingsPermissionsScreen from "./src/screens/SettingsPermissionsScreen";
import PersonalizationScreen from "./src/screens/PersonalizationScreen";
import AgentLogScreen from "./src/screens/AgentLogScreen";
import AgentLogDetailScreen from "./src/screens/AgentLogDetailScreen";
import WeeklyPlanScreen from "./src/screens/WeeklyPlanScreen";
import InterventionsScreen from "./src/screens/InterventionsScreen";
import WeeklyPlanHistoryScreen from "./src/screens/WeeklyPlanHistoryScreen";
import WeeklyPlanHistoryDetailScreen from "./src/screens/WeeklyPlanHistoryDetailScreen";
import InterventionsHistoryScreen from "./src/screens/InterventionsHistoryScreen";
import InterventionsHistoryDetailScreen from "./src/screens/InterventionsHistoryDetailScreen";
import TaskEditScreen from "./src/screens/TaskEditScreen";
import TaskCreateScreen from "./src/screens/TaskCreateScreen";
import FocusModeScreen from "./src/screens/FocusModeScreen";
import { ThemeProvider, useTheme } from "./src/theme";
import type { RootStackParamList } from "./types/navigation";

const Stack = createNativeStackNavigator<RootStackParamList>();

function Navigator() {
  const { theme, isDark } = useTheme();
  const navigationTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        background: theme.background,
        card: theme.surface,
        text: theme.textPrimary,
        border: theme.border,
        primary: theme.accent,
      },
    }),
    [isDark, theme],
  );

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Sarthi AI" }} />
        <Stack.Screen name="BrainDump" component={BrainDumpScreen} options={{ title: "Brain Dump" }} />
        <Stack.Screen
          name="DraftPlans"
          component={ResolutionsListScreen}
          options={{ title: "Draft Plans" }}
        />
        <Stack.Screen name="MyWeek" component={MyWeekScreen} options={{ title: "My Week" }} />
        <Stack.Screen name="Dashboard" component={ResolutionDashboardScreen} options={{ title: "Dashboard" }} />
        <Stack.Screen name="WeeklyPlan" component={WeeklyPlanScreen} options={{ title: "Next Week Blueprint" }} />
        <Stack.Screen name="Interventions" component={InterventionsScreen} options={{ title: "Interventions" }} />
        <Stack.Screen name="WeeklyPlanHistory" component={WeeklyPlanHistoryScreen} options={{ title: "Blueprint History" }} />
        <Stack.Screen
          name="WeeklyPlanHistoryDetail"
          component={WeeklyPlanHistoryDetailScreen}
          options={{ title: "Blueprint Snapshot" }}
        />
        <Stack.Screen
          name="InterventionsHistory"
          component={InterventionsHistoryScreen}
          options={{ title: "Intervention History" }}
        />
        <Stack.Screen
          name="InterventionsHistoryDetail"
          component={InterventionsHistoryDetailScreen}
          options={{ title: "Intervention Snapshot" }}
        />
        <Stack.Screen
          name="SettingsPermissions"
          component={SettingsPermissionsScreen}
          options={{ title: "Settings & Permissions" }}
        />
        <Stack.Screen
          name="Personalization"
          component={PersonalizationScreen}
          options={{ title: "Personalize Flow" }}
        />
        <Stack.Screen name="AgentLog" component={AgentLogScreen} options={{ title: "Agent Log" }} />
        <Stack.Screen
          name="AgentLogDetail"
          component={AgentLogDetailScreen}
          options={{ title: "Log Detail" }}
        />
        <Stack.Screen
          name="ResolutionDashboardDetail"
          component={ResolutionDashboardDetailScreen}
          options={{ title: "Resolution Overview" }}
        />
        <Stack.Screen name="ResolutionCreate" component={ResolutionCreateScreen} options={{ title: "New Resolution" }} />
        <Stack.Screen
          name="PlanReview"
          component={PlanReviewScreen}
          options={{ title: "Plan Review" }}
        />
        <Stack.Screen name="TaskCreate" component={TaskCreateScreen} options={{ title: "New Task" }} />
        <Stack.Screen name="TaskEdit" component={TaskEditScreen} options={{ title: "Edit Task" }} />
        <Stack.Screen
          name="FocusMode"
          component={FocusModeScreen}
          options={{ headerShown: false, presentation: "modal" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function App() {
  return (
    <ThemeProvider>
      <Navigator />
    </ThemeProvider>
  );
}

AppRegistry.registerComponent("main", () => App);

export default App;
