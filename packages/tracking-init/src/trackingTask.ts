import AsyncStorage from "@react-native-async-storage/async-storage";
import * as TaskManager from "expo-task-manager";

import { STORAGE_LAST_BG_DELIVERY_AT_KEY, TRACKING_TASK_NAME } from "./trackingConstants.js";
import { enqueueTrackingPointForActiveSession } from "./queue.js";

// IMPORTANT: defineTask must be imported at app startup so Android can wake up the JS runtime.
TaskManager.defineTask(TRACKING_TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.warn("[TRACKING_INIT_TASK] error:", error);
    return;
  }

  const payload = data as any;
  const locations: any[] = payload?.locations ?? [];
  if (!locations.length) return;

  // Record that Android delivered a background update (useful for debugging OEM restrictions).
  await AsyncStorage.setItem(STORAGE_LAST_BG_DELIVERY_AT_KEY, String(Date.now())).catch(() => null);

  // Enqueue all delivered locations for the active session.
  for (const loc of locations) {
    await enqueueTrackingPointForActiveSession(loc as any).catch(() => null);
  }
});
