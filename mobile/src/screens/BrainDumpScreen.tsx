import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  UIManager,
} from "react-native";
import { CheckCircle2 } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { submitBrainDump, BrainDumpResponse } from "../api/brainDump";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

const MAX_LENGTH = 2000;

type SubmissionResult = {
  response: BrainDumpResponse;
  requestId: string | null;
};

type Step = "INTAKE" | "PROCESSING" | "ANALYSIS";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function BrainDumpScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { userId, loading: userLoading } = useUserId();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [step, setStep] = useState<Step>("INTAKE");
  const pulse = useRef(new Animated.Value(0)).current;

  const charCount = text.length;
  const trimmed = text.trim();
  const canSubmit = !!trimmed && charCount <= MAX_LENGTH && !!userId && !loading;

  useEffect(() => {
    if (step === "PROCESSING") {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(0);
    }
  }, [step, pulse]);

  const handleSubmit = async () => {
    if (!canSubmit || !userId) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLoading(true);
    setError(null);
    setStep("PROCESSING");
    setResult(null);
    try {
      const data = await submitBrainDump({ user_id: userId, text: trimmed });
      setResult({ response: data.data, requestId: data.requestId });
      setText("");
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setStep("ANALYSIS");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setStep("INTAKE");
    } finally {
      setLoading(false);
    }
  };

  if (userLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
        <Text style={styles.helper}>Preparing your workspace…</Text>
      </View>
    );
  }

  const renderPill = (value: string | null, type: "emotion" | "topic") => {
    if (!value) return null;
    const pillStyle = type === "emotion" ? styles.emotionPill : styles.topicPill;
    const textStyle = type === "emotion" ? styles.emotionPillText : styles.topicPillText;
    return (
      <View key={`${type}-${value}`} style={pillStyle}>
        <Text style={textStyle}>{value}</Text>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {step === "INTAKE" ? (
          <>
            <Text style={styles.title}>What&apos;s on your mind?</Text>
            <Text style={styles.helper}>Sarthi AI listens but won&apos;t add tasks unless you ask.</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                multiline
                maxLength={MAX_LENGTH}
                placeholder="I’m feeling stuck because..."
                placeholderTextColor={theme.textMuted}
                value={text}
                onChangeText={setText}
                textAlignVertical="top"
                editable={!loading}
              />
              <Text style={styles.counter}>
                {charCount}/{MAX_LENGTH}
              </Text>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity
              style={[styles.button, !canSubmit && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {loading ? (
                <ActivityIndicator color={theme.mode === "dark" ? theme.textPrimary : "#fff"} />
              ) : (
                <Text style={styles.buttonText}>Analyze Signal</Text>
              )}
            </TouchableOpacity>
          </>
        ) : null}

        {step === "PROCESSING" ? (
          <View style={styles.processing}>
            <Animated.View
              style={[
                styles.pulse,
                {
                  transform: [
                    {
                      scale: pulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.9, 1.1],
                      }),
                    },
                  ],
                  opacity: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.7, 1],
                  }),
                },
              ]}
            />
            <Text style={styles.processingText}>Listening…</Text>
          </View>
        ) : null}

        {step === "ANALYSIS" && result ? (
          <View style={styles.analysisCard}>
            <Text style={styles.acknowledgement}>"{result.response.acknowledgement}"</Text>
            <Text style={styles.sentiment}>Sentiment: {result.response.signals.sentiment_score.toFixed(2)}</Text>
            <View style={styles.pillGroup}>
              {result.response.signals.emotions.map((emotion) => renderPill(emotion, "emotion"))}
              {result.response.signals.topics.map((topic) => renderPill(topic, "topic"))}
            </View>

            <View style={styles.actionArea}>
              {result.response.signals.actionable_items.length ? (
                <>
                  <Text style={styles.actionableText}>Sarthi AI noticed these next steps:</Text>
                  {result.response.signals.actionable_items.map((item) => (
                    <Text key={item} style={styles.suggestedAction}>
                      • {item}
                    </Text>
                  ))}
                  <View style={styles.actionButtons}>
                    <TouchableOpacity
                      style={[styles.button, styles.primaryAction]}
                      onPress={() => {
                        console.log("User accepted suggested action");
                        navigation.navigate("Home");
                      }}
                    >
                      <Text style={styles.buttonText}>Yes, please</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.secondaryAction]}
                      onPress={() => navigation.navigate("Home")}
                    >
                      <Text style={[styles.buttonText, styles.secondaryActionText]}>No, thanks</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.nonActionable}>
                    <CheckCircle2 color="#4B5563" size={20} />
                    <Text style={styles.nonActionableText}>Signals captured. No tasks added.</Text>
                  </View>
                  <TouchableOpacity style={[styles.button, styles.dismissButton]} onPress={() => navigation.navigate("Home")}>
                    <Text style={styles.buttonText}>Done</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: ThemeTokens) => {
  const buttonTextColor = theme.mode === "dark" ? theme.textPrimary : "#fff";

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background,
    },
    container: {
      padding: 24,
      gap: 16,
    },
    title: {
      fontSize: 26,
      color: theme.textPrimary,
      fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    },
    helper: {
      color: theme.textSecondary,
      fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
    },
    inputWrapper: {
      padding: 16,
      borderRadius: 20,
      backgroundColor: theme.card,
      shadowColor: theme.shadow,
      shadowOpacity: 0.12,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      borderWidth: 1,
      borderColor: theme.border,
    },
    input: {
      minHeight: 180,
      fontSize: 18,
      color: theme.textPrimary,
      fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
    },
    counter: {
      alignSelf: "flex-end",
      color: theme.textMuted,
      marginTop: 8,
      fontSize: 12,
    },
    button: {
      marginTop: 16,
      paddingVertical: 14,
      borderRadius: 999,
      alignItems: "center",
      backgroundColor: theme.accent,
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
    },
    buttonDisabled: {
      backgroundColor: theme.accentSoft,
    },
    buttonText: {
      color: buttonTextColor,
      fontWeight: "600",
      fontSize: 16,
    },
    error: {
      color: theme.danger,
      marginTop: 8,
    },
    processing: {
      alignItems: "center",
      marginTop: 40,
    },
    pulse: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: theme.accentSoft,
    },
    processingText: {
      marginTop: 16,
      color: theme.textSecondary,
      fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
    },
    analysisCard: {
      marginTop: 20,
      backgroundColor: theme.card,
      borderRadius: 24,
      padding: 20,
      gap: 12,
      shadowColor: theme.shadow,
      shadowOpacity: 0.12,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 8 },
      borderWidth: 1,
      borderColor: theme.border,
    },
    acknowledgement: {
      fontSize: 22,
      fontStyle: "italic",
      color: theme.textPrimary,
      fontFamily: Platform.select({ ios: "Georgia", default: "serif" }),
    },
    sentiment: {
      color: theme.textSecondary,
    },
    pillGroup: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 12,
    },
    emotionPill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.accentSoft,
    },
    emotionPillText: {
      fontWeight: "600",
      color: theme.accent,
    },
    topicPill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.chipBackground,
    },
    topicPillText: {
      fontWeight: "600",
      color: theme.chipText,
    },
    actionArea: {
      marginTop: 8,
      gap: 12,
    },
    actionableText: {
      color: theme.textSecondary,
      fontFamily: Platform.select({ ios: "System", default: "sans-serif" }),
    },
    suggestedAction: {
      color: theme.textPrimary,
      fontWeight: "600",
    },
    actionButtons: {
      gap: 8,
    },
    primaryAction: {
      backgroundColor: theme.success,
    },
    secondaryAction: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    secondaryActionText: {
      color: theme.textPrimary,
    },
    dismissButton: {
      backgroundColor: theme.accent,
    },
    nonActionable: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    nonActionableText: {
      color: theme.textSecondary,
    },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.background,
    },
  });
};
