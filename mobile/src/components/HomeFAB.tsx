import { useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";

type Props = {
  onBrainDump: () => void;
  onNewResolution: () => void;
};

export default function HomeFAB({ onBrainDump, onNewResolution }: Props) {
  const [expanded, setExpanded] = useState(false);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    const toValue = expanded ? 0 : 1;
    setExpanded(!expanded);
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue,
        duration: 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <>
      <TouchableWithoutFeedback
        onPress={toggle}
        disabled={!expanded}
      >
        <Animated.View pointerEvents={expanded ? "auto" : "none"} style={[styles.overlay, { opacity: overlayOpacity }]} />
      </TouchableWithoutFeedback>

      <View style={styles.container}>
        <Animated.View style={[styles.actionContainer, { transform: [{ scale: scaleAnim }] }]}>
          <TouchableOpacity style={[styles.actionButton, styles.newResolution]} onPress={onNewResolution}>
            <Text style={styles.actionIcon}>🎯</Text>
            <Text style={styles.actionLabel}>Start New Goal</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, styles.brainDump]} onPress={onBrainDump}>
            <Text style={styles.actionIcon}>✨</Text>
            <Text style={styles.actionLabel}>Vent / Update</Text>
          </TouchableOpacity>
        </Animated.View>

        <TouchableOpacity style={styles.fab} onPress={toggle}>
          <Text style={styles.fabIcon}>{expanded ? "×" : "+"}</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  container: {
    position: "absolute",
    bottom: 24,
    right: 24,
    alignItems: "flex-end",
  },
  actionContainer: {
    marginBottom: 12,
    gap: 12,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  actionIcon: {
    fontSize: 16,
  },
  actionLabel: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  newResolution: {
    backgroundColor: "#9DB8A0",
  },
  brainDump: {
    backgroundColor: "#6B8DBF",
  },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#2D3748",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabIcon: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "600",
  },
});
