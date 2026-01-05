import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import type { RootStackParamList } from "../../types/navigation";

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, "Home">;

export default function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>FlowBuddy</Text>
      <Text style={styles.subtitle}>Supportive Autonomy starts with a quick brain dump.</Text>

      <TouchableOpacity style={[styles.button, styles.primary]} onPress={() => navigation.navigate("BrainDump")}>
        <Text style={styles.buttonText}>Brain Dump</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.secondary]} onPress={() => {}}>
        <Text style={[styles.buttonText, styles.secondaryText]}>New Resolution (soon)</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
  },
  title: {
    fontSize: 32,
    fontWeight: "600",
    marginBottom: 8,
    color: "#111",
  },
  subtitle: {
    fontSize: 16,
    color: "#555",
    marginBottom: 32,
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 16,
    alignItems: "center",
  },
  primary: {
    backgroundColor: "#1a73e8",
  },
  secondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d0d0d0",
  },
  buttonText: {
    fontSize: 16,
    color: "#fff",
    fontWeight: "500",
  },
  secondaryText: {
    color: "#1a73e8",
  },
});
