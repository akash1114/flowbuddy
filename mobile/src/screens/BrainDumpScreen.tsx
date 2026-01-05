import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View, TouchableOpacity } from "react-native";
import { submitBrainDump, BrainDumpResponse } from "../api/brainDump";
import { useUserId } from "../state/user";

const MAX_LENGTH = 2000;

type SubmissionResult = {
  response: BrainDumpResponse;
  requestId: string | null;
};

export default function BrainDumpScreen() {
  const { userId, loading: userLoading } = useUserId();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmissionResult | null>(null);

  const charCount = text.length;
  const trimmed = text.trim();
  const canSubmit = !!trimmed && charCount <= MAX_LENGTH && !!userId && !loading;

  const handleSubmit = async () => {
    if (!canSubmit || !userId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await submitBrainDump({ user_id: userId, text: trimmed });
      setResult(data);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (userLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.helper}>Preparing your workspace…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Brain Dump</Text>
      <Text style={styles.helper}>Let it out. FlowBuddy will capture signals, not judge.</Text>

      <TextInput
        style={styles.input}
        multiline
        maxLength={MAX_LENGTH}
        placeholder="What's on your mind?"
        value={text}
        onChangeText={setText}
        textAlignVertical="top"
        editable={!loading}
      />
      <Text style={styles.counter}>
        {charCount}/{MAX_LENGTH}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={[styles.button, !canSubmit && styles.buttonDisabled]} onPress={handleSubmit} disabled={!canSubmit}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Capture</Text>}
      </TouchableOpacity>

      {result ? (
        <View style={styles.resultCard}>
          <Text style={styles.sectionTitle}>Acknowledgement</Text>
          <Text style={styles.body}>{result.response.acknowledgement}</Text>

          <Text style={styles.sectionTitle}>Signals</Text>
          {renderSignal("Actionable", result.response.actionable ? "Yes" : "Not yet")}
          {renderSignal("Emotional State", result.response.signals.emotional_state || "—")}
          {renderSignalList("Blockers", result.response.signals.blockers)}
          {renderSignalList("Resolution References", result.response.signals.resolution_refs)}
          {renderSignal("Intent", result.response.signals.intent_shift || "—")}

          <Text style={styles.sectionTitle}>Debug</Text>
          {renderSignal("Brain Dump ID", result.response.id)}
          {renderSignal("X-Request-Id", result.requestId || "n/a")}
        </View>
      ) : null}
    </ScrollView>
  );
}

function renderSignal(label: string, value: string) {
  return (
    <View style={styles.signalRow}>
      <Text style={styles.signalLabel}>{label}</Text>
      <Text style={styles.signalValue}>{value}</Text>
    </View>
  );
}

function renderSignalList(label: string, items: string[]) {
  if (!items.length) {
    return renderSignal(label, "—");
  }
  return (
    <View style={styles.signalRow}>
      <Text style={styles.signalLabel}>{label}</Text>
      <View style={styles.list}>
        {items.map((item) => (
          <Text key={item} style={styles.signalValue}>
            • {item}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    marginBottom: 4,
    color: "#111",
  },
  helper: {
    color: "#555",
    marginBottom: 16,
  },
  input: {
    minHeight: 160,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cfcfcf",
    padding: 12,
    fontSize: 16,
    backgroundColor: "#fff",
  },
  counter: {
    alignSelf: "flex-end",
    marginTop: 4,
    color: "#777",
    fontSize: 12,
  },
  button: {
    marginTop: 16,
    backgroundColor: "#1a73e8",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonDisabled: {
    backgroundColor: "#8fb5f8",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  error: {
    color: "#d93025",
    marginTop: 8,
  },
  resultCard: {
    marginTop: 24,
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  sectionTitle: {
    fontWeight: "600",
    marginTop: 12,
    marginBottom: 4,
  },
  body: {
    color: "#333",
  },
  signalRow: {
    marginTop: 8,
  },
  signalLabel: {
    fontSize: 14,
    color: "#666",
  },
  signalValue: {
    fontSize: 16,
    color: "#111",
  },
  list: {
    marginTop: 4,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
