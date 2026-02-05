import * as TaskManager from "expo-task-manager";
import type { LocationObject } from "expo-location";

import { enqueueTrackingPoint } from "./pointQueue.js";

// Legacy/experimental task kept for compatibility.
export const LOCATION_TASK_NAME = "route-tracking-task-v1";

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.log("[TASK] error", error);
    return;
  }

  const locations = (data as any)?.locations as LocationObject[] | undefined;
  const firstLocation = locations?.[0];
  if (!firstLocation?.coords) return;

  try {
    await enqueueTrackingPoint(firstLocation);
  } catch (e) {
    console.log("[TASK] enqueue failed", e);
  }
});
