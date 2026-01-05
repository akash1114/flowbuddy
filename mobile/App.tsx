import "react-native-get-random-values";
import "react-native-gesture-handler";
import { AppRegistry } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import HomeScreen from "./src/screens/HomeScreen";
import BrainDumpScreen from "./src/screens/BrainDumpScreen";
import type { RootStackParamList } from "./types/navigation";

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "FlowBuddy" }} />
        <Stack.Screen name="BrainDump" component={BrainDumpScreen} options={{ title: "Brain Dump" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

AppRegistry.registerComponent("main", () => App);

export default App;
