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

  // Enqueue all delivered locations for the active session.
  let queued = 0;
  for (const loc of locations) {
    const point = await enqueueTrackingPointForActiveSession(loc as any).catch(() => null);
    if (point) queued += 1;
  }

  // A delivery is healthy only after at least one point is safely queued.
  if (queued > 0) {
    await AsyncStorage.setItem(STORAGE_LAST_BG_DELIVERY_AT_KEY, String(Date.now())).catch(() => null);
  }
});
