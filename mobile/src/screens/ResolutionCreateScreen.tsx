import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { Sparkles } from "lucide-react-native";
import { createResolution } from "../api/resolutions";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";

type NavProp = NativeStackNavigationProp<RootStackParamList, "ResolutionCreate">;

const MIN_TEXT = 5;
const MAX_TEXT = 300;
const MIN_DURATION = 4;
const PRESETS = [4, 8, 12] as const;

export default function ResolutionCreateScreen() {
  const navigation = useNavigation<NavProp>();
  const { userId, loading: userLoading } = useUserId();
  const [text, setText] = useState("");
  const [duration, setDuration] = useState("");
  const [customVisible, setCustomVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const durationNumber = duration ? Number(duration) : undefined;
  const durationValid =
    duration !== "" && Number.isInteger(durationNumber) && durationNumber! >= MIN_DURATION && durationNumber! <= 52;
  const textValid = trimmed.length >= MIN_TEXT && trimmed.length <= MAX_TEXT;
  const canSubmit = !!userId && textValid && durationValid && !loading && !userLoading;

  const handlePresetSelect = (value: number) => {
    setCustomVisible(false);
    setDuration(String(value));
  };

  const handleCustomSelect = () => {
    setCustomVisible(true);
    if (!duration || Number(duration) < MIN_DURATION) {
      setDuration(String(MIN_DURATION));
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !userId) return;
    if (!durationValid || !durationNumber) {
      setError("Duration should be between 4 and 52 weeks.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { resolution } = await createResolution({
        user_id: userId,
        text: trimmed,
        duration_weeks: durationNumber,
      });
      navigation.replace("PlanReview", { resolutionId: resolution.id, initialResolution: resolution });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create resolution. Please try again.");
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
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>New Resolution</Text>
        <Text style={styles.helper}>Add a focus area in your own words. We’ll keep it gentle and collaborative.</Text>

        <Text style={styles.label}>What is your main goal?</Text>
        <TextInput
          style={styles.input}
          multiline
          placeholder="e.g., Run a 5k in 2 months, Read 10 pages daily..."
          value={text}
          onChangeText={setText}
          textAlignVertical="top"
          editable={!loading}
          maxLength={MAX_TEXT}
        />
        <Text style={styles.counter}>
          {trimmed.length}/{MAX_TEXT}
        </Text>

        <Text style={styles.label}>Commitment Timeline</Text>
        <View style={styles.pillRow}>
          {PRESETS.map((preset) => (
            <TouchableOpacity
              key={preset}
              style={[styles.pill, duration === String(preset) && styles.pillActive]}
              onPress={() => handlePresetSelect(preset)}
              disabled={loading}
            >
              <Text style={[styles.pillText, duration === String(preset) && styles.pillTextActive]}>{preset} Weeks</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.pill, customVisible && styles.pillActive]}
            onPress={handleCustomSelect}
            disabled={loading}
          >
            <Text style={[styles.pillText, customVisible && styles.pillTextActive]}>Custom</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.helperSmall}>FlowBuddy needs at least 4 weeks to help you build a habit loop.</Text>

        {customVisible ? (
          <TextInput
            style={styles.durationInput}
            placeholder="Enter weeks (4-52)"
            value={duration}
            onChangeText={(value) => setDuration(clampDuration(value))}
            keyboardType="number-pad"
            editable={!loading}
          />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.ctaWrapper}>
        <TouchableOpacity
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          {loading ? (
            <Text style={styles.buttonText}>Decomposing goal...</Text>
          ) : (
            <>
              <Sparkles color="#fff" size={18} />
              <Text style={styles.buttonText}>Generate Agent Plan</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkButton}
          onPress={() =>
            Alert.alert(
              "Need help?",
              "Try summarizing one supportive habit or project. We'll keep everything in draft until you approve.",
            )
          }
        >
          <Text style={styles.linkText}>Need inspiration?</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function clampDuration(value: string): string {
  const numeric = value.replace(/[^0-9]/g, "");
  if (!numeric) return "";
  const number = Number(numeric);
  if (Number.isNaN(number)) return "";
  const clamped = Math.min(52, Math.max(MIN_DURATION, number));
  return String(clamped);
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f7f8fa",
  },
  container: {
    padding: 20,
    flexGrow: 1,
    },
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: "#111",
  },
  helper: {
    color: "#555",
    marginTop: 8,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  input: {
    minHeight: 140,
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
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#cfd4e4",
    backgroundColor: "#fff",
  },
  pillActive: {
    backgroundColor: "#1a73e8",
    borderColor: "#1a73e8",
  },
  pillText: {
    color: "#1f2933",
    fontWeight: "600",
  },
  pillTextActive: {
    color: "#fff",
  },
  helperSmall: {
    marginTop: 6,
    color: "#6b7280",
    fontSize: 12,
  },
  durationInput: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cfcfcf",
    padding: 12,
    backgroundColor: "#fff",
  },
  button: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    backgroundColor: "#1a73e8",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
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
    marginTop: 12,
    color: "#c62828",
  },
  linkButton: {
    marginTop: 12,
    alignItems: "center",
  },
  linkText: {
    color: "#1a73e8",
    fontWeight: "500",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaWrapper: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fefefe",
  },
});
