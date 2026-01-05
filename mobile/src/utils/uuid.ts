import { v4 as uuidv4 } from "uuid";

/**
 * Generate a UUID v4 with fallback for environments where crypto.getRandomValues is not available.
 * This ensures we always generate a valid UUID format that the backend will accept.
 */
export function generateUUID(): string {
  try {
    // Try using the uuid library (requires polyfill for React Native)
    return uuidv4();
  } catch (error) {
    // Fallback: Generate a valid UUID v4 format using Math.random()
    // This is not cryptographically secure but will work for development
    // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

/**
 * Validate if a string is a valid UUID format
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

