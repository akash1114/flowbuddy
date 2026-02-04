import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { listResolutions, ResolutionSummary } from "../api/resolutions";
import { useUserId } from "../state/user";
import type { RootStackParamList } from "../../types/navigation";
import { useTheme } from "../theme";
import type { ThemeTokens } from "../theme";

type NavigationProp = NativeStackNavigationProp<RootStackParamList, "DraftPlans">;

export default function ResolutionsListScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { userId, loading: userLoading } = useUserId();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [resolutions, setResolutions] = useState<ResolutionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadResolutions = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { items } = await listResolutions(userId, "draft");
      setResolutions(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load drafts.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userLoading && userId) {
      loadResolutions();
    }
  }, [userLoading, userId, loadResolutions]);

  const onRefresh = () => {
    setRefreshing(true);
    loadResolutions();
  };

  const renderItem = ({ item }: { item: ResolutionSummary }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate("PlanReview", { resolutionId: item.id })}
    >
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.meta}>{item.type} · {item.duration_weeks ?? "Flexible"} weeks</Text>
      <Text style={styles.updated}>Updated {new Date(item.updated_at).toLocaleString()}</Text>
    </TouchableOpacity>
  );

  if (userLoading || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
        <Text style={styles.helper}>Fetching your draft plans…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.retry} onPress={loadResolutions}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!resolutions.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No drafts yet</Text>
        <Text style={styles.helper}>Start a new resolution and we’ll keep the plan waiting here.</Text>
        <TouchableOpacity style={styles.retry} onPress={() => navigation.navigate("ResolutionCreate")}>
          <Text style={styles.retryText}>Create a resolution</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={resolutions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const createStyles = (theme: ThemeTokens) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    listContent: {
      padding: 16,
    },
    card: {
      padding: 16,
      borderRadius: 12,
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: theme.shadow,
      shadowOpacity: 0.04,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
    },
    title: {
      fontSize: 16,
      fontWeight: "600",
      color: theme.textPrimary,
    },
    meta: {
      color: theme.textSecondary,
      marginTop: 4,
    },
    updated: {
      marginTop: 6,
      color: theme.textMuted,
      fontSize: 12,
    },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 16,
      backgroundColor: theme.background,
    },
    helper: {
      marginTop: 8,
      color: theme.textSecondary,
      textAlign: "center",
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: "600",
      color: theme.textPrimary,
    },
    error: {
      color: theme.danger,
      fontSize: 16,
      textAlign: "center",
    },
    retry: {
      marginTop: 12,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.accent,
    },
    retryText: {
      color: theme.accent,
      fontWeight: "600",
    },
  });
