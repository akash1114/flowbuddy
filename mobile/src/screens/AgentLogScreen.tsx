import { StyleSheet, Text, View } from "react-native";

export default function AgentLogScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Agent Log</Text>
      <Text style={styles.body}>
        This is a placeholder for viewing FlowBuddy’s agent actions and undo options. Future versions will
        mirror the transparency log from the SRS so you can inspect every automated intervention.
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
