import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { submitBrainDump } from "../../api/brainDump";
import { useUserId } from "../../state/user";

const MAX_LENGTH = 2000;

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function BrainDumpModal({ visible, onClose }: Props) {
  const { userId } = useUserId();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState<{
    acknowledgement: string;
    actionable: boolean;
    suggested?: string | null;
  } | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 300);
    } else {
      setText("");
      setAck(null);
      setError(null);
      setLoading(false);
    }
  }, [visible]);

  const trimmed = text.trim();
  const canSubmit = !!userId && !!trimmed && trimmed.length <= MAX_LENGTH && !loading;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      setLoading(true);
      setError(null);
      const { response } = await submitBrainDump({
        user_id: userId!,
        text: trimmed,
      });
      setAck({
        acknowledgement: response.acknowledgement,
        actionable: response.actionable,
        suggested: response.suggested_response,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to process that signal. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingBottom: insets.bottom || 24 }]}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.header, { paddingTop: (insets.top || 0) + 12 }]}>
            <Text style={styles.headerTitle}>What's on your mind?</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            multiline
            placeholder="Let it out. We'll capture signals, not judge…"
            placeholderTextColor="#A0A09A"
            value={text}
            onChangeText={setText}
            maxLength={MAX_LENGTH}
            textAlignVertical="top"
          />
          <Text style={styles.counter}>
            {trimmed.length}/{MAX_LENGTH}
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {loading ? (
            <View style={styles.listening}>
              <ActivityIndicator color="#2D3748" />
              <Text style={styles.listeningText}>Listening…</Text>
            </View>
          ) : null}

          {ack ? (
            <View style={styles.ackCard}>
              <Text style={styles.ackTitle}>Acknowledgement</Text>
              <Text style={styles.ackText}>{ack.acknowledgement}</Text>
              {ack.suggested ? (
                <Text style={styles.ackSuggested}>{ack.suggested}</Text>
              ) : null}
              {ack.actionable ? (
                <TouchableOpacity style={styles.adjustButton}>
                  <Text style={styles.adjustButtonText}>Would you like me to adjust your plan?</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom || 20 }]}>
            <TouchableOpacity
              style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Analyze Signal</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F0",
  },
  flex: {
    flex: 1,
    backgroundColor: "#F2F2F0",
  },
  header: {
    padding: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 24,
    color: "#2D3748",
    fontFamily: "Georgia",
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E2E0D8",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    fontSize: 20,
    color: "#2D3748",
  },
  body: {
    padding: 20,
    paddingBottom: 120,
    gap: 12,
  },
  input: {
    minHeight: 200,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    fontSize: 16,
    color: "#2D3748",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  counter: {
    alignSelf: "flex-end",
    color: "#9CA3AF",
    fontSize: 12,
  },
  errorText: {
    color: "#C53030",
  },
  listening: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  listeningText: {
    color: "#4A5568",
    fontWeight: "600",
  },
  ackCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  ackTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2D3748",
  },
  ackText: {
    color: "#4A5568",
  },
  ackSuggested: {
    marginTop: 6,
    color: "#2D3748",
    fontStyle: "italic",
  },
  adjustButton: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#2D3748",
    alignItems: "center",
  },
  adjustButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F2F2F0",
  },
  submitButton: {
    backgroundColor: "#2D3748",
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
