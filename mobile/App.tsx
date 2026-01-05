import "react-native-get-random-values";
import "react-native-gesture-handler";
import { AppRegistry } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
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
import type { RootStackParamList } from "./types/navigation";

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "FlowBuddy" }} />
        <Stack.Screen name="BrainDump" component={BrainDumpScreen} options={{ title: "Brain Dump" }} />
        <Stack.Screen
          name="DraftPlans"
          component={ResolutionsListScreen}
          options={{ title: "Draft Plans" }}
        />
        <Stack.Screen name="MyWeek" component={MyWeekScreen} options={{ title: "My Week" }} />
        <Stack.Screen name="Dashboard" component={ResolutionDashboardScreen} options={{ title: "Dashboard" }} />
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}

AppRegistry.registerComponent("main", () => App);

export default App;
