import { Platform } from "react-native";

// Android emulator uses 10.0.2.2 to access host machine's localhost
// iOS simulator and web can use localhost
// For physical devices, use your machine's LAN IP address
const getApiBaseUrl = (): string => {
  if (Platform.OS === "android") {
    return "https://sarthiai-backend.ctxbt.com";
  }
  // iOS simulator and web
  return "https://sarthiai-backend.ctxbt.com";
};

const API_BASE_URL = getApiBaseUrl();

type ApiOptions = Omit<RequestInit, "body"> & {
  body?: Record<string, unknown>;
};

export async function apiRequest<TResponse>(path: string, options: ApiOptions = {}): Promise<{
  data: TResponse;
  response: Response;
}> {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message = json?.detail ?? response.statusText ?? "Request failed";
      throw new Error(typeof message === "string" ? message : "Request failed");
    }

    return { data: json as TResponse, response };
  } catch (error) {
    // Handle network errors
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(
        `Network request failed. Make sure the backend server is running at ${API_BASE_URL}`
      );
    }
    // Re-throw other errors
    throw error;
  }
}
