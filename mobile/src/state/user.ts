import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateUUID, isValidUUID } from "../utils/uuid";

const STORAGE_KEY = "flowbuddy:user_id";

export function useUserId(): { userId: string | null; loading: boolean } {
  const generatedRef = useRef<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        let stored = await AsyncStorage.getItem(STORAGE_KEY);
        // Validate that stored ID is a valid UUID (in case old invalid format was stored)
        if (!stored || !isValidUUID(stored)) {
          // Generate UUID - will use fallback if native module not available
          if (!generatedRef.current) {
            generatedRef.current = generateUUID();
          }
          stored = generatedRef.current;
          await AsyncStorage.setItem(STORAGE_KEY, stored);
        }
        if (!cancelled) {
          setUserId(stored);
        }
      } catch (error) {
        // If there's an error, try to generate a UUID one more time
        if (!cancelled) {
          if (!generatedRef.current) {
            // Generate UUID with fallback - should always succeed
            generatedRef.current = generateUUID();
            await AsyncStorage.setItem(STORAGE_KEY, generatedRef.current);
            setUserId(generatedRef.current);
          } else {
            // Use the already generated ID
            setUserId(generatedRef.current);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return { userId, loading };
}
