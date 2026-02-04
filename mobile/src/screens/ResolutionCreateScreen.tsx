import { useMemo, useState } from "react";
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
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

type NavProp = NativeStackNavigationProp<RootStackParamList, "ResolutionCreate">;

const MIN_TEXT = 5;
const MAX_TEXT = 300;
const MIN_DURATION = 4;
const PRESETS = [4, 8, 12] as const;

export default function ResolutionCreateScreen() {
  const navigation = useNavigation<NavProp>();
  const { userId, loading: userLoading } = useUserId();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
      navigation.navigate("PlanReview", { resolutionId: resolution.id, initialResolution: resolution });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create resolution. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (userLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.accent} />
        <Text style={[styles.helperText, { color: theme.textSecondary }]}>Preparing your workspace…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Sparkles size={18} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Plant a gentle commitment</Text>
          <Text style={styles.heroSubtitle}>Describe your focus and we’ll draft the first supportive plan.</Text>
        </View>

        <Text style={[styles.helperText, { color: theme.textSecondary }]}>
          Add a focus area in your own words. We’ll keep it gentle and collaborative.
        </Text>

        <Text style={[styles.label, { color: theme.textSecondary }]}>What is your main goal?</Text>
        <View style={[styles.inputCard, { borderColor: theme.border, backgroundColor: theme.card }]}>
          <TextInput
            style={[styles.input, { color: theme.textPrimary }]}
            multiline
            placeholder="e.g., Run a mindful 5k, ship my side project, read nightly…"
            placeholderTextColor={theme.textMuted}
            value={text}
            onChangeText={setText}
            textAlignVertical="top"
            editable={!loading}
            maxLength={MAX_TEXT}
          />
          <Text style={[styles.counter, { color: theme.textMuted }]}>
            {trimmed.length}/{MAX_TEXT}
          </Text>
        </View>

        <Text style={[styles.label, { color: theme.textSecondary }]}>Commitment Timeline</Text>
        <View style={styles.pillRow}>
          {PRESETS.map((preset) => {
            const active = duration === String(preset);
            return (
              <TouchableOpacity
                key={preset}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => handlePresetSelect(preset)}
                disabled={loading}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{preset} Weeks</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.pill, customVisible && styles.pillActive]}
            onPress={handleCustomSelect}
            disabled={loading}
          >
            <Text style={[styles.pillText, customVisible && styles.pillTextActive]}>Custom</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.helperSmall, { color: theme.textSecondary }]}>
          Sarathi needs at least 4 weeks to build a gentle habit loop.
        </Text>

        {customVisible ? (
          <TextInput
            style={[
              styles.durationInput,
              { borderColor: theme.border, backgroundColor: theme.card, color: theme.textPrimary },
            ]}
            placeholder="Enter weeks (4-52)"
            placeholderTextColor={theme.textMuted}
            value={duration}
            onChangeText={(value) => setDuration(clampDuration(value))}
            keyboardType="number-pad"
            editable={!loading}
          />
        ) : null}

        {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.ctaWrapper}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: theme.accent, shadowColor: theme.shadow }, !canSubmit && styles.buttonDisabled]}
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
          <Text style={[styles.linkText, { color: theme.accent }]}>Need inspiration?</Text>
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
const createStyles = (theme: ThemeTokens) => {
  const heroTextColor = theme.mode === "dark" ? theme.textPrimary : "#fff";
  const heroSubtitleColor = theme.mode === "dark" ? theme.textSecondary : "rgba(255,255,255,0.85)";
  const accentForeground = theme.mode === "dark" ? theme.textPrimary : "#fff";

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background,
    },
    container: {
      padding: 20,
      flexGrow: 1,
      gap: 16,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
      backgroundColor: theme.background,
    },
    heroCard: {
      borderRadius: 24,
      padding: 20,
      backgroundColor: theme.heroPrimary,
      shadowOpacity: 0.2,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      shadowColor: theme.shadow,
    },
    heroIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.5)",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    heroTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: heroTextColor,
    },
    heroSubtitle: {
      marginTop: 6,
      color: heroSubtitleColor,
    },
    helperText: {
      marginTop: 8,
      color: theme.textSecondary,
    },
    label: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.textSecondary,
    },
    inputCard: {
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
      borderColor: theme.border,
      backgroundColor: theme.card,
    },
    input: {
      minHeight: 140,
      fontSize: 16,
      color: theme.textPrimary,
    },
    counter: {
      alignSelf: "flex-end",
      fontSize: 12,
      marginTop: 6,
      color: theme.textMuted,
    },
    pillRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 12,
    },
    pill: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    pillActive: {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
    },
    pillText: {
      fontWeight: "600",
      color: theme.textPrimary,
    },
    pillTextActive: {
      color: accentForeground,
    },
    helperSmall: {
      marginTop: 6,
      fontSize: 12,
      color: theme.textSecondary,
    },
    durationInput: {
      marginTop: 12,
      borderRadius: 12,
      borderWidth: 1,
      padding: 12,
      borderColor: theme.border,
      backgroundColor: theme.card,
      color: theme.textPrimary,
    },
    button: {
      flexDirection: "row",
      gap: 8,
      paddingVertical: 14,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      shadowOpacity: 0.3,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      shadowColor: theme.shadow,
      backgroundColor: theme.accent,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonText: {
      color: accentForeground,
      fontWeight: "600",
      fontSize: 16,
    },
    error: {
      marginTop: 12,
      color: theme.danger,
    },
    linkButton: {
      marginTop: 12,
      alignItems: "center",
    },
    linkText: {
      fontWeight: "500",
      color: theme.accent,
    },
    ctaWrapper: {
      paddingHorizontal: 20,
      paddingBottom: 24,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      backgroundColor: theme.surface,
    },
  });
};
