import { StyleSheet, Text, View } from "react-native";

export default function SettingsPermissionsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings & Permissions</Text>
      <Text style={styles.body}>
        Placeholder screen for adjusting FlowBuddy permissions and preferences. This will eventually let you
        pause coaching, review autonomy controls, and customize notifications.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#f8f9fb",
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    color: "#555",
    textAlign: "center",
    lineHeight: 22,
  },
});
