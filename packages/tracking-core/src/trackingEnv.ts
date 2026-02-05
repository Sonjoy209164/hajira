export type TrackingEnvConfig = {
  baseUrl: string;
  apiKey?: string | null;
};

declare const process: any;

function readEnvFirst(keys: string[]): string | null {
  const env =
    typeof process !== "undefined" && process?.env ? (process.env as any) : (globalThis as any)?.process?.env;
  if (!env) return null;

  for (const key of keys) {
    const v = env?.[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function getDefaultTrackingEnvConfig(): TrackingEnvConfig | null {
  // Mobile (Expo) convention in this repo
  const baseUrl = readEnvFirst([
    "TRACKING_API_BASE_URL",
    "EXPO_PUBLIC_API_BASE_URL",
    // Next/admin-portal convention in this repo
    "BE_HOST",
    "NEXT_PUBLIC_BE_HOST",
  ]);

  if (!baseUrl) return null;

  const apiKey = readEnvFirst([
    "TRACKING_API_KEY",
    "EXPO_PUBLIC_API_KEY",
    "API_KEY",
  ]);

  return { baseUrl, apiKey };
}
